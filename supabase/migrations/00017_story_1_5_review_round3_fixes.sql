-- Migration 00017 — Story 1.5 code-review fixes (round 3).
-- Story 1.5 (Audit Log & Error Log Infrastructure).
--
-- Resolves three issues surfaced in round-3 adversarial + acceptance review:
--
--   * H1 — error_log dual-cascade gap.
--     When the same user_profiles row was referenced by error_log.user_id
--     AND error_log.resolved_by simultaneously, Postgres issues a single
--     cascade UPDATE setting both columns to NULL. The 00016 cascade-allow
--     branch required `resolved_by is not distinct from old.resolved_by` →
--     fell through. The whitelist branch then saw `user_id is distinct
--     from old.user_id` → raised 42501. Realistic scenario: user logs a
--     warning via log_error, later resolves it themselves (resolved_by =
--     same uuid as user_id), then admin deletes the user.
--
--   * P9 — error_log_update_guard lacked tg_op early-return.
--     Defensive — would dereference unbound OLD/NEW if rebound to
--     BEFORE INSERT/DELETE in a future migration.
--
--   * P10 — audit_log_reject_mutation and error_log_update_guard had no
--     explicit SECURITY clause. Default SECURITY INVOKER was correct but
--     inconsistent with audit_trigger_fn (SECURITY DEFINER) and intransparent.
--
-- Fix shape (decomposed guard):
--
--   1. Immutable columns (any change → raise)
--   2. FK-cascade column (actor_user_id / user_id): only the non-null →
--      NULL transition is permitted; any other change → raise
--   3. Resolution columns (error_log only — resolved_at / resolved_by /
--      resolution_notes): free
--
-- This decomposition naturally handles the dual-cascade case (user_id AND
-- resolved_by both nulled simultaneously by the FK trigger) without a
-- special "dual cascade" branch — user_id passes the cascade test,
-- resolved_by is on the resolution whitelist.
--
-- All operations idempotent: re-running this migration produces no diff.

-- =============================================================================
-- audit_log_reject_mutation() — re-emit with tg_op early-return + explicit
-- SECURITY INVOKER + decomposed cascade-vs-immutable check.
--
-- Bound to BOTH the row-level audit_log_immutable trigger (BEFORE UPDATE OR
-- DELETE) AND the statement-level audit_log_no_truncate trigger
-- (BEFORE TRUNCATE). The non-UPDATE path (DELETE / TRUNCATE) raises 42501.
-- =============================================================================

create or replace function public.audit_log_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    -- 1. Immutable columns. Any change → reject.
    if new.id            is distinct from old.id
       or new.action        is distinct from old.action
       or new.entity        is distinct from old.entity
       or new.entity_id     is distinct from old.entity_id
       or new.actor_system  is distinct from old.actor_system
       or new.before_values is distinct from old.before_values
       or new.after_values  is distinct from old.after_values
       or new.details       is distinct from old.details
       or new.ip_address    is distinct from old.ip_address
       or new.user_agent    is distinct from old.user_agent
       or new.request_id    is distinct from old.request_id
       or new.created_at    is distinct from old.created_at
    then
      raise exception 'audit_log rows are immutable (%)', tg_op
        using errcode = '42501';
    end if;

    -- 2. actor_user_id: only the FK ON DELETE SET NULL cascade pattern is
    --    permitted (non-null → NULL). Any other change → reject.
    if new.actor_user_id is distinct from old.actor_user_id then
      if not (old.actor_user_id is not null and new.actor_user_id is null) then
        raise exception 'audit_log.actor_user_id may only be cleared via FK ON DELETE SET NULL cascade'
          using errcode = '42501';
      end if;
    end if;

    return new;
  end if;

  -- DELETE / TRUNCATE / unbound TG_OP all raise.
  raise exception 'audit_log rows are immutable (%)', tg_op
    using errcode = '42501';
end;
$$;

comment on function public.audit_log_reject_mutation() is
  'Blocks UPDATE/DELETE/TRUNCATE on audit_log with SQLSTATE 42501. Single sanctioned exception: FK ON DELETE SET NULL cascade on actor_user_id (non-null → NULL transition with all immutable columns unchanged). Allows admin to delete user_profiles rows without orphaning audit history. SECURITY INVOKER — guard runs in caller privileges so RLS still applies.';

-- =============================================================================
-- error_log_update_guard() — re-emit with tg_op early-return + decomposed
-- guard that handles the dual-cascade case (user_id + resolved_by both
-- nulled simultaneously).
--
-- The previous 00016 implementation rejected the dual case because its
-- cascade-allow branch demanded `resolved_by is not distinct from
-- old.resolved_by`. The new decomposition treats user_id (cascade-only)
-- and resolved_by (resolution whitelist) independently, so the dual case
-- passes through naturally.
-- =============================================================================

create or replace function public.error_log_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Defensive: this trigger is bound BEFORE UPDATE only, but if a future
  -- migration accidentally rebinds it to BEFORE INSERT/DELETE, OLD or NEW
  -- would be unbound. Early-return covers that case.
  if tg_op <> 'UPDATE' then
    return coalesce(new, old);
  end if;

  -- 1. Immutable columns. Any change → reject.
  if new.id          is distinct from old.id
     or new.error_type is distinct from old.error_type
     or new.severity   is distinct from old.severity
     or new.source     is distinct from old.source
     or new.message    is distinct from old.message
     or new.details    is distinct from old.details
     or new.entity     is distinct from old.entity
     or new.entity_id  is distinct from old.entity_id
     or new.request_id is distinct from old.request_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'error_log updates may only modify resolved_at, resolved_by, resolution_notes (or FK ON DELETE SET NULL on user_id)'
      using errcode = '42501';
  end if;

  -- 2. user_id: only the FK ON DELETE SET NULL cascade pattern is permitted
  --    (non-null → NULL). Any other change → reject.
  if new.user_id is distinct from old.user_id then
    if not (old.user_id is not null and new.user_id is null) then
      raise exception 'error_log.user_id may only be cleared via FK ON DELETE SET NULL cascade'
        using errcode = '42501';
    end if;
  end if;

  -- 3. resolved_at, resolved_by, resolution_notes: free (resolution
  --    whitelist). resolved_by also handles the FK cascade NULL transition
  --    transparently — no special branch needed. The dual-cascade case
  --    (user_id AND resolved_by both nulled simultaneously) is now
  --    permitted: user_id passes step 2, resolved_by passes step 3,
  --    immutable columns pass step 1.
  return new;
end;
$$;

comment on function public.error_log_update_guard() is
  'BEFORE UPDATE guard on error_log. Allows resolution-column mutations (resolved_at, resolved_by, resolution_notes) and the FK ON DELETE SET NULL cascade on user_id (non-null → NULL only). Naturally handles the dual-cascade case (user_id + resolved_by both nulled simultaneously) without a special branch. Anything else raises SQLSTATE 42501. SECURITY INVOKER.';
