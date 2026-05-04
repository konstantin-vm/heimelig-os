-- Migration 00055 — Story 3.7 code-review fixes (round 1).
--
-- Story 3.7 / migration 00050 was already applied to the cloud DB at the
-- time the code review landed. Migration files are content-frozen once
-- applied — supabase CLI tracks by version, not hash — so the review's
-- schema-side patches ship as a separate forward-only migration that
-- ALTERs the existing structure rather than re-creating it.
--
-- Fixes applied here (story file → § Review Findings):
--
--   H2  default auth.uid() on qr_label_runs.created_by
--         (column was nullable with no default; INSERTs were leaving the
--         actor un-attributed in the print-history view).
--
--   H3  FK target on qr_label_runs.created_by → public.user_profiles(id)
--         (was → auth.users(id); PostgREST embed `user_profiles!fkey(...)`
--         in lib/queries/qr-labels.ts threw PGRST200 every list).
--
--   H4  revoke update (qr_code) on public.devices from authenticated
--         (CLAUDE.md anti-pattern requires the set_device_qr_code RPC to
--         be the only sanctioned writer; without the column-revoke the
--         anti-pattern was documented but unenforced — see the precedent
--         from Story 3.3 / 00049 for `devices.status`).
--
--   M17  set_device_qr_code raises P0002 on missing device, 22023 on
--        conflict, 22023 on length(p_qr_code) > 256 (was a single 22023
--        for both "device not found" and "qr_code conflict" — the caller
--        couldn't distinguish, so the toast read "QR-Code-Konflikt" even
--        when the device had been hard-deleted).
--   M24  length(p_qr_code) <= 256 hard ceiling.
--
--   M18  qr_label_runs.device_ids — DISTINCT check (was cardinality > 0
--        only; duplicate IDs silently inflated the generated
--        `device_count` and the PDF rendered the same device twice).
--
--   M22  before-insert trigger validating each device_ids[i] belongs to
--        article_id. CHECK constraints can't reference another table, so
--        a trigger is the only option.
--
-- Replay-safe via ALTER + drop/create-or-replace + drop policy if exists +
-- create policy. A second `supabase db push --linked` is a no-op.

-- =============================================================================
-- H2 — created_by default to auth.uid().
-- =============================================================================
alter table public.qr_label_runs
  alter column created_by set default auth.uid();

-- =============================================================================
-- H3 — created_by FK target → public.user_profiles(id).
-- =============================================================================
-- The existing FK from migration 00050 references auth.users(id). Drop it
-- and re-add pointing at public.user_profiles(id) (project convention —
-- user_profiles.id = auth.users.id, so existing rows still resolve).
alter table public.qr_label_runs
  drop constraint if exists qr_label_runs_created_by_fkey;

alter table public.qr_label_runs
  add constraint qr_label_runs_created_by_fkey
    foreign key (created_by)
    references public.user_profiles(id)
    on delete set null;

-- =============================================================================
-- H4 — revoke update (qr_code) on public.devices from authenticated.
-- =============================================================================
-- Mirrors the 00049 precedent (devices.status). After this, a direct
-- UPDATE devices SET qr_code = ... from a client returns 42501; the
-- set_device_qr_code RPC (00050 + this migration's M17 patch) is the only
-- sanctioned writer.
revoke update (qr_code) on public.devices from authenticated;

-- =============================================================================
-- M17 + M24 — set_device_qr_code: distinguish P0002 from 22023, cap length.
-- =============================================================================
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

  -- M24: defensive depth — devices.qr_code is `text` but Blue-Office
  -- payloads max around 32 chars; 256 is a generous ceiling.
  if length(p_qr_code) > 256 then
    raise exception 'set_device_qr_code: p_qr_code too long (% chars, max 256)', length(p_qr_code)
      using errcode = '22023';
  end if;

  -- M17: distinguish "device not found" (P0002) from "qr_code conflict"
  -- (22023) so the caller can surface a precise German toast.
  if not exists (select 1 from public.devices where id = p_device_id) then
    raise exception 'set_device_qr_code: device % not found', p_device_id
      using errcode = 'P0002';
  end if;

  update public.devices
     set qr_code = p_qr_code
   where id = p_device_id
     and (qr_code is null or qr_code = p_qr_code);

  if not found then
    raise exception 'set_device_qr_code: qr_code conflict for device %', p_device_id
      using errcode = '22023';
  end if;
end;
$$;

-- =============================================================================
-- M18 + M22 — combined BEFORE INSERT trigger.
-- =============================================================================
-- Two invariants enforced together (same per-row pass, same error class
-- conceptually — "device_ids is malformed"):
--
--   M18  device_ids must contain no duplicate UUIDs (a duplicate silently
--        inflates the generated `device_count` column and the PDF would
--        render the same device twice). Postgres CHECK constraints can't
--        contain subqueries (SQLSTATE 0A000) so this can't live in a CHECK.
--
--   M22  every device_ids[i] must belong to articles row article_id. CHECK
--        constraints also can't reference another table, so this can't be
--        a CHECK either. A trigger picks up both rules in one pass.

create or replace function public.qr_label_runs_validate_device_ids()
returns trigger
language plpgsql
as $$
declare
  v_invalid_count int;
  v_duplicate_count int;
begin
  -- M18: DISTINCT check.
  select cardinality(NEW.device_ids)
       - cardinality(array(select distinct unnest(NEW.device_ids)))
    into v_duplicate_count;

  if v_duplicate_count > 0 then
    raise exception
      'qr_label_runs: device_ids contains % duplicate id(s)',
      v_duplicate_count
      using errcode = '23514';
  end if;

  -- M22: membership check — every device_ids[i] belongs to article_id.
  select count(*)
    into v_invalid_count
    from unnest(NEW.device_ids) as did(id)
   where not exists (
     select 1 from public.devices d
      where d.id = did.id
        and d.article_id = NEW.article_id
   );

  if v_invalid_count > 0 then
    raise exception
      'qr_label_runs: % device(s) do not belong to article %',
      v_invalid_count, NEW.article_id
      using errcode = '23514';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_qr_label_runs_validate_device_ids
  on public.qr_label_runs;
create trigger trg_qr_label_runs_validate_device_ids
  before insert on public.qr_label_runs
  for each row execute function public.qr_label_runs_validate_device_ids();

-- Drop the legacy stub if a previous round of this migration created the
-- old name (idempotency for repeated --linked pushes).
drop trigger if exists trg_qr_label_runs_device_membership
  on public.qr_label_runs;
drop function if exists public.qr_label_runs_check_device_membership();

-- Functional smoke lives in scripts/smoke-3-7.sql (Cases A–N).
-- Migration is forward-only; no in-migration assertions.
