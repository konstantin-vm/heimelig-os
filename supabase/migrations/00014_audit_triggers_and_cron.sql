-- Migration 00014 — generic audit trigger + binding to 11 Sprint-1 tables +
-- pg_cron purge of resolved error_log rows.
-- Story 1.5 (Audit Log & Error Log Infrastructure).
-- See data-model-spec.md §Audit-Pattern and epics.md Story 1.5 AC4/AC7/AC8.
--
-- Scope:
--   * public.audit_trigger_fn() — generic AFTER INSERT/UPDATE/DELETE trigger,
--     calls log_activity() with delta-only before/after values. Suppressed
--     columns come from TG_ARGV[]; for Sprint-1 we suppress updated_at +
--     updated_by to avoid noise when only the timestamp bumps.
--   * Bindings on the 11 Sprint-1 business tables, each guarded by
--     to_regclass() so a missing table doesn't break the migration.
--   * pg_cron extension + purge_resolved_error_log() function scheduled
--     nightly (UTC 03:30) to drop resolved error_log rows older than 90 days.
--
-- Rollback:
--   The trigger functions are CREATE OR REPLACE; the bindings use DROP
--   TRIGGER IF EXISTS + CREATE TRIGGER so re-running this migration is safe.
--   To disable auditing for a table, drop trg_<table>_audit manually — a
--   follow-up migration should record the intent rather than editing this
--   file.

-- =============================================================================
-- audit_trigger_fn() — generic delta-aware audit trigger.
-- =============================================================================

create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new       jsonb;
  v_old       jsonb;
  v_before    jsonb;
  v_after     jsonb;
  v_action    text;
  v_entity    text := tg_table_name;
  v_entity_id uuid;
  v_key       text;
  v_suppress  text[] := array[]::text[];
  v_i         int;
begin
  -- Collect suppressed columns from TG_ARGV.
  if coalesce(tg_nargs, 0) > 0 then
    for v_i in 0..(tg_nargs - 1) loop
      v_suppress := v_suppress || tg_argv[v_i];
    end loop;
  end if;

  if tg_op = 'INSERT' then
    v_action := v_entity || '_created';
    v_new := to_jsonb(new) - v_suppress;
    v_after := v_new;
    v_before := null;
    v_entity_id := (to_jsonb(new) ->> 'id')::uuid;

  elsif tg_op = 'DELETE' then
    v_action := v_entity || '_deleted';
    v_old := to_jsonb(old) - v_suppress;
    v_before := v_old;
    v_after := null;
    v_entity_id := (to_jsonb(old) ->> 'id')::uuid;

  else -- UPDATE
    v_action := v_entity || '_updated';
    v_new := to_jsonb(new) - v_suppress;
    v_old := to_jsonb(old) - v_suppress;

    v_before := '{}'::jsonb;
    v_after  := '{}'::jsonb;

    -- Keys present in NEW whose value differs from OLD (including newly
    -- added keys where OLD lacks them).
    for v_key in select jsonb_object_keys(v_new) loop
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
        v_after  := v_after  || jsonb_build_object(v_key, v_new -> v_key);
      end if;
    end loop;

    -- Keys present in OLD but removed from NEW (schema drift safety).
    for v_key in select jsonb_object_keys(v_old) loop
      if not (v_new ? v_key) then
        v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
        v_after  := v_after  || jsonb_build_object(v_key, null);
      end if;
    end loop;

    -- If nothing changed outside the suppressed columns, skip the audit row.
    if v_before = '{}'::jsonb and v_after = '{}'::jsonb then
      return new;
    end if;

    v_entity_id := (to_jsonb(new) ->> 'id')::uuid;
  end if;

  perform public.log_activity(
    v_action, v_entity, v_entity_id,
    v_before, v_after,
    jsonb_build_object('tg_op', tg_op)
  );

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

comment on function public.audit_trigger_fn() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger. Calls log_activity() with delta-only before/after values. Suppressed columns come from TG_ARGV[]. Audit-First rule: any log_activity failure propagates and rolls back the business transaction.';

-- =============================================================================
-- Bind trg_<table>_audit to the 11 Sprint-1 business tables.
-- Suppress updated_at + updated_by to avoid pure-timestamp noise rows.
-- =============================================================================

do $$
declare
  v_tables text[] := array[
    'user_profiles','partner_insurers','warehouses','suppliers',
    'customers','customer_addresses','customer_insurance','contact_persons',
    'articles','price_lists','devices'
  ];
  v_t text;
begin
  foreach v_t in array v_tables loop
    if to_regclass(format('public.%I', v_t)) is null then
      continue;
    end if;

    execute format('drop trigger if exists trg_%I_audit on public.%I;', v_t, v_t);
    execute format(
      'create trigger trg_%I_audit
         after insert or update or delete on public.%I
         for each row execute function public.audit_trigger_fn(%L, %L);',
      v_t, v_t, 'updated_at', 'updated_by'
    );
  end loop;
end $$;

-- =============================================================================
-- pg_cron — nightly purge of resolved error_log rows older than 90 days.
-- audit_log is NOT auto-purged (retention Q11 pending on 2026-04-29 weekly).
-- =============================================================================

create extension if not exists pg_cron;

create or replace function public.purge_resolved_error_log()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.error_log
   where resolved_at is not null
     and resolved_at < now() - interval '90 days';
  get diagnostics v_count = row_count;

  perform public.log_activity(
    'error_log_purged',
    'error_log',
    gen_random_uuid(),
    null,
    null,
    jsonb_build_object(
      'actor_system', 'pg_cron',
      'rows_deleted', v_count
    )
  );

  return v_count;
end;
$$;

revoke execute on function public.purge_resolved_error_log() from public, anon;
grant  execute on function public.purge_resolved_error_log() to service_role;

comment on function public.purge_resolved_error_log() is
  'Nightly pg_cron job (schedule: 03:30 UTC). Deletes error_log rows where resolved_at is not null and older than 90 days. Writes a single audit_log entry summarising the purge.';

-- Idempotent schedule: unschedule if present, then reschedule.
do $$
begin
  perform cron.unschedule('purge-resolved-error-log');
exception when others then
  -- Not scheduled yet (or extension not exposing cron schema) — ignore.
  null;
end $$;

select cron.schedule(
  'purge-resolved-error-log',
  '30 3 * * *',
  $cron$select public.purge_resolved_error_log();$cron$
);
