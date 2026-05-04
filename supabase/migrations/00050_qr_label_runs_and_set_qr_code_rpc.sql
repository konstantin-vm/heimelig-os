-- Migration 00050 — Story 3.7 (QR Label Generation & Printing).
-- (Slot 00049 was reserved by Story 3.3 transition_device_status RPC; per
--  Story 3.7 §1.2 protocol we bumped to 00050 instead of colliding.)
--
-- Two pieces, one migration:
--
--   1. `public.qr_label_runs` — per-print-run audit row. Stores the article,
--      the batch UUID (used as the second path segment in
--      `qr-labels/{article_id}/{batch_id}.pdf`), the device_ids printed in
--      the batch, status/failure_reason, the storage_path (CHECK-constrained
--      to the canonical shape), and `created_at` / `created_by`. The
--      `qr-labels` Storage bucket + 12 `qr_labels_*` policies were already
--      provisioned by Story 1.6 (migration 00018 + 00019); this story only
--      adds the per-row audit table that the print-history UI lists from.
--
--   2. `public.set_device_qr_code(p_device_id uuid, p_qr_code text)` —
--      SECURITY DEFINER RPC. The ONLY sanctioned writer for `devices.qr_code`
--      outside of the future Blue-Office migration script (Story 9.1). The
--      RPC is idempotent (sets only when the column is NULL or already
--      equals the requested value); a real conflict raises `22023` so the
--      caller can surface a German "QR-Code-Konflikt — bitte Gerät neu
--      laden" toast instead of the generic `23505` `unique_violation`
--      string. Technician callers raise `42501` from inside the function
--      body (SECURITY DEFINER bypasses RLS, so the role gate must live in
--      the function itself — same pattern as 00043 `create_article_with_prices`
--      and 00046 `create_price_list_version`).
--
-- Q5 status as of 2026-05-04 (story creation): OPEN. The QR payload is the
-- plaintext `serial_number` (single-sourced in `lib/qr-labels/encode.ts`);
-- if Q5 lands as option C ("formats incompatible") this story slides back
-- to Sprint 1 and a Go-Live re-labeling marathon is added (see Story 3.7
-- §1 Pre-implementation blockers + Sprint plan 2026-04-30).
--
-- Replay safety: every step uses `if not exists` / `create or replace` /
-- `drop ... if exists` + `create` / idempotent membership check on
-- supabase_realtime, so a second `supabase db push --linked` is a no-op.

-- =============================================================================
-- 1. `public.qr_label_runs` — per-print-run audit row.
-- =============================================================================
-- NOTE: data-model-spec.md §5.4 (inventory domain) does NOT yet include
-- `qr_label_runs`. The doc-sync at Story 3.7 closeout (sub-task 9.1) adds
-- the entry as §5.4.3.

create table if not exists public.qr_label_runs (
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid not null references public.articles(id) on delete restrict,
  batch_id        uuid not null unique,
  device_ids      uuid[] not null check (cardinality(device_ids) > 0),
  device_count    int generated always as (cardinality(device_ids)) stored,
  status          text not null default 'completed'
                  check (status in ('completed', 'failed')),
  failure_reason  text,
  storage_path    text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  -- Canonical Storage path: qr-labels/{article_id}/{batch_id}.pdf
  -- The Storage bucket's `storage_first_segment_is_uuid(name)` shape gate
  -- (00018) only verifies the leading UUID; this CHECK is the database-side
  -- belt-and-braces that rejects malformed paths even if a buggy caller
  -- bypasses the application's path builder.
  constraint qr_label_runs_storage_path_format check (
    storage_path = 'qr-labels/' || article_id::text || '/' || batch_id::text || '.pdf'
  )
);

comment on table public.qr_label_runs is
  'Per-print-run audit row for QR label PDFs (Story 3.7). One row per Speichern '
  'action in <QrLabelPreviewDialog>. The PDF blob lives in Storage at '
  'storage_path (qr-labels/{article_id}/{batch_id}.pdf — bucket provisioned by '
  'Story 1.6 / migration 00018). RLS: admin ALL, office + warehouse SELECT + '
  'INSERT, technician deny. Audit trigger via 00014 audit_trigger_fn.';

comment on column public.qr_label_runs.batch_id is
  'UUID minted per print run; used as the second path segment in storage_path. '
  'Unique so a re-print of the same selection produces a new row + new file '
  'instead of silently overwriting (Storage upload uses upsert: false so the '
  'unique constraint catches a duplicate batch_id at insert time too).';

comment on column public.qr_label_runs.device_ids is
  'Array of devices.id values whose labels were generated in this run. Stored '
  'as uuid[] (not a join table) because (a) print runs are append-only — no '
  'individual rows are mutated post-print, and (b) batch sizes max out at the '
  'article''s active device count (typically <150), well within Postgres '
  'array-element limits.';

comment on column public.qr_label_runs.storage_path is
  'CHECK-constrained to qr-labels/{article_id}/{batch_id}.pdf. Database rejects '
  'malformed paths even if the application path builder regresses.';

-- =============================================================================
-- 2. Indexes.
-- =============================================================================

create index if not exists idx_qr_label_runs_article_id
  on public.qr_label_runs (article_id, created_at desc);

