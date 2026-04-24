-- Migration 00011 — Story 1.3 review fixes (round 2).
-- Derived from the Story 1.3 code review round 2 (2026-04-23).
--
-- Covers:
--   P1  customer_insurance: primary partial-unique index filtered by is_active
--       (soft-deleted rows no longer block new primaries).
--   P2  contact_persons: primary partial-unique index filtered by is_active.
--   P3  customer_addresses: default-per-type partial-unique index filtered by
--       is_active.
--   P4  customers_name_vs_type: reject empty-string last_name / company_name.
--   P5  user_profiles_self_update_guard: remove updated_by from blacklist,
--       rely solely on force-set (line was unreachable for non-admins).
--   P6  sync_auth_user_role: preserve existing is_active state on role change
--       instead of unconditionally reactivating.
--   P7  devices: BEFORE INSERT/UPDATE trigger rejects devices referencing
--       non-serialized articles.

-- P1 --------------------------------------------------------------------------
-- Soft-deleted insurance rows (is_active=false) must not occupy the primary slot.

drop index if exists public.idx_customer_insurance_primary_per_type_unique;

create unique index if not exists idx_customer_insurance_primary_per_type_unique
  on public.customer_insurance (customer_id, insurance_type)
  where is_primary and is_active;

-- P2 --------------------------------------------------------------------------

drop index if exists public.idx_contact_persons_primary_unique;

create unique index if not exists idx_contact_persons_primary_unique
  on public.contact_persons (customer_id)
  where is_primary_contact and is_active;

-- P3 --------------------------------------------------------------------------

drop index if exists public.idx_customer_addresses_default_per_type_unique;

create unique index if not exists idx_customer_addresses_default_per_type_unique
  on public.customer_addresses (customer_id, address_type)
  where is_default_for_type and is_active;

-- P4 --------------------------------------------------------------------------
-- Reject empty-string last_name (private) and company_name (institution).

alter table public.customers
  drop constraint if exists customers_name_vs_type;

alter table public.customers
  add constraint customers_name_vs_type check (
    (customer_type = 'private'     and char_length(btrim(coalesce(last_name, '')))    > 0)
    or (customer_type = 'institution' and char_length(btrim(coalesce(company_name, ''))) > 0)
  );

-- P5 --------------------------------------------------------------------------
-- Remove updated_by from the blacklist — the force-set at the end of the
-- function already handles it. Previously, a non-admin UPDATE that explicitly
-- changed updated_by was rejected before the force-set could fire (dead code).

create or replace function public.user_profiles_self_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'user_profiles.id is immutable'
      using errcode = '42501';
  end if;

  if new.email        is distinct from old.email
     or new.first_name   is distinct from old.first_name
     or new.last_name    is distinct from old.last_name
     or new.initials     is distinct from old.initials
     or new.app_role     is distinct from old.app_role
     or new.employee_id  is distinct from old.employee_id
     or new.is_active    is distinct from old.is_active
     or new.notes        is distinct from old.notes
     or new.created_at   is distinct from old.created_at
     or new.created_by   is distinct from old.created_by
  then
    raise exception 'Non-admin users may only update phone, mobile, display_name, color_hex, settings'
      using errcode = '42501';
  end if;

  new.updated_by := auth.uid();

  return new;
end;
$$;

-- P6 --------------------------------------------------------------------------
-- Preserve existing is_active state when a role change triggers the UPSERT.
-- Previously, is_active was unconditionally set to true, silently reactivating
-- users that were intentionally deactivated.

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
      update public.user_profiles
         set is_active  = false,
             updated_at = now()
       where id = new.id;
    else
      insert into public.user_profiles (id, email, app_role, is_active)
      values (new.id, new.email, v_role, true)
      on conflict (id) do update
        set app_role   = excluded.app_role,
            updated_at = now();
    end if;
  end if;
  return new;
end;
$$;

-- P7 --------------------------------------------------------------------------
-- Devices must reference serialized articles only.

create or replace function public.devices_check_article_serialized()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_serialized boolean;
begin
  select is_serialized into v_serialized
    from public.articles
   where id = new.article_id;

  if v_serialized is null then
    raise exception 'Article % not found', new.article_id
      using errcode = 'P0002';
  end if;

  if not v_serialized then
    raise exception 'Cannot create device for non-serialized article %', new.article_id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_devices_check_article_serialized on public.devices;
create trigger trg_devices_check_article_serialized
  before insert or update of article_id on public.devices
  for each row execute function public.devices_check_article_serialized();
