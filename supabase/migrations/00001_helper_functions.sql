-- Migration 00001 — Helper functions, extensions, shared trigger fn.
-- Story 1.3 (RLS policies & core database setup).
-- See docs/internal/data-model-spec.md §Rollen-Modell → RLS-Helper-Functions.

-- Extensions ------------------------------------------------------------------

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists btree_gist; -- price_lists exclusion constraint

-- Role-reading helpers --------------------------------------------------------
-- All RLS policies MUST go through these helpers (never reference auth.jwt() directly)
-- so that a claim-path change requires only one update.

create or replace function public.current_app_role()
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(
    (auth.jwt() -> 'app_metadata' ->> 'app_role'),
    ''
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

create or replace function public.is_office()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() = 'office', false);
$$;

create or replace function public.is_technician()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() = 'technician', false);
$$;

create or replace function public.is_warehouse()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() = 'warehouse', false);
$$;

-- Restrict EXECUTE to authenticated role only.
revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.is_admin()         from public, anon;
revoke execute on function public.is_office()        from public, anon;
revoke execute on function public.is_technician()    from public, anon;
revoke execute on function public.is_warehouse()     from public, anon;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin()         to authenticated;
grant execute on function public.is_office()        to authenticated;
grant execute on function public.is_technician()    to authenticated;
grant execute on function public.is_warehouse()     to authenticated;

-- Shared `updated_at` trigger fn ---------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic BEFORE UPDATE trigger: refreshes updated_at to now().';
