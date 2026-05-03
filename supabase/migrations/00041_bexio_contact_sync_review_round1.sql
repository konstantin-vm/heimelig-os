-- Migration 00041 — Story 2.6 review round 1 (2026-05-03).
--
-- Closes the concurrency + lost-update + observability findings from the
-- Hunter Trio review of migration 00040.
--
--   * D1 — Concurrent-claim duplicate-create + lost-update race
--     `claim_pending_bexio_contact_syncs` previously released its
--     FOR UPDATE SKIP LOCKED locks on RPC commit, which is *before* the
--     Edge Function makes any bexio call. Combined with the deploy-time
--     finding that `api_reference` Search-Before-POST is structurally
--     inert on /2.0/contact, two overlapping invocations could both POST
--     a fresh contact for the same customer.
--
--     Fix: add `'in_progress'` to the bexio_sync_status enum. The claim
--     RPC now FLIPS the row to `'in_progress'` (with `bexio_sync_started_at`
--     stamped) inside the same statement that picks it. Subsequent claims
--     skip the row because the WHERE clause filters on `'pending'`. The
--     mark_* RPCs are gated to require status='in_progress' before
--     flipping (returns boolean — false on stale write). A user mid-sync
--     edit sets status back to `'pending'` via the existing case-when
--     guard in `update_customer_with_primary_address` (00029), and the
--     in-flight markSynced becomes a no-op — no stale data lands in
--     `synced`.
--
--     Watchdog: stale `'in_progress'` rows older than 10 minutes are
--     reset back to `'pending'` at the top of every claim. Recovers from
--     Edge Function timeouts (kill mid-sweep) without orphaning rows.
--
--   * H4 — Lost-update race
--     Naturally closed by the `'in_progress'` gate above. mark_synced
--     only flips when the row is still in_progress; if a fresh edit re-set
--     it to pending, the markSynced no-ops and the next sweep re-syncs
--     with fresh data.
--
--   * D3 — Cron secret no longer plaintext in cron.job.command
--     The cron command body now reads `current_setting('app.bexio_cron_secret')`
--     at fire-time, so the secret is not persisted in cron.job.command.
--     The GUC itself is still the source-of-truth for both the migration
--     and Edge Function env BEXIO_CRON_SECRET (rotation: change both).
--
--   * M8 — Cron schedule skip visibility
--     When the GUCs are unset, the migration now writes a `critical`
--     severity error_log row in addition to RAISE NOTICE so the
--     /settings/bexio admin dashboard surfaces "cron not bootstrapped"
--     on next page-load. Replaces the silent NOTICE-only failure mode.
--
-- Story 2.6 ACs covered: AC5 (RPC shape), AC10 (sweep semantics),
-- AC14 (audit_log writes), AC15 (idempotent on replay).

-- =============================================================================
-- 1. CHECK constraint — add 'in_progress' enum value.
-- =============================================================================

do $$
declare
  v_constraint_name text;
begin
  select conname
    into v_constraint_name
    from pg_constraint
   where conrelid = 'public.customers'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%bexio_sync_status%';

  if v_constraint_name is null then
    raise notice 'Migration 00041: bexio_sync_status CHECK constraint not found — already migrated or renamed';
  else
    execute format('alter table public.customers drop constraint %I', v_constraint_name);
  end if;
end$$;

alter table public.customers
  add constraint customers_bexio_sync_status_check
  check (bexio_sync_status in ('pending','in_progress','synced','failed','local_only'));

-- =============================================================================
-- 2. New column — bexio_sync_started_at — drives the watchdog.
-- =============================================================================

alter table public.customers
  add column if not exists bexio_sync_started_at timestamptz;

comment on column public.customers.bexio_sync_started_at is
  'Story 2.6 review-round-1: stamped when bexio_sync_status flips to ''in_progress'' so the watchdog (claim_pending_bexio_contact_syncs) can reset rows orphaned by an Edge Function timeout (>10 min). NULL outside in_progress.';

-- =============================================================================
-- 3. Replace claim_pending_bexio_contact_syncs — flips pending→in_progress
--    + watchdog reset of stale in_progress rows.
-- =============================================================================

