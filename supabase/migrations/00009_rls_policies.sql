-- Migration 00009 — RLS policies for all Sprint-1 tables.
-- Story 1.3. See data-model-spec.md §Rollen-Modell and Story 1.3 AC10 matrix.
--
-- Role matrix (all policies target `authenticated` role):
--   | Table               | admin | office | technician | warehouse          |
--   |---------------------|-------|--------|------------|--------------------|
--   | user_profiles       | ALL   | SELECT(all) + UPDATE self via view | SELECT(all) + UPDATE self | SELECT(all) + UPDATE self |
--   | customers           | ALL   | ALL    | DENY       | DENY               |
--   | customer_addresses  | ALL   | ALL    | DENY       | DENY               |
--   | customer_insurance  | ALL   | ALL    | DENY       | DENY               |
--   | contact_persons     | ALL   | ALL    | DENY       | DENY               |
--   | partner_insurers    | ALL   | SELECT | DENY       | DENY               |
--   | warehouses          | ALL   | ALL    | SELECT     | SELECT + UPDATE    |
--   | suppliers           | ALL   | ALL    | SELECT     | SELECT             |
--   | articles            | ALL   | ALL    | SELECT     | SELECT + INSERT + UPDATE |
--   | price_lists         | ALL   | ALL    | DENY       | DENY               |
--   | devices             | ALL   | ALL    | DENY       | SELECT + INSERT + UPDATE |
--
-- Hard-DELETE: admin only on every table. Office uses soft-delete via is_active.
-- Naming convention: {table}_{role}_{action}. No policy references auth.jwt()
-- directly; role checks go through is_admin()/is_office()/is_technician()/
-- is_warehouse() helpers (Migration 00001).

-- =============================================================================
-- user_profiles
-- =============================================================================

drop policy if exists user_profiles_admin_all               on public.user_profiles;
drop policy if exists user_profiles_authenticated_select    on public.user_profiles;
drop policy if exists user_profiles_self_update_limited     on public.user_profiles;

create policy user_profiles_admin_all on public.user_profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy user_profiles_authenticated_select on public.user_profiles
  for select to authenticated
  using (auth.uid() is not null);

create policy user_profiles_self_update_limited on public.user_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Column-whitelist enforcement for non-admin updates. Prevents non-admins from
-- changing email/name/app_role/etc via direct base-table updates (the view
-- `user_profiles_self` already hides those columns, but the trigger is the
-- defence-in-depth guard).
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

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.initials is distinct from old.initials
     or new.app_role is distinct from old.app_role
     or new.employee_id is distinct from old.employee_id
     or new.is_active is distinct from old.is_active
     or new.notes is distinct from old.notes
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by
  then
    raise exception 'Non-admin users may only update phone, mobile, display_name, color_hex, settings'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_user_profiles_self_update_guard on public.user_profiles;
create trigger trg_user_profiles_self_update_guard
  before update on public.user_profiles
  for each row execute function public.user_profiles_self_update_guard();

-- =============================================================================
-- customers
-- =============================================================================

drop policy if exists customers_admin_all      on public.customers;
drop policy if exists customers_office_select  on public.customers;
drop policy if exists customers_office_insert  on public.customers;
drop policy if exists customers_office_update  on public.customers;

create policy customers_admin_all on public.customers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy customers_office_select on public.customers
  for select to authenticated using (public.is_office());

create policy customers_office_insert on public.customers
  for insert to authenticated with check (public.is_office());

create policy customers_office_update on public.customers
  for update to authenticated using (public.is_office()) with check (public.is_office());

-- =============================================================================
-- customer_addresses
-- =============================================================================

drop policy if exists customer_addresses_admin_all      on public.customer_addresses;
drop policy if exists customer_addresses_office_select  on public.customer_addresses;
drop policy if exists customer_addresses_office_insert  on public.customer_addresses;
drop policy if exists customer_addresses_office_update  on public.customer_addresses;

