-- Migration 00026 — Story 2.1 review-of-review fix.
-- See _bmad-output/implementation-artifacts/2-1-create-edit-customer-records.md
-- under "### Review Findings" (round 2, run 2026-04-28).
--
-- Fix:
--   F:admin smoke regression — `update_customer_with_primary_address` (introduced
--   in 00025) used `ON CONFLICT (customer_id, address_type) WHERE (is_default_for_type = true)`
--   but the existing partial unique index `idx_customer_addresses_default_per_type_unique`
--   has the predicate `WHERE (is_default_for_type AND is_active)`. Postgres requires
--   the ON CONFLICT predicate to be wortgleich to the index predicate (it does not
--   prove logical equivalence) — so the resolver couldn't find a matching arbiter
--   and raised SQLSTATE 42P10 ("there is no unique or exclusion constraint matching
--   the ON CONFLICT specification") on every edit, breaking the entire customer
--   edit flow on Cloud.
--
-- Re-emit the function with the predicate aligned to the index. Body otherwise
-- identical to the 00025 version.

create or replace function public.update_customer_with_primary_address(
  p_id       uuid,
  p_customer jsonb,
  p_address  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_type text;
  v_last_name text;
  v_company_name text;
  v_existing_type text;
begin
  if not (public.is_admin() or public.is_office()) then
    raise exception 'permission denied: only admin or office may update customers'
      using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'p_id must not be null' using errcode = '22023';
  end if;
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then
    raise exception 'p_customer must be a JSON object' using errcode = '22023';
  end if;
  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise exception 'p_address must be a JSON object' using errcode = '22023';
  end if;

  if nullif(p_address ->> 'street', '') is null then
    raise exception 'address.street must not be empty' using errcode = '22023';
  end if;
  if nullif(p_address ->> 'zip', '') is null then
    raise exception 'address.zip must not be empty' using errcode = '22023';
  end if;
  if nullif(p_address ->> 'city', '') is null then
    raise exception 'address.city must not be empty' using errcode = '22023';
  end if;

  select customer_type into v_existing_type from public.customers where id = p_id;
  if v_existing_type is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  v_customer_type := coalesce(nullif(p_customer ->> 'customer_type', ''), v_existing_type);
  v_last_name := case
    when p_customer ? 'last_name' then nullif(p_customer ->> 'last_name', '')
    else (select last_name from public.customers where id = p_id)
  end;
  v_company_name := case
    when p_customer ? 'company_name' then nullif(p_customer ->> 'company_name', '')
    else (select company_name from public.customers where id = p_id)
  end;

  if v_customer_type = 'private' and v_last_name is null then
    raise exception 'private customer requires last_name' using errcode = '22023';
  end if;
  if v_customer_type = 'institution' and v_company_name is null then
    raise exception 'institution customer requires company_name' using errcode = '22023';
  end if;

  update public.customers c
  set
    customer_type        = coalesce(nullif(p_customer ->> 'customer_type', ''), c.customer_type),
    salutation           = case when p_customer ? 'salutation' then nullif(p_customer ->> 'salutation', '') else c.salutation end,
    title                = case when p_customer ? 'title' then nullif(p_customer ->> 'title', '') else c.title end,
    first_name           = case when p_customer ? 'first_name' then nullif(p_customer ->> 'first_name', '') else c.first_name end,
    last_name            = case when p_customer ? 'last_name' then nullif(p_customer ->> 'last_name', '') else c.last_name end,
    company_name         = case when p_customer ? 'company_name' then nullif(p_customer ->> 'company_name', '') else c.company_name end,
    addressee_line       = case when p_customer ? 'addressee_line' then nullif(p_customer ->> 'addressee_line', '') else c.addressee_line end,
    email                = case when p_customer ? 'email' then nullif(p_customer ->> 'email', '') else c.email end,
    phone                = case when p_customer ? 'phone' then nullif(p_customer ->> 'phone', '') else c.phone end,
    mobile               = case when p_customer ? 'mobile' then nullif(p_customer ->> 'mobile', '') else c.mobile end,
    date_of_birth        = case when p_customer ? 'date_of_birth' then nullif(p_customer ->> 'date_of_birth', '')::date else c.date_of_birth end,
    height_cm            = case when p_customer ? 'height_cm' then nullif(p_customer ->> 'height_cm', '')::integer else c.height_cm end,
    weight_kg            = case when p_customer ? 'weight_kg' then nullif(p_customer ->> 'weight_kg', '')::numeric(5,1) else c.weight_kg end,
    language             = coalesce(nullif(p_customer ->> 'language', ''), c.language),
    marketing_consent    = case when p_customer ? 'marketing_consent' then (p_customer ->> 'marketing_consent')::boolean else c.marketing_consent end,
    acquisition_channel  = case when p_customer ? 'acquisition_channel' then nullif(p_customer ->> 'acquisition_channel', '') else c.acquisition_channel end,
    bexio_sync_status    = case when p_customer ? 'bexio_sync_status' then coalesce(nullif(p_customer ->> 'bexio_sync_status', ''), c.bexio_sync_status) else c.bexio_sync_status end,
    notes                = case when p_customer ? 'notes' then nullif(p_customer ->> 'notes', '') else c.notes end,
    is_active            = case when p_customer ? 'is_active' then (p_customer ->> 'is_active')::boolean else c.is_active end,
    updated_by           = auth.uid()
  where c.id = p_id;

  -- Predicate aligned to idx_customer_addresses_default_per_type_unique.
  insert into public.customer_addresses (
    customer_id, address_type, is_default_for_type, recipient_name,
    street, street_number, zip, city, country,
    floor, has_elevator, access_notes,
    lat, lng, geocoded_at, is_active, created_by, updated_by
  ) values (
    p_id,
    'primary',
    true,
    nullif(p_address ->> 'recipient_name', ''),
    p_address ->> 'street',
    nullif(p_address ->> 'street_number', ''),
    p_address ->> 'zip',
    p_address ->> 'city',
    coalesce(nullif(p_address ->> 'country', ''), 'CH'),
    nullif(p_address ->> 'floor', ''),
    nullif(p_address ->> 'has_elevator', ''),
    nullif(p_address ->> 'access_notes', ''),
    nullif(p_address ->> 'lat', '')::numeric(9,6),
    nullif(p_address ->> 'lng', '')::numeric(9,6),
    nullif(p_address ->> 'geocoded_at', '')::timestamptz,
    coalesce((p_address ->> 'is_active')::boolean, true),
    auth.uid(),
    auth.uid()
  )
  on conflict (customer_id, address_type) where (is_default_for_type and is_active)
  do update set
    recipient_name = excluded.recipient_name,
    street         = excluded.street,
    street_number  = excluded.street_number,
    zip            = excluded.zip,
    city           = excluded.city,
    country        = excluded.country,
    floor          = excluded.floor,
    has_elevator   = excluded.has_elevator,
    access_notes   = excluded.access_notes,
    lat            = excluded.lat,
    lng            = excluded.lng,
    geocoded_at    = excluded.geocoded_at,
    is_active      = excluded.is_active,
    updated_by     = auth.uid();

  return p_id;
end;
$$;

revoke execute on function public.update_customer_with_primary_address(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_customer_with_primary_address(uuid, jsonb, jsonb) to authenticated;

comment on function public.update_customer_with_primary_address(uuid, jsonb, jsonb) is
  'Story 2.1 (review fix 00026) — atomic update on customers + upsert on primary customer_addresses. ON CONFLICT predicate aligned to idx_customer_addresses_default_per_type_unique. Two audit_log rows when both rows change.';
