-- Migration 00016 — Story 1.5 code-review fixes (round 2, CRITICAL).
-- Story 1.5 (Audit Log & Error Log Infrastructure).
--
-- Resolves the two CRITICAL FK-cascade conflicts surfaced in the round-1
-- review (P1, P2):
--
--   * audit_log.actor_user_id is `references user_profiles(id) on delete set
--     null`. Deleting a user_profiles row triggers a system-emitted UPDATE
--     setting actor_user_id from <uuid> to NULL. The existing
--     audit_log_immutable trigger blocks every UPDATE → admin cannot delete a
--     user with audit history (42501).
--
--   * error_log.user_id has the same FK shape. The existing
--     error_log_update_guard rejects any UPDATE that touches user_id (it is
--     not in the resolution-column whitelist). Same cascade-blocked outcome.
--
-- Fix shape (narrowest possible):
--
--   audit_log_reject_mutation() now allows ONE specific UPDATE: actor_user_id
--   transitioning from non-null → NULL with no other column changing. Every
--   other UPDATE (and every DELETE / TRUNCATE) still raises 42501.
--
--   error_log_update_guard() gains the same exception for user_id (and
--   resolved_by, which was already in the resolution-columns whitelist but
--   we make the cascade case explicit so reviewers see the intent).
--
-- Why a narrow exception (vs. NO ACTION FK / soft-delete)
-- -------------------------------------------------------
--   * NO ACTION would force the app to soft-delete user_profiles before
--     hard-delete, but Story 1.5 ships before any user-management UI exists.
--   * Soft-delete on user_profiles is a separate design decision (Story
--     9.x), not a Story 1.5 concern.
--   * The narrow exception preserves immutability for everything except the
--     one cascade the FK declaration explicitly invites. Forensic value is
--     unchanged: the actor_user_id was already documented in the row before
--     cascade nulled it; the row continues to exist and stay queryable.
--
-- Skipped patches that remain action items (see deferred-work.md):
--   * P9   — audit_trigger_fn UUID-PK cast: addressed via README +
--            function header documentation in this migration round, not via
--            a behavioural code change. Spec mandates UUID PKs for every
--            public table; non-UUID PK is itself a spec violation.
--   * P10/P15 — extend smoke matrix Cases G + H to all 11 tables: addressed
--               via scripts/smoke-1-5.sql edit (this round).
--
-- All operations are idempotent: re-running this migration produces no diff.

-- =============================================================================
-- audit_log_reject_mutation() — allow actor_user_id-only cascade-NULL.
--
-- The trigger function is bound to BOTH the row-level audit_log_immutable
-- trigger (BEFORE UPDATE OR DELETE) AND the statement-level
-- audit_log_no_truncate trigger (BEFORE TRUNCATE). For statement-level
-- triggers OLD/NEW are not bound, so the cascade-allow branch must be guarded
-- by `tg_op = 'UPDATE'` before referencing OLD/NEW.
-- =============================================================================

create or replace function public.audit_log_reject_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    -- FK ON DELETE SET NULL cascade on actor_user_id is the only sanctioned
    -- mutation. Detect by: actor_user_id transitions from non-null to null
    -- AND every other column is unchanged (is not distinct from).
    if old.actor_user_id is not null
       and new.actor_user_id is null
       and new.id            is not distinct from old.id
       and new.action        is not distinct from old.action
       and new.entity        is not distinct from old.entity
       and new.entity_id     is not distinct from old.entity_id
       and new.actor_system  is not distinct from old.actor_system
       and new.before_values is not distinct from old.before_values
       and new.after_values  is not distinct from old.after_values
       and new.details       is not distinct from old.details
       and new.ip_address    is not distinct from old.ip_address
       and new.user_agent    is not distinct from old.user_agent
       and new.request_id    is not distinct from old.request_id
       and new.created_at    is not distinct from old.created_at
    then
      return new;
    end if;
  end if;

  raise exception 'audit_log rows are immutable (%)', tg_op
    using errcode = '42501';
end;
$$;

comment on function public.audit_log_reject_mutation() is
  'Blocks UPDATE/DELETE/TRUNCATE on audit_log with SQLSTATE 42501. Single sanctioned exception: FK ON DELETE SET NULL cascade on actor_user_id (single-column NULL transition, all other columns unchanged) so that user_profiles rows can be deleted without orphaning audit history.';

-- =============================================================================
-- error_log_update_guard() — allow user_id-only cascade-NULL.
-- resolved_by NULL transitions are already permitted because resolved_by is a
-- resolution column (whitelist).
-- =============================================================================

create or replace function public.error_log_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- FK ON DELETE SET NULL cascade on user_id: allow only if user_id flips
  -- from non-null to null AND every other column is unchanged.
  if old.user_id is not null
     and new.user_id is null
     and new.id          is not distinct from old.id
     and new.error_type  is not distinct from old.error_type
     and new.severity    is not distinct from old.severity
     and new.source      is not distinct from old.source
     and new.message     is not distinct from old.message
     and new.details     is not distinct from old.details
     and new.entity      is not distinct from old.entity
     and new.entity_id   is not distinct from old.entity_id
     and new.request_id  is not distinct from old.request_id
     and new.created_at  is not distinct from old.created_at
     and new.resolved_at      is not distinct from old.resolved_at
     and new.resolved_by      is not distinct from old.resolved_by
     and new.resolution_notes is not distinct from old.resolution_notes
  then
    return new;
  end if;

  -- Resolution-columns whitelist: any non-resolution column change raises.
  -- (resolved_by NULL cascade falls through this check unchanged because
  -- resolved_by is permitted to mutate.)
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

comment on function public.error_log_update_guard() is
  'BEFORE UPDATE guard: allows mutations on resolution columns (resolved_at, resolved_by, resolution_notes) and the FK ON DELETE SET NULL cascade on user_id. Anything else raises SQLSTATE 42501.';

-- =============================================================================
-- audit_trigger_fn() — header comment refresh documenting the UUID-PK
-- constraint. Body is unchanged from 00014; we re-emit the function so a
-- reader of the latest migration sees the documented contract.
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
  -- ---------------------------------------------------------------------------
  -- CONTRACT: bound table MUST have a UUID `id` primary key.
  -- ---------------------------------------------------------------------------
  -- This trigger writes entity_id by casting (to_jsonb(NEW/OLD) ->> 'id') to
  -- uuid. The data-model spec mandates UUID PKs (data-model-spec.md
  -- §Naming-Conventions; CLAUDE.md "DB primary keys") for every public table
  -- — so a non-UUID PK on a bound table is itself a spec violation.
  -- Reviewers reject migrations that create non-UUID PKs in public.* and
  -- the reserved-range workflow blocks shipping such tables. If a future
  -- table legitimately needs a non-UUID PK (e.g., a junction table without
  -- its own surrogate key), DO NOT bind audit_trigger_fn to it; either
  -- introduce a uuid surrogate column or write a per-table audit trigger.
  -- ---------------------------------------------------------------------------

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

    -- Keys present in NEW whose value differs from OLD.
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
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger. Calls log_activity() with delta-only before/after values. Suppressed columns come from TG_ARGV[]. Audit-First rule: any log_activity failure propagates and rolls back the business transaction. CONTRACT: bound table must have a UUID `id` primary key (data-model-spec mandate); do not bind to non-UUID PK tables.';