create policy customer_addresses_admin_all on public.customer_addresses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy customer_addresses_office_select on public.customer_addresses
  for select to authenticated using (public.is_office());

create policy customer_addresses_office_insert on public.customer_addresses
  for insert to authenticated with check (public.is_office());

create policy customer_addresses_office_update on public.customer_addresses
  for update to authenticated using (public.is_office()) with check (public.is_office());

-- =============================================================================
-- customer_insurance
-- =============================================================================

drop policy if exists customer_insurance_admin_all      on public.customer_insurance;
drop policy if exists customer_insurance_office_select  on public.customer_insurance;
drop policy if exists customer_insurance_office_insert  on public.customer_insurance;
drop policy if exists customer_insurance_office_update  on public.customer_insurance;

create policy customer_insurance_admin_all on public.customer_insurance
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy customer_insurance_office_select on public.customer_insurance
  for select to authenticated using (public.is_office());

create policy customer_insurance_office_insert on public.customer_insurance
  for insert to authenticated with check (public.is_office());

create policy customer_insurance_office_update on public.customer_insurance
  for update to authenticated using (public.is_office()) with check (public.is_office());

-- =============================================================================
-- contact_persons
-- =============================================================================

drop policy if exists contact_persons_admin_all      on public.contact_persons;
drop policy if exists contact_persons_office_select  on public.contact_persons;
drop policy if exists contact_persons_office_insert  on public.contact_persons;
drop policy if exists contact_persons_office_update  on public.contact_persons;

create policy contact_persons_admin_all on public.contact_persons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy contact_persons_office_select on public.contact_persons
  for select to authenticated using (public.is_office());

create policy contact_persons_office_insert on public.contact_persons
  for insert to authenticated with check (public.is_office());

create policy contact_persons_office_update on public.contact_persons
  for update to authenticated using (public.is_office()) with check (public.is_office());

-- =============================================================================
-- partner_insurers  (Office read-only, master-data curated by admin)
-- =============================================================================

drop policy if exists partner_insurers_admin_all      on public.partner_insurers;
drop policy if exists partner_insurers_office_select  on public.partner_insurers;

create policy partner_insurers_admin_all on public.partner_insurers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy partner_insurers_office_select on public.partner_insurers
  for select to authenticated using (public.is_office());

-- =============================================================================
-- warehouses  (Office ALL, Technician SELECT, Warehouse SELECT + UPDATE)
-- =============================================================================

drop policy if exists warehouses_admin_all           on public.warehouses;
drop policy if exists warehouses_office_select       on public.warehouses;
drop policy if exists warehouses_office_insert       on public.warehouses;
drop policy if exists warehouses_office_update       on public.warehouses;
drop policy if exists warehouses_technician_select   on public.warehouses;
drop policy if exists warehouses_warehouse_select    on public.warehouses;
drop policy if exists warehouses_warehouse_update    on public.warehouses;

create policy warehouses_admin_all on public.warehouses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy warehouses_office_select on public.warehouses
  for select to authenticated using (public.is_office());

create policy warehouses_office_insert on public.warehouses
  for insert to authenticated with check (public.is_office());

create policy warehouses_office_update on public.warehouses
  for update to authenticated using (public.is_office()) with check (public.is_office());

create policy warehouses_technician_select on public.warehouses
  for select to authenticated using (public.is_technician());

create policy warehouses_warehouse_select on public.warehouses
  for select to authenticated using (public.is_warehouse());

create policy warehouses_warehouse_update on public.warehouses
  for update to authenticated using (public.is_warehouse()) with check (public.is_warehouse());

-- =============================================================================
-- suppliers  (Office ALL, Technician SELECT, Warehouse SELECT)
-- =============================================================================

drop policy if exists suppliers_admin_all           on public.suppliers;
drop policy if exists suppliers_office_select       on public.suppliers;
drop policy if exists suppliers_office_insert       on public.suppliers;
drop policy if exists suppliers_office_update       on public.suppliers;
drop policy if exists suppliers_technician_select   on public.suppliers;
drop policy if exists suppliers_warehouse_select    on public.suppliers;

