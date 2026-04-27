-- Migration 00013 — error_log table + log_error() + resolution guard.
-- Story 1.5 (Audit Log & Error Log Infrastructure).
-- See data-model-spec.md §5.9.4 and epics.md Story 1.5 AC2/AC5/AC6.
--
-- Scope:
--   * public.error_log table (jsonb details, RLS + FORCE).
--   * RLS: admin + office SELECT + UPDATE (resolution columns only).
--           No DELETE policy — purged only by purge_resolved_error_log().
--   * error_log_update_guard() trigger — rejects updates outside the
--     resolution-column whitelist (resolved_at, resolved_by, resolution_notes).
--   * public.log_error() SECURITY DEFINER — best-effort write path. Never
--     rolls back the surrounding business transaction on logging failure.
--
-- nDSG payload rule (enforced by reviewers, not SQL):
--   error_log.details MUST NOT contain raw customer PII (names, addresses,
--   insurance numbers, emails). Pass IDs + structured codes only. See
--   CLAUDE.md Anti-Patterns and heimelig-os/lib/utils/error-log.ts JSDoc.
--
-- Edge Function callability:
--   log_error() is callable from Supabase Edge Functions via service-role RPC
--   (`supabaseAdmin.rpc('log_error', { … })`). The future shared helper at
--   supabase/functions/_shared/error-logger.ts (Story 1.7 / Epic 6) wraps this
--   call. The function is GRANTed to service_role + authenticated; anon and
--   public are revoked.
--
-- SQLSTATE codes raised here:
--   * 42501 — UPDATE on non-resolution column (error_log_update_guard).

-- =============================================================================
-- error_log table
-- =============================================================================

create table if not exists public.error_log (
  id              uuid primary key default gen_random_uuid(),
  error_type      text not null check (error_type in (
    'BEXIO_API','RLS_VIOLATION','VALIDATION','EDGE_FUNCTION','DB_FUNCTION',
    'REALTIME','AUTH','MIGRATION','TOUR_PLANNING','INVENTORY','MAIL_PROVIDER',
    'EXTERNAL_API','OTHER'
  )),
  severity        text not null default 'error' check (severity in (
    'critical','error','warning','info'
  )),
  source          text not null,
  message         text not null,
  details         jsonb,
  user_id         uuid references public.user_profiles(id) on delete set null,
  entity          text,
  entity_id       uuid,
  request_id      text,
  resolved_at     timestamptz,
  resolved_by     uuid references public.user_profiles(id) on delete set null,
  resolution_notes text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_error_log_type
  on public.error_log (error_type, created_at desc);

create index if not exists idx_error_log_severity
  on public.error_log (severity, created_at desc);

create index if not exists idx_error_log_source
  on public.error_log (source, created_at desc);

create index if not exists idx_error_log_unresolved
  on public.error_log (created_at desc)
  where resolved_at is null;

alter table public.error_log enable row level security;
alter table public.error_log force  row level security;

-- =============================================================================
-- RLS policies
--   admin + office SELECT all rows.
--   admin + office UPDATE (trigger guards the column-set).
--   No INSERT policy → direct INSERT from authenticated is denied.
--     log_error() (SECURITY DEFINER) bypasses.
--   No DELETE policy → deletions only via purge_resolved_error_log() in 00014.
-- =============================================================================

drop policy if exists error_log_admin_select             on public.error_log;
drop policy if exists error_log_office_select            on public.error_log;
drop policy if exists error_log_admin_update_resolution  on public.error_log;
drop policy if exists error_log_office_update_resolution on public.error_log;

create policy error_log_admin_select on public.error_log
  for select to authenticated using (public.is_admin());

create policy error_log_office_select on public.error_log
  for select to authenticated using (public.is_office());

create policy error_log_admin_update_resolution on public.error_log
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy error_log_office_update_resolution on public.error_log
  for update to authenticated using (public.is_office()) with check (public.is_office());

-- =============================================================================
-- error_log_update_guard — column-whitelist enforcement.
-- Allows UPDATEs that mutate only the three resolution columns; anything else
-- raises 42501. Pattern mirrors user_profiles_self_update_guard.
-- =============================================================================

create or replace function public.error_log_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id          is distinct from old.id
     or new.error_type   is distinct from old.error_type
     or new.severity     is distinct from old.severity
     or new.source       is distinct from old.source
     or new.message      is distinct from old.message
     or new.details      is distinct from old.details
     or new.user_id      is distinct from old.user_id
     or new.entity       is distinct from old.entity
     or new.entity_id    is distinct from old.entity_id
     or new.request_id   is distinct from old.request_id
     or new.created_at   is distinct from old.created_at
  then
    raise exception 'error_log updates may only modify resolved_at, resolved_by, resolution_notes'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_error_log_update_guard on public.error_log;
create trigger trg_error_log_update_guard
  before update on public.error_log
  for each row execute function public.error_log_update_guard();

-- =============================================================================
-- log_error() — best-effort write path.
-- Wraps the INSERT in an EXCEPTION block so a logging failure never rolls
-- back the surrounding business transaction. Returns the new id on success or
-- NULL on failure.
-- =============================================================================

create or replace function public.log_error(
  p_error_type  text,
  p_severity    text,
  p_source      text,
  p_message     text,
  p_details     jsonb default '{}'::jsonb,
  p_entity      text  default null,
  p_entity_id   uuid  default null,
  p_request_id  text  default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  -- FK to user_profiles requires the row to exist. No-role authenticated
  -- users (no user_profiles entry) would otherwise hit a 23503; treat them
  -- as user_id = null and record the UUID in details at the caller's
  -- discretion.
  if v_user is not null
     and not exists (select 1 from public.user_profiles where id = v_user)
  then
    v_user := null;
  end if;

  begin
    insert into public.error_log (
      error_type, severity, source, message, details,
      user_id, entity, entity_id, request_id
    )
    values (
      p_error_type,
      coalesce(nullif(p_severity, ''), 'error'),
      p_source,
      p_message,
      coalesce(p_details, '{}'::jsonb),
      v_user,
      p_entity,
      p_entity_id,
      p_request_id
    )
    returning id into v_id;

    return v_id;
  exception when others then
    -- Best-effort: swallow the failure to protect the caller's transaction.
    -- PostgREST pg_notify payload lets a human operator notice that logging
    -- itself is broken without propagating the exception.
    perform pg_notify(
      'error_log_write_failed',
      jsonb_build_object(
        'source',     p_source,
        'error_type', p_error_type,
        'severity',   p_severity,
        'sqlstate',   sqlstate,
        'sqlerrm',    sqlerrm
      )::text
    );
    return null;
  end;
end;
$$;

revoke execute on function public.log_error(text, text, text, text, jsonb, text, uuid, text) from public, anon;
grant  execute on function public.log_error(text, text, text, text, jsonb, text, uuid, text) to authenticated, service_role;

comment on function public.log_error(text, text, text, text, jsonb, text, uuid, text) is
  'Best-effort error logger. Writes to error_log; on failure emits pg_notify("error_log_write_failed", …) and returns NULL. Never raises. nDSG rule: p_details MUST NOT contain raw customer PII — IDs + structured codes only.';
