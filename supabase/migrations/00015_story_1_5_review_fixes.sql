-- Migration 00015 — Story 1.5 code-review fixes (round 1).
-- Story 1.5 (Audit Log & Error Log Infrastructure).
--
-- Applies the patches from the 2026-04-27 code review on Story 1.5:
--   * P3  — error_log resolution policies: prevent forging resolved_by.
--   * P4  — audit_log immutability extended to TRUNCATE (statement-level trigger).
--   * P5  — purge_resolved_error_log() grant explicit to `postgres` role
--           (matches the role pg_cron jobs default to on Supabase).
--   * P7  — log_error() pg_notify wrapped in nested EXCEPTION block so
--           oversize-payload failures cannot defeat the best-effort promise.
--   * P8  — length CHECK constraints on audit_log.action/entity and
--           error_log.message/source/error_type/severity (RPC bypasses Zod).
--   * P14 — log_activity() trims whitespace around `x-forwarded-for` segments.
--
-- Skipped patches that require design decisions, tracked in deferred-work.md:
--   * P1/P2 — FK ON DELETE SET NULL conflicts with audit_log_immutable +
--             error_log_update_guard (admin cannot delete user_profiles rows).
--   * P6   — proxy.ts middleware blocking await on logError.
--   * P9   — audit_trigger_fn UUID cast guard for future non-UUID PKs.
--   * P10/P15 — extend smoke matrix Case G + H to all 11 Sprint-1 tables.
--
-- All operations are idempotent: re-running this migration produces no diff.

-- =============================================================================
-- P4 — audit_log_immutable extended to TRUNCATE.
-- =============================================================================
-- The existing BEFORE UPDATE OR DELETE trigger raises 42501 unconditionally.
-- TRUNCATE does not fire row-level triggers, so a separate STATEMENT-level
-- trigger is required. The same audit_log_reject_mutation() function works
-- because it never references NEW/OLD.

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_reject_mutation();

-- =============================================================================
-- P3 — error_log resolution policies: forbid forging resolved_by.
-- Office (and admin) can resolve in their own name or un-resolve (resolved_by
-- → null). They cannot attribute resolution to another user.
-- =============================================================================

drop policy if exists error_log_admin_update_resolution  on public.error_log;
drop policy if exists error_log_office_update_resolution on public.error_log;

create policy error_log_admin_update_resolution on public.error_log
  for update to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and (resolved_by is null or resolved_by = auth.uid())
  );

create policy error_log_office_update_resolution on public.error_log
  for update to authenticated
  using (public.is_office())
  with check (
    public.is_office()
    and (resolved_by is null or resolved_by = auth.uid())
  );

-- =============================================================================
-- P8 — length CHECK constraints on free-text audit/error columns.
-- RPC callers from SQL/Edge bypass the Zod layer; these caps prevent the
-- tables from growing unbounded payloads (e.g. a stack trace dumped into
-- error_log.message or audit_log.action).
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_audit_log_action_length'
       and conrelid = 'public.audit_log'::regclass
  ) then
    alter table public.audit_log
      add constraint chk_audit_log_action_length check (length(action) <= 64);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_audit_log_entity_length'
       and conrelid = 'public.audit_log'::regclass
  ) then
    alter table public.audit_log
      add constraint chk_audit_log_entity_length check (length(entity) <= 64);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_error_log_source_length'
       and conrelid = 'public.error_log'::regclass
  ) then
    alter table public.error_log
      add constraint chk_error_log_source_length check (length(source) <= 64);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_error_log_message_length'
       and conrelid = 'public.error_log'::regclass
  ) then
    alter table public.error_log
      add constraint chk_error_log_message_length check (length(message) <= 8000);
  end if;
end $$;

-- =============================================================================
-- P14 — log_activity(): trim whitespace around x-forwarded-for segments.
-- Replaces 00012's body. The only behaviour change is `btrim()` around the
-- first XFF segment so that "  10.0.0.1 , 10.0.0.2" parses correctly.
-- =============================================================================

create or replace function public.log_activity(
  p_action    text,
  p_entity    text,
  p_entity_id uuid,
  p_before    jsonb default null,
  p_after     jsonb default null,
  p_details   jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user  uuid := auth.uid();
  v_actor_sys   text;
  v_headers     jsonb;
  v_ip          inet;
  v_ua          text;
  v_request_id  text;
  v_id          uuid;
begin
  if v_actor_user is not null
     and not exists (select 1 from public.user_profiles where id = v_actor_user)
  then
    v_actor_user := null;
  end if;

  if v_actor_user is null then
    v_actor_sys := nullif(p_details ->> 'actor_system', '');
    if v_actor_sys is null
       or v_actor_sys not in (
         'pg_cron','billing_run','payment_sync','contact_sync',
         'dunning_run','migration','other'
       )
    then
      v_actor_sys := 'other';
    end if;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  if v_headers is not null then
    begin
      v_ip := nullif(
        btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)),
        ''
      )::inet;
    exception when others then
      v_ip := null;
    end;
    v_ua         := nullif(v_headers ->> 'user-agent', '');
    v_request_id := coalesce(
      nullif(v_headers ->> 'x-request-id', ''),
      nullif(v_headers ->> 'request-id', '')
    );
  end if;

  insert into public.audit_log (
    action, entity, entity_id,
    actor_user_id, actor_system,
    before_values, after_values, details,
    ip_address, user_agent, request_id
  )
  values (
    p_action, p_entity, p_entity_id,
    v_actor_user, v_actor_sys,
    p_before, p_after, coalesce(p_details, '{}'::jsonb),
    v_ip, v_ua, v_request_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- =============================================================================
-- P7 — log_error(): wrap pg_notify in its own EXCEPTION block so a NOTIFY
-- failure (oversize payload, encoding error) cannot escape and roll back the
-- caller. Replaces 00013's body verbatim except for the nested handler.
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
    -- Nested handler: a pg_notify failure (e.g. >8000 byte payload) must not
    -- propagate. The outer best-effort contract requires us to swallow.
    begin
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
    exception when others then
      null;
    end;
    return null;
  end;
end;
$$;

-- =============================================================================
-- P5 — purge_resolved_error_log(): explicit GRANT to `postgres` so the
-- pg_cron worker (which runs as postgres on Supabase managed) can call the
-- function under any future role-hardening regime. postgres currently bypasses
-- grants as superuser, but the explicit grant makes the contract clear.
-- =============================================================================

grant execute on function public.purge_resolved_error_log() to postgres;
