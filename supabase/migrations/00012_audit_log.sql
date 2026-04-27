-- Migration 00012 — audit_log table + log_activity() + immutability trigger.
-- Story 1.5 (Audit Log & Error Log Infrastructure).
-- See data-model-spec.md §5.9.3 and epics.md Story 1.5.
--
-- Scope:
--   * public.audit_log table (append-only, jsonb before/after, Zürich).
--   * public.log_activity(action, entity, entity_id, before, after, details)
--     SECURITY DEFINER — the only sanctioned write path.
--   * audit_log_reject_mutation() + trigger audit_log_immutable — blocks every
--     UPDATE/DELETE on audit_log, including service_role.
--   * RLS: admin+office SELECT; no INSERT/UPDATE/DELETE policies (default DENY).
--
-- actor_user_id resolution:
--   * Reads auth.uid() when present (RLS-authenticated caller).
--   * When auth.uid() is NULL (service_role / pg_cron), actor_system is taken
--     from p_details ->> 'actor_system' if it matches the CHECK allowlist,
--     otherwise defaults to 'other'.
--
-- Request-header enrichment (ip_address, user_agent, request_id) is read from
-- the Supabase GUC `request.headers` — best-effort, NULL when unavailable
-- (e.g. psql / pg_cron).
--
-- SQLSTATE codes raised here:
--   * 42501 — audit_log row mutation attempt (immutability trigger).

-- =============================================================================
-- audit_log table
-- =============================================================================

create table if not exists public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  action          text not null,
  entity          text not null,
  entity_id       uuid not null,
  actor_user_id   uuid references public.user_profiles(id) on delete set null,
  actor_system    text check (
    actor_system is null or actor_system in (
      'pg_cron','billing_run','payment_sync','contact_sync','dunning_run','migration','other'
    )
  ),
  before_values   jsonb,
  after_values    jsonb,
  details         jsonb,
  ip_address      inet,
  user_agent      text,
  request_id      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_log_entity_lookup
  on public.audit_log (entity, entity_id, created_at desc);

create index if not exists idx_audit_log_actor
  on public.audit_log (actor_user_id, created_at desc);

create index if not exists idx_audit_log_action
  on public.audit_log (action, created_at desc);

create index if not exists idx_audit_log_created_at
  on public.audit_log (created_at desc);

alter table public.audit_log enable  row level security;
alter table public.audit_log force   row level security;

-- =============================================================================
-- RLS policies — admin + office SELECT only. No INSERT/UPDATE/DELETE policy →
-- default DENY for authenticated clients. log_activity() bypasses RLS via
-- SECURITY DEFINER.
-- =============================================================================

drop policy if exists audit_log_admin_select  on public.audit_log;
drop policy if exists audit_log_office_select on public.audit_log;

create policy audit_log_admin_select on public.audit_log
  for select to authenticated using (public.is_admin());

create policy audit_log_office_select on public.audit_log
  for select to authenticated using (public.is_office());

-- =============================================================================
-- log_activity() — sanctioned write path.
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
  -- If the JWT points at a user without a user_profiles row (e.g., a
  -- no-role authenticated user whose on_auth_user_created trigger did not
  -- fire), null the actor_user_id to satisfy the FK and fall back to
  -- actor_system = 'other'. This keeps logging best-effort even for edge
  -- cases like the proxy.ts "no_role_assigned" redirect.
  if v_actor_user is not null
     and not exists (select 1 from public.user_profiles where id = v_actor_user)
  then
    v_actor_user := null;
  end if;

  -- Resolve actor_system when no authenticated user is present.
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

  -- Best-effort request-header enrichment. Supabase exposes inbound HTTP
  -- headers via the `request.headers` GUC for SECURITY DEFINER functions.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  if v_headers is not null then
    -- `x-forwarded-for` may be a comma-separated list; take the first.
    begin
      v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
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

revoke execute on function public.log_activity(text, text, uuid, jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.log_activity(text, text, uuid, jsonb, jsonb, jsonb) to authenticated, service_role;

comment on function public.log_activity(text, text, uuid, jsonb, jsonb, jsonb) is
  'Sanctioned write path into audit_log. Resolves actor_user_id from auth.uid() or falls back to actor_system (pg_cron/billing_run/…). Writes inside the caller''s transaction — raising on failure is intentional (Audit-First rule).';

-- =============================================================================
-- Immutability trigger — defence-in-depth on top of RLS.
-- =============================================================================

create or replace function public.audit_log_reject_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit_log rows are immutable (%)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.audit_log_reject_mutation();