create or replace function public.claim_pending_bexio_contact_syncs(
  p_limit int default 25
)
returns setof uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int;
begin
  if p_limit is null or p_limit <= 0 then
    v_limit := 25;
  elsif p_limit > 100 then
    v_limit := 100;
  else
    v_limit := p_limit;
  end if;

  -- Watchdog: rows that were claimed but the Edge Function never reached
  -- mark_* (timeout, crash, network drop) get reset so the next sweep
  -- picks them up. Threshold = 10 min — comfortably above the Edge
  -- Function execution budget (max 60s on the Free tier, 300s on Pro)
  -- but short enough that an operator notices a real backlog quickly.
  update public.customers
     set bexio_sync_status     = 'pending',
         bexio_sync_started_at = null
   where bexio_sync_status = 'in_progress'
     and bexio_sync_started_at is not null
     and bexio_sync_started_at < now() - interval '10 minutes';

  return query
  with picked as (
    select c.id
      from public.customers c
     where c.bexio_sync_status = 'pending'
       and c.is_active = true
     order by c.updated_at asc
     limit v_limit
     for update skip locked
  )
  update public.customers c
     set bexio_sync_status     = 'in_progress',
         bexio_sync_started_at = now()
    from picked
   where c.id = picked.id
   returning c.id;
end;
$$;

revoke execute on function public.claim_pending_bexio_contact_syncs(int) from public, anon, authenticated;
grant  execute on function public.claim_pending_bexio_contact_syncs(int) to service_role;

comment on function public.claim_pending_bexio_contact_syncs(int) is
  'Story 2.6 AC5/AC10 + review round 1. SECURITY DEFINER service_role-only batch claim. Flips up to p_limit oldest pending rows to ''in_progress'' (FOR UPDATE SKIP LOCKED) and stamps bexio_sync_started_at, returning the customer ids. Includes a watchdog that first resets stale ''in_progress'' rows (>10 min) back to ''pending'' so an Edge Function timeout does not orphan customers. p_limit clamped to [1, 100]; default 25.';

-- =============================================================================
-- 4. New: claim_single_for_bexio_sync(uuid) — manual button reservation.
--    Same status-machine as the sweep: any-state → in_progress (when free).
--    Returns false on overlap (an active in_progress reservation exists)
--    or when the customer is missing/inactive.
-- =============================================================================

