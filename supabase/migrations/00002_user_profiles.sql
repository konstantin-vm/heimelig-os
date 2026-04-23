-- Migration 00002 — user_profiles + auth.users sync triggers + self view.
-- Story 1.3. See data-model-spec.md §5.1.

-- Table -----------------------------------------------------------------------

create table if not exists public.user_profiles (
  id            uuid        primary key references auth.users(id) on delete cascade,
  email         text        not null unique,
  first_name    text,
  last_name     text,
  display_name  text,
  initials      text        check (initials is null or char_length(initials) between 2 and 4),
  app_role      text        not null check (app_role in ('admin','office','technician','warehouse')),
  phone         text,
  mobile        text,
  employee_id   text,
  is_active     boolean     not null default true,
  color_hex     text        check (color_hex is null or color_hex ~ '^#[0-9a-fA-F]{6}$'),
  settings      jsonb       not null default '{}'::jsonb,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid        references public.user_profiles(id) on delete set null,
  updated_by    uuid        references public.user_profiles(id) on delete set null
);

create unique index if not exists idx_user_profiles_employee_id_unique
  on public.user_profiles (employee_id)
  where employee_id is not null;

alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;

drop trigger if exists trg_user_profiles_set_updated_at on public.user_profiles;
create trigger trg_user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- Auth sync triggers ----------------------------------------------------------
-- SECURITY DEFINER required: the triggers run on auth.users, owned by
-- supabase_auth_admin. Target role is the schema owner (postgres) so the
-- functions can read/write both auth.users and public.user_profiles.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := new.raw_app_meta_data ->> 'app_role';
begin
  -- Users without a role (e.g. the no-role dev account from Story 1.2) are
  -- intentionally skipped: the CHECK constraint would reject them, and they
  -- do not belong in the business user directory.
  if v_role is null or v_role not in ('admin','office','technician','warehouse') then
    return new;
  end if;

  insert into public.user_profiles (id, email, app_role)
  values (new.id, new.email, v_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.user_profiles
       set email = new.email,
           updated_at = now()
     where id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.sync_auth_user_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := new.raw_app_meta_data ->> 'app_role';
begin
  if (old.raw_app_meta_data ->> 'app_role') is distinct from v_role then
    if v_role is null or v_role not in ('admin','office','technician','warehouse') then
      -- Role removed or invalidated — soft-deactivate rather than delete so
      -- audit references stay intact. Admin can hard-delete via dashboard.
      update public.user_profiles
         set is_active  = false,
             updated_at = now()
       where id = new.id;
    else
      insert into public.user_profiles (id, email, app_role, is_active)
      values (new.id, new.email, v_role, true)
      on conflict (id) do update
        set app_role   = excluded.app_role,
            is_active  = true,
            updated_at = now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_auth_user_email();

drop trigger if exists on_auth_user_role_changed on auth.users;
create trigger on_auth_user_role_changed
  after update of raw_app_meta_data on auth.users
  for each row execute function public.sync_auth_user_role();

-- One-time backfill for existing auth.users (Story 1.2 dev users).
-- Idempotent via ON CONFLICT. The no-role user is intentionally skipped.
insert into public.user_profiles (id, email, app_role)
select u.id, u.email, (u.raw_app_meta_data ->> 'app_role')::text
  from auth.users u
 where (u.raw_app_meta_data ->> 'app_role') in ('admin','office','technician','warehouse')
on conflict (id) do nothing;

-- Self-edit view --------------------------------------------------------------
-- Exposes only fields a user may change on their own profile.
-- security_invoker = true: view enforces caller's RLS on the base table.

drop view if exists public.user_profiles_self cascade;
create view public.user_profiles_self
  with (security_invoker = true)
as
  select id, phone, mobile, display_name, color_hex, settings
    from public.user_profiles
   where id = auth.uid();

comment on view public.user_profiles_self is
  'Self-edit surface for authenticated users. Exposes only the five fields a '
  'user may change on their own profile: phone, mobile, display_name, '
  'color_hex, settings. Updates propagate to user_profiles via RLS policy '
  'user_profiles_self_update_limited (Migration 00009).';

-- Base-level grants (RLS added in Migration 00009).
grant select, update on public.user_profiles      to authenticated;
grant select, update on public.user_profiles_self to authenticated;
