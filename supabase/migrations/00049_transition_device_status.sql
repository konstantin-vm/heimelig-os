-- Migration 00049 — Story 3.3 — controlled device status transitions.
--
-- Closes the CLAUDE.md anti-pattern *"Direct UPDATE on status columns —
-- always via PostgreSQL Function"* for `public.devices.status`. Until now,
-- every story since 1.3 carried defense-in-depth comments saying *"status
-- changes route through `transition_device_status` (Story 3.3)"*. This is
-- that story.
--
-- Two artefacts:
--
-- 1. `public.transition_device_status(p_device_id, p_new_status, p_context)`
--    SECURITY DEFINER RPC. Validates the directed state machine
--    (available→{rented,repair,sold} | rented→{cleaning} |
--     cleaning→{available,repair} | repair→{available,sold} |
--     sold→terminal), role-gates the caller (admin/office/warehouse via
--    `is_admin()`/`is_office()`/`is_warehouse()` from 00001), takes a row
--    lock to serialise concurrent transitions on the same device, runs the
--    UPDATE (the existing `trg_devices_audit` from 00014 fires here and
--    writes the generic delta row), then calls `log_activity(...)` with
--    `action = 'device.status_transition'` for the rich semantic event row.
--
-- 2. `revoke update (status) on public.devices from authenticated;` — the
--    column-level lock that makes the SECURITY DEFINER function the *only*
--    write path on `devices.status`. Existing UPDATE policies on every
--    other column stay untouched (no column-level WITH CHECK in PG RLS, so
--    a column-level grant/revoke is the simplest correct lever). The
--    SECURITY DEFINER function pierces the revoke because it executes as
--    its owner — same shape used by `replace_price_list_entry` (00043+44+45)
--    when it pierces the otherwise-DENY price_lists write policy.
--
-- PG-version trap (Story 3.1 round-1, see 00045 header): PG 14+ rejects
-- `raise insufficient_privilege using errcode = '42501'` as
-- `42601 RAISE option already specified: ERRCODE` because the condition
-- name already implies the SQLSTATE. Use `using message = '...'` only.
-- Other raises use the generic `exception` form with `errcode = '...'`,
-- which is fine.
--
-- Idempotent on replay: function uses `create or replace`; `revoke` is
-- idempotent (re-running has no effect when the privilege is already
-- revoked); `grant execute` is idempotent.
--
-- See data-model-spec §5.4.1 line 585 + epic ACs lines 630–654.

-- =============================================================================
-- 1. transition_device_status(uuid, text, jsonb) — state machine RPC.
-- =============================================================================

create or replace function public.transition_device_status(
  p_device_id  uuid,
  p_new_status text,
  p_context    jsonb default '{}'::jsonb
) returns public.devices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_status text;
  v_role       text;
  v_allowed    text[];
  v_row        public.devices;
begin
  -- 1. Argument guards.
  if p_device_id is null then
    raise exception 'p_device_id darf nicht NULL sein' using errcode = '22023';
  end if;
  if p_new_status is null
     or p_new_status not in ('available','rented','cleaning','repair','sold') then
    raise exception 'Ungültiger Zielstatus: %', p_new_status using errcode = '22023';
  end if;
  if p_context is null or jsonb_typeof(p_context) <> 'object' then
    raise exception 'p_context muss ein jsonb-Objekt sein' using errcode = '22023';
  end if;

  -- 2. Role gate. SECURITY DEFINER bypasses RLS — gate explicitly.
  --    Technician + everyone else DENY (matches data-model-spec §Rollen-Modell
  --    + memory feedback_role_permissions: admin/office/warehouse vollständig
  --    operativ einbinden, technician read-only).
  if public.is_admin() then
    v_role := 'admin';
  elsif public.is_office() then
    v_role := 'office';
  elsif public.is_warehouse() then
    v_role := 'warehouse';
  else
    raise insufficient_privilege using
      message = 'Keine Berechtigung für Status-Änderungen';
  end if;

  -- 3. Lock + read current row. `for update` serialises concurrent
  --    transitions on the same device — without the lock two callers can
  --    both validate `rented → cleaning` against a stale read and the
  --    second UPDATE silently overwrites the first (audit log shows two
  --    transitions, device went rented → cleaning → cleaning).
  select status
    into v_old_status
    from public.devices
   where id = p_device_id
     and retired_at is null
   for update;

  if not found then
    raise exception 'Gerät % nicht gefunden oder bereits ausgemustert', p_device_id
      using errcode = '23503';
  end if;

  -- 4. State-machine matrix. Single source of truth on the DB side.
  --    Mirrors lib/constants/device.ts `deviceStatusTransitions`; the UI
  --    reads optimistically, the RPC re-validates as the authoritative gate.
  v_allowed := case v_old_status
    when 'available' then array['rented','repair','sold']
    when 'rented'    then array['cleaning']
    when 'cleaning'  then array['available','repair']
    when 'repair'    then array['available','sold']
    when 'sold'      then array[]::text[]
    else array[]::text[]
  end;

  if v_old_status = p_new_status then
    raise exception 'Status ist bereits %', p_new_status using errcode = '23514';
  end if;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'Ungültiger Status-Übergang: % → %', v_old_status, p_new_status
      using errcode = '23514';
  end if;

  -- 5. Apply the UPDATE. The auto trigger trg_devices_audit (00014) fires
  --    here and writes the generic delta row. updated_by mirrors the caller
  --    via auth.uid() — SECURITY DEFINER preserves the JWT actor.
  update public.devices
     set status     = p_new_status,
         updated_by = auth.uid()
   where id = p_device_id
   returning * into v_row;

  -- 6. Rich semantic event for the audit trail card. Pairs with the auto
  --    trigger row (5). Two rows is the established Story 1.5 + 2.1 shape
  --    (field-level delta + semantic event).
  perform public.log_activity(
    'device.status_transition',
    'devices',
    p_device_id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_new_status),
    p_context || jsonb_build_object('actor_role', v_role)
  );

  return v_row;