create or replace function public.claim_single_for_bexio_sync(
  p_customer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status     text;
  v_started_at timestamptz;
begin
  if p_customer_id is null then
    raise exception 'claim_single_for_bexio_sync: p_customer_id is null'
      using errcode = '22023';
  end if;

  select c.bexio_sync_status, c.bexio_sync_started_at
    into v_status, v_started_at
    from public.customers c
   where c.id = p_customer_id
     and c.is_active = true
   for update;

  if not found then
    return false;
  end if;

  -- Reject if an active reservation exists. Stale (>10 min) is allowed
  -- to recover so a stuck sync doesn't lock the user out forever.
  if v_status = 'in_progress'
     and v_started_at is not null
     and v_started_at >= now() - interval '10 minutes' then
    return false;
  end if;

  update public.customers
     set bexio_sync_status     = 'in_progress',
         bexio_sync_started_at = now()
   where id = p_customer_id;

  return true;
end;
$$;

revoke execute on function public.claim_single_for_bexio_sync(uuid) from public, anon, authenticated;
grant  execute on function public.claim_single_for_bexio_sync(uuid) to service_role;

comment on function public.claim_single_for_bexio_sync(uuid) is
  'Story 2.6 review round 1. SECURITY DEFINER service_role-only single-customer reservation for the manual sync path (button on <BexioContactCard>). Flips any-state → ''in_progress'' (with started-at stamp). Returns false on overlap (active in_progress reservation, <10 min old) or missing/inactive customer. Mirrors claim_pending_bexio_contact_syncs but works on one row regardless of current sync status.';

-- =============================================================================
-- 5. New: release_bexio_sync_to_pending(uuid) — Edge Function calls this
--    on retriable failure (5xx, 429, network) so the next sweep retries.
-- =============================================================================

create or replace function public.release_bexio_sync_to_pending(
  p_customer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if p_customer_id is null then
    raise exception 'release_bexio_sync_to_pending: p_customer_id is null'
      using errcode = '22023';
  end if;

  select c.bexio_sync_status
    into v_status
    from public.customers c
   where c.id = p_customer_id
   for update;

  if not found then
    return false;
  end if;

  -- Only flip in_progress → pending. If a user edit re-set the row to
  -- pending mid-sync, leave it; if a prior path already marked it failed
  -- or synced, leave it.
  if v_status <> 'in_progress' then
    return false;
  end if;

  update public.customers
     set bexio_sync_status     = 'pending',
         bexio_sync_started_at = null
   where id = p_customer_id;

  return true;
end;
$$;

revoke execute on function public.release_bexio_sync_to_pending(uuid) from public, anon, authenticated;
grant  execute on function public.release_bexio_sync_to_pending(uuid) to service_role;

comment on function public.release_bexio_sync_to_pending(uuid) is
  'Story 2.6 review round 1. SECURITY DEFINER service_role-only release path: flips bexio_sync_status from ''in_progress'' back to ''pending'' on retriable failure (5xx / 429 / network) so the next sweep retries. No-op on any non-in_progress status (returns false). No audit_log entry — the operational signal lives in error_log via logEdgeError.';

-- =============================================================================
-- 6. Replace mark_bexio_contact_synced — gated to in_progress, returns boolean.
--    Signature changes from `returns void` to `returns boolean`; CREATE OR
--    REPLACE rejects return-type changes, so DROP+CREATE.
-- =============================================================================

drop function if exists public.mark_bexio_contact_synced(uuid, int);

create or replace function public.mark_bexio_contact_synced(
  p_customer_id        uuid,
  p_bexio_contact_id   int
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before  jsonb;
  v_status  text;
  v_existed boolean;
begin
  if p_customer_id is null then
    raise exception 'mark_bexio_contact_synced: p_customer_id is null'
      using errcode = '22023';
  end if;
  if p_bexio_contact_id is null or p_bexio_contact_id <= 0 then
    raise exception 'mark_bexio_contact_synced: p_bexio_contact_id must be positive int (got %)', p_bexio_contact_id
      using errcode = '22023';
  end if;

  select jsonb_build_object(
           'bexio_contact_id',   c.bexio_contact_id,
           'bexio_sync_status',  c.bexio_sync_status,
           'bexio_synced_at',    c.bexio_synced_at
         ),
         c.bexio_sync_status,
         true
    into v_before, v_status, v_existed
    from public.customers c
   where c.id = p_customer_id
   for update;

  if not coalesce(v_existed, false) then
    raise exception 'mark_bexio_contact_synced: customer % not found', p_customer_id
      using errcode = '23503';
  end if;

  -- Lost-update guard (review round 1): only flip in_progress → synced.
  -- A user re-edit mid-sync via update_customer_with_primary_address
  -- would have set status='pending', in which case this RPC must NOT
  -- overwrite the fresh edit. Returning false signals the Edge Function
  -- to log a stale-write skip and let the next sweep re-process.
  if v_status <> 'in_progress' then
    return false;
  end if;

  update public.customers
     set bexio_contact_id      = p_bexio_contact_id,
         bexio_sync_status     = 'synced',
         bexio_synced_at       = now(),
         bexio_sync_started_at = null
   where id = p_customer_id;

  perform public.log_activity(
    'bexio_contact_synced',
    'customers',
    p_customer_id,
    v_before,
    jsonb_build_object(
      'bexio_contact_id',  p_bexio_contact_id,
      'bexio_sync_status', 'synced'
    ),
    jsonb_build_object(
      'actor_system',     'contact_sync',
      'bexio_contact_id', p_bexio_contact_id
    )
  );

  return true;
end;
$$;

revoke execute on function public.mark_bexio_contact_synced(uuid, int) from public, anon, authenticated;
grant  execute on function public.mark_bexio_contact_synced(uuid, int) to service_role;

comment on function public.mark_bexio_contact_synced(uuid, int) is
  'Story 2.6 AC5/AC14 + review round 1. SECURITY DEFINER service_role-only success write. Gated: only flips in_progress → synced (returns false on stale write — caller logs and lets next sweep re-process). Sets bexio_contact_id, bexio_sync_status=''synced'', bexio_synced_at=now(), clears bexio_sync_started_at. Emits one audit_log row (action ''bexio_contact_synced'', actor_system=''contact_sync''). Raises 22023 on null/non-positive args, 23503 if customer missing.';

-- =============================================================================
-- 7. Replace mark_bexio_contact_sync_failed — gated to in_progress, returns boolean.
-- =============================================================================

drop function if exists public.mark_bexio_contact_sync_failed(uuid, text);

create or replace function public.mark_bexio_contact_sync_failed(
  p_customer_id uuid,
  p_error_code  text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before  jsonb;
  v_status  text;
  v_existed boolean;
  v_code    text;
begin
  if p_customer_id is null then
    raise exception 'mark_bexio_contact_sync_failed: p_customer_id is null'
      using errcode = '22023';
  end if;

  v_code := nullif(btrim(coalesce(p_error_code, '')), '');
  if v_code is not null and length(v_code) > 80 then
    v_code := substr(v_code, 1, 80);
  end if;

  select jsonb_build_object(
           'bexio_sync_status', c.bexio_sync_status
         ),
         c.bexio_sync_status,
         true
    into v_before, v_status, v_existed
    from public.customers c
   where c.id = p_customer_id
   for update;

  if not coalesce(v_existed, false) then
    -- Customer was deleted between claim and mark — surface to caller as
    -- false (not an exception). This avoids 23503-noise in error_log when
    -- the office hard-deletes a row mid-sweep.
    return false;
  end if;

  -- Same gate as mark_synced: only the active reservation may transition
  -- to terminal failed state.
  if v_status <> 'in_progress' then
    return false;
  end if;

  update public.customers
     set bexio_sync_status     = 'failed',
         updated_at            = now(),
         bexio_sync_started_at = null
   where id = p_customer_id;

  perform public.log_activity(
    'bexio_contact_sync_failed',
    'customers',
    p_customer_id,
    v_before,
    jsonb_build_object(
      'bexio_sync_status', 'failed'
    ),
    jsonb_build_object(
      'actor_system', 'contact_sync',
      'error_code',   coalesce(v_code, 'unknown')
    )
  );

  return true;
end;
$$;

revoke execute on function public.mark_bexio_contact_sync_failed(uuid, text) from public, anon, authenticated;
grant  execute on function public.mark_bexio_contact_sync_failed(uuid, text) to service_role;

comment on function public.mark_bexio_contact_sync_failed(uuid, text) is
  'Story 2.6 AC5/AC14 + review round 1. SECURITY DEFINER service_role-only sticky-failure write. Gated: only flips in_progress → failed (returns false on stale write or missing customer — caller logs and skips). Preserves bexio_contact_id (a previously-linked contact stays linked). Clears bexio_sync_started_at. Emits one audit_log row (action ''bexio_contact_sync_failed'', actor_system=''contact_sync'', details.error_code).';

-- =============================================================================
-- 8. Reschedule cron — read secret from current_setting() at fire-time
--    (D3) so the cron command does not persist the plaintext secret in
--    cron.job.command.
--
--    On missing GUCs, write a critical error_log row (M8) in addition to
--    RAISE NOTICE so the admin status page sees the gap.
-- =============================================================================

do $$
begin
  begin
    perform cron.unschedule('bexio-contact-sync-sweep');
  exception when others then
    null;
  end;
end$$;

do $$
declare
  v_url    text := nullif(current_setting('app.bexio_contact_sync_url', true), '');
  v_secret text := nullif(current_setting('app.bexio_cron_secret',     true), '');
begin
  if v_url is null or v_secret is null then
    raise notice 'Story 2.6 — skipping bexio-contact-sync-sweep cron schedule: app.bexio_contact_sync_url and/or app.bexio_cron_secret unset. Bootstrap with `alter database postgres set app.bexio_contact_sync_url = ''...'';` and `alter database postgres set app.bexio_cron_secret = ''...'';` then re-run the cron block at the bottom of migration 00041.';

    -- M8: surface the gap to the admin error dashboard.
    insert into public.error_log (
      error_type, severity, source, message, details
    ) values (
      'EDGE_FUNCTION',
      'critical',
      'contact-sync',
      'bexio-contact-sync-sweep cron schedule not active — operator must set app.bexio_contact_sync_url + app.bexio_cron_secret GUCs and re-apply migration 00041.',
      jsonb_build_object(
        'code',           'cron_not_bootstrapped',
        'app_url_set',    (v_url is not null),
        'app_secret_set', (v_secret is not null)
      )
    );
    return;
  end if;

  -- D3: secret is read from current_setting() at fire-time. cron.job.command
  -- carries the URL but not the secret (the GUC is owned by the postgres
  -- role; a SELECT on cron.job no longer leaks the secret).
  perform cron.schedule(
    'bexio-contact-sync-sweep',
    '*/5 * * * *',
    format(
      $cron$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', current_setting('app.bexio_cron_secret', true), 'Content-Type', 'application/json'), body := '{}'::jsonb);$cron$,
      v_url
    )
  );
end$$;

-- End of migration 00041.