create policy suppliers_admin_all on public.suppliers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy suppliers_office_select on public.suppliers
  for select to authenticated using (public.is_office());

create policy suppliers_office_insert on public.suppliers
  for insert to authenticated with check (public.is_office());

create policy suppliers_office_update on public.suppliers
  for update to authenticated using (public.is_office()) with check (public.is_office());

create policy suppliers_technician_select on public.suppliers
  for select to authenticated using (public.is_technician());

create policy suppliers_warehouse_select on public.suppliers
  for select to authenticated using (public.is_warehouse());

-- =============================================================================
-- articles
--   (Office ALL, Technician SELECT, Warehouse SELECT + INSERT + UPDATE)
-- =============================================================================

drop policy if exists articles_admin_all             on public.articles;
drop policy if exists articles_office_select         on public.articles;
drop policy if exists articles_office_insert         on public.articles;
drop policy if exists articles_office_update         on public.articles;
drop policy if exists articles_technician_select     on public.articles;
drop policy if exists articles_warehouse_select      on public.articles;
drop policy if exists articles_warehouse_insert      on public.articles;
drop policy if exists articles_warehouse_update      on public.articles;

create policy articles_admin_all on public.articles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy articles_office_select on public.articles
  for select to authenticated using (public.is_office());

create policy articles_office_insert on public.articles
  for insert to authenticated with check (public.is_office());

create policy articles_office_update on public.articles
  for update to authenticated using (public.is_office()) with check (public.is_office());

create policy articles_technician_select on public.articles
  for select to authenticated using (public.is_technician());

create policy articles_warehouse_select on public.articles
  for select to authenticated using (public.is_warehouse());

create policy articles_warehouse_insert on public.articles
  for insert to authenticated with check (public.is_warehouse());

create policy articles_warehouse_update on public.articles
  for update to authenticated using (public.is_warehouse()) with check (public.is_warehouse());

-- =============================================================================
-- price_lists  (Admin + Office only — price-sensitive)
-- =============================================================================

drop policy if exists price_lists_admin_all      on public.price_lists;
drop policy if exists price_lists_office_select  on public.price_lists;
drop policy if exists price_lists_office_insert  on public.price_lists;
drop policy if exists price_lists_office_update  on public.price_lists;

create policy price_lists_admin_all on public.price_lists
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy price_lists_office_select on public.price_lists
  for select to authenticated using (public.is_office());

create policy price_lists_office_insert on public.price_lists
  for insert to authenticated with check (public.is_office());

create policy price_lists_office_update on public.price_lists
  for update to authenticated using (public.is_office()) with check (public.is_office());

-- =============================================================================
-- devices  (Office ALL, Warehouse SELECT + INSERT + UPDATE)
--   Technician access comes in Epic 7/8 via tour_stops join.
-- =============================================================================

drop policy if exists devices_admin_all           on public.devices;
drop policy if exists devices_office_select       on public.devices;
drop policy if exists devices_office_insert       on public.devices;
drop policy if exists devices_office_update       on public.devices;
drop policy if exists devices_warehouse_select    on public.devices;
drop policy if exists devices_warehouse_insert    on public.devices;
drop policy if exists devices_warehouse_update    on public.devices;

create policy devices_admin_all on public.devices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy devices_office_select on public.devices
  for select to authenticated using (public.is_office());

create policy devices_office_insert on public.devices
  for insert to authenticated with check (public.is_office());

create policy devices_office_update on public.devices
  for update to authenticated using (public.is_office()) with check (public.is_office());

create policy devices_warehouse_select on public.devices
  for select to authenticated using (public.is_warehouse());

create policy devices_warehouse_insert on public.devices
  for insert to authenticated with check (public.is_warehouse());

create policy devices_warehouse_update on public.devices
  for update to authenticated using (public.is_warehouse()) with check (public.is_warehouse());