-- batch_id already has a unique index from the inline `unique` constraint on
-- the column declaration; no extra index needed.

-- =============================================================================
-- 3. RLS — admin ALL, office + warehouse SELECT + INSERT, technician deny.
-- =============================================================================

alter table public.qr_label_runs enable row level security;
alter table public.qr_label_runs force row level security;

-- Admin: full RWX.
drop policy if exists qr_label_runs_admin_all on public.qr_label_runs;
create policy qr_label_runs_admin_all on public.qr_label_runs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Office: SELECT + INSERT. UPDATE / DELETE: admin only (use admin DELETE for
-- now; soft-delete via a `cancelled_at` column is a follow-up if the audit
-- trail later needs it).
drop policy if exists qr_label_runs_office_select on public.qr_label_runs;
create policy qr_label_runs_office_select on public.qr_label_runs
  for select to authenticated
  using (public.is_office());

drop policy if exists qr_label_runs_office_insert on public.qr_label_runs;
create policy qr_label_runs_office_insert on public.qr_label_runs
  for insert to authenticated
  with check (public.is_office());

-- Warehouse: SELECT + INSERT.
drop policy if exists qr_label_runs_warehouse_select on public.qr_label_runs;
create policy qr_label_runs_warehouse_select on public.qr_label_runs
  for select to authenticated
  using (public.is_warehouse());

drop policy if exists qr_label_runs_warehouse_insert on public.qr_label_runs;
create policy qr_label_runs_warehouse_insert on public.qr_label_runs
  for insert to authenticated
  with check (public.is_warehouse());

-- Technician: deny by default — no policy. Defense-in-depth: UI hides the
-- print actions via useAppRole(); /articles/labels route returns null
-- server-side when role==='technician'; middleware allowlist excludes
-- /articles entirely for technician (ROLE_ALLOWED_PATHS).

-- =============================================================================
-- 4. SECURITY DEFINER RPC `set_device_qr_code(p_device_id, p_qr_code)`.
-- =============================================================================
-- Idempotent qr_code write-back. Sets the column only when it is NULL or
-- already equals p_qr_code; a real conflict raises 22023. Technician callers
-- raise 42501 from inside the function body (SECURITY DEFINER bypasses RLS,
-- so the gate lives here, not in policy form). Admin / office / warehouse
-- pass.

create or replace function public.set_device_qr_code(
  p_device_id uuid,
  p_qr_code   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
begin
  if v_role is null
     or v_role not in ('admin', 'office', 'warehouse') then
    raise exception 'set_device_qr_code: role not allowed (%)', coalesce(v_role, 'null')
      using errcode = '42501';
  end if;

  if p_qr_code is null or length(trim(p_qr_code)) = 0 then
    raise exception 'set_device_qr_code: p_qr_code must be non-empty'
      using errcode = '22023';
  end if;

  update public.devices
     set qr_code = p_qr_code
   where id = p_device_id
     and (qr_code is null or qr_code = p_qr_code);

  if not found then
    -- Either the device doesn't exist OR the existing qr_code differs
    -- from p_qr_code. The caller surfaces a German conflict toast and
    -- prompts the user to refresh.
    raise exception 'set_device_qr_code: qr_code conflict for device %', p_device_id
      using errcode = '22023';
  end if;
end;
$$;

comment on function public.set_device_qr_code(uuid, text) is
  'SECURITY DEFINER. The only sanctioned writer for devices.qr_code outside '
  'of the Blue-Office migration script (Story 9.1). Idempotent: sets when '
  'NULL or already equal; raises 22023 on conflict (caller maps to a German '
  '"QR-Code-Konflikt" toast). Raises 42501 for any role other than '
  'admin / office / warehouse. Story 3.7 AC-DM-b.';

revoke execute on function public.set_device_qr_code(uuid, text) from public, anon;
grant  execute on function public.set_device_qr_code(uuid, text) to authenticated;

-- =============================================================================
-- 5. Audit-trigger binding for qr_label_runs (pattern from 00014).
-- =============================================================================
-- Suppress updated_at/updated_by columns the same way 00014 binds the other
-- 11 tables, even though qr_label_runs is append-only and won't have UPDATE
-- traffic in steady-state. Future-proof: if a soft-delete/cancellation
-- column is added later, the same trigger picks up the delta automatically.

drop trigger if exists trg_qr_label_runs_audit on public.qr_label_runs;
create trigger trg_qr_label_runs_audit
  after insert or update or delete on public.qr_label_runs
  for each row execute function public.audit_trigger_fn('updated_at', 'updated_by');

-- =============================================================================
-- 6. Realtime publication membership (idempotent — pattern from 00038/43/47).
-- =============================================================================
-- The `/articles/labels` history table subscribes to postgres_changes on
-- public.qr_label_runs so Session B's print appears in Session A's table
-- without F5. Without publication membership the channel mounts cleanly
-- but never fires.

do $$
declare
  t_name text;
  v_target_tables text[] := ARRAY[
    'qr_label_runs'
  ];
begin
  foreach t_name in array v_target_tables
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname    = 'supabase_realtime'
         and schemaname = 'public'
         and tablename  = t_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        t_name
      );
    end if;
  end loop;
end;
$$;