end;
$$;

comment on function public.transition_device_status(uuid, text, jsonb) is
  'Story 3.3 — controlled device status transitions. SECURITY DEFINER + role gate (admin/office/warehouse). Validates the directed state machine (available→{rented,repair,sold} | rented→{cleaning} | cleaning→{available,repair} | repair→{available,sold} | sold→terminal). Pairs with column-level revoke update(status) so this is the only write path on devices.status. Generic audit_trigger_fn fires on the UPDATE; this function additionally calls log_activity with action=device.status_transition for the rich semantic event row.';

-- =============================================================================
-- 2. Column-level lock — the canonical anti-pattern enforcement.
-- =============================================================================
-- PostgreSQL ACL semantics: when a table-level `GRANT UPDATE ON tbl TO role`
-- exists (00008 line 50 grants exactly this on devices to authenticated),
-- a follow-up `REVOKE UPDATE (col)` is silently a no-op — the table-level
-- privilege supersedes column-level revokes. The correct pattern is to
-- (a) revoke the table-level UPDATE outright and then (b) re-grant UPDATE
-- on every column *except* `status`. The list below is exhaustive against
-- the column set as of 00048; new columns added in later migrations need
-- to be added here too (or the next migration ships its own re-grant).
-- Existing RLS policies on `devices` (admin/office/warehouse UPDATE) are
-- unchanged — RLS gates *which rows* a role can update; this gates *which
-- columns* the privilege covers in the first place.
-- Service-role + the function owner retain full UPDATE; SECURITY DEFINER
-- pierces the column-list grant because the function executes as its owner.

revoke update on public.devices from authenticated;
grant update (
  id,
  serial_number,
  article_id,
  qr_code,
  condition,
  current_warehouse_id,
  current_contract_id,
  supplier_id,
  inbound_date,
  outbound_date,
  acquired_at,
  acquisition_price,
  reserved_for_customer_id,
  reserved_at,
  retired_at,
  notes,
  created_at,
  updated_at,
  created_by,
  updated_by,
  is_new
) on public.devices to authenticated;

-- =============================================================================
-- 3. Grants on the RPC.
-- =============================================================================

grant execute on function public.transition_device_status(uuid, text, jsonb)
  to authenticated;

-- =============================================================================
-- Smoke matrix — Story 3.3 §AC9 (S1–S13).
-- Executed 2026-05-04 via `supabase db query --linked` with role-claim
-- impersonation (`set_config('request.jwt.claims', …, true)` +
-- `set local role authenticated`). All 13 cases PASSED.
--
-- S1  admin role + 'available' device + p_new_status='rented'  → PASS — row returned status='rented'; generic + semantic audit rows written
-- S2  office role  + same                                       → PASS — OK
-- S3  warehouse role + same                                     → PASS — OK
-- S4  technician role + same                                    → PASS — 42501 insufficient_privilege
-- S5  authenticated, no app_role claim + same                   → PASS — 42501 insufficient_privilege
-- S6  admin + 'rented' device + p_new_status='available'        → PASS — 23514 "Ungültiger Status-Übergang: rented → available"
-- S7  admin + 'available' device + p_new_status='available'     → PASS — 23514 "Status ist bereits available"
-- S8  admin + 'sold' device + any p_new_status                  → PASS — 23514 (terminal; "Ungültiger Status-Übergang: sold → available")
-- S9  admin + retired device                                    → PASS — 23503 "Gerät … nicht gefunden oder bereits ausgemustert"
-- S10 admin + p_new_status='broken'                             → PASS — 22023 "Ungültiger Zielstatus: broken"
-- S11 admin + direct  update devices set status='rented'        → PASS — 42501 (table-level UPDATE revoked + per-column re-grant excluding status)
-- S12 admin + direct  update devices set notes='…'              → PASS — succeeded (column-scoped revoke leaves other columns writable)
-- S13 office + direct update devices set status='rented'        → PASS — 42501 (revoke applies to authenticated; office inherits)
--
-- Audit-trail verification: a single transition produces TWO rows in
-- audit_log per AC4 — `action='devices_updated'` (generic delta from
-- audit_trigger_fn, details.tg_op='UPDATE') AND `action='device.status_transition'`
-- (semantic event from inline log_activity, details.actor_role='admin|office|warehouse'
-- and the caller's p_context merged in). Both rows carry actor_user_id =
-- auth.uid() so the audit-trail card resolves the actor identically.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- IMPORTANT — column-lock semantics (PG ACL quirk).
-- ---------------------------------------------------------------------------
-- The first iteration of this migration used:
--     revoke update (status) on public.devices from authenticated;
-- That statement is silently a no-op when the table-level UPDATE has
-- already been granted via `grant update on public.devices to
-- authenticated` (00008 line 50): a column-level REVOKE cannot subtract
-- from a table-level grant. The corrected pattern (above, section 2) is
-- to revoke the table-level UPDATE outright, then re-GRANT UPDATE on
-- every column EXCEPT `status`. **Future migrations adding new columns
-- to `devices` MUST re-grant UPDATE on the new column to authenticated**
-- (or include them in a fresh per-column GRANT after the column is added),
-- otherwise the office/warehouse update flows lose write access to the
-- new column. See `useDeviceUpdate` in `lib/queries/devices.ts` for the
-- list of columns the form layer touches today.
-- ---------------------------------------------------------------------------
