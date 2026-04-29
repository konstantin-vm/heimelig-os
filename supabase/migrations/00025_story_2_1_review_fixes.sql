-- Migration 00025 — Story 2.1 code-review fixes.
-- See _bmad-output/implementation-artifacts/2-1-create-edit-customer-records.md
-- under "### Review Findings" (run 2026-04-28).
--
-- Fixes:
--   P2  — drop `pg_temp` from search_path on both SECURITY DEFINER functions
--         (PG-documented privilege-escalation footgun: low-priv user can
--         create a temp object that shadows a built-in name).
--   P17 — gate `gen_next_customer_number()` to admin/office only;
--         technician/warehouse can no longer advance the sequence.
--   P19 — `create_customer_with_primary_address()` adds explicit guards for
--         NULL street/zip/city + private+null last_name (raises 22023 with
--         a stable code instead of the underlying 23502/23514).
--   P3  — new `update_customer_with_primary_address(p_id, p_customer, p_address)`
--         RPC: atomic UPDATE on `customers` + UPSERT on the primary
--         `customer_addresses` row. Application now has a single transactional
--         path for edit, replacing the previous two-call (customer UPDATE +
--         address UPDATE-or-INSERT) flow that could half-commit on partial failure.

-- gen_next_customer_number — drop pg_temp, add role gate -----------------------

create or replace function public.gen_next_customer_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_office()) then
    raise exception 'permission denied: only admin or office may generate customer numbers'
      using errcode = '42501';
  end if;
  return lpad(nextval('public.customer_number_seq')::text, 10, '0');
end;
$$;

revoke execute on function public.gen_next_customer_number() from public, anon;
grant execute on function public.gen_next_customer_number() to authenticated;

-- create_customer_with_primary_address — drop pg_temp + explicit guards --------

create or replace function public.create_customer_with_primary_address(
  p_customer jsonb,
  p_address  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_customer_type text;
  v_last_name text;
  v_company_name text;
begin
  if not (public.is_admin() or public.is_office()) then
    raise exception 'permission denied: only admin or office may create customers'
      using errcode = '42501';
  end if;

  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then
    raise exception 'p_customer must be a JSON object' using errcode = '22023';
  end if;
  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise exception 'p_address must be a JSON object' using errcode = '22023';
  end if;

  -- Required address fields ----------------------------------------------------
  if nullif(p_address ->> 'street', '') is null then
    raise exception 'address.street must not be empty' using errcode = '22023';
  end if;
  if nullif(p_address ->> 'zip', '') is null then
    raise exception 'address.zip must not be empty' using errcode = '22023';
  end if;
  if nullif(p_address ->> 'city', '') is null then
    raise exception 'address.city must not be empty' using errcode = '22023';
  end if;

  -- Customer-type-specific name guard (private requires last_name,
  -- institution requires company_name). The customers_name_vs_type CHECK
  -- catches it too but raises a generic 23514; this is friendlier.
  v_customer_type := coalesce(p_customer ->> 'customer_type', 'private');
  v_last_name := nullif(p_customer ->> 'last_name', '');
  v_company_name := nullif(p_customer ->> 'company_name', '');

  if v_customer_type = 'private' and v_last_name is null then
    raise exception 'private customer requires last_name' using errcode = '22023';
  end if;
  if v_customer_type = 'institution' and v_company_name is null then
    raise exception 'institution customer requires company_name' using errcode = '22023';
  end if;

  insert into public.customers (
    customer_number, customer_type, salutation, title,
    first_name, last_name, company_name, addressee_line,
    email, phone, mobile, date_of_birth,
    height_cm, weight_kg, language, marketing_consent,
    acquisition_channel, bexio_contact_id, bexio_sync_status,
    bexio_synced_at, notes, is_active, created_by, updated_by
  ) values (
    coalesce(nullif(p_customer ->> 'customer_number', ''), public.gen_next_customer_number()),
    v_customer_type,
    nullif(p_customer ->> 'salutation', ''),
    nullif(p_customer ->> 'title', ''),
    nullif(p_customer ->> 'first_name', ''),
    v_last_name,
    v_company_name,
    nullif(p_customer ->> 'addressee_line', ''),
    nullif(p_customer ->> 'email', ''),
    nullif(p_customer ->> 'phone', ''),
    nullif(p_customer ->> 'mobile', ''),
    nullif(p_customer ->> 'date_of_birth', '')::date,
    nullif(p_customer ->> 'height_cm', '')::integer,
    nullif(p_customer ->> 'weight_kg', '')::numeric(5,1),
    coalesce(nullif(p_customer ->> 'language', ''), 'de'),
    coalesce((p_customer ->> 'marketing_consent')::boolean, false),
    nullif(p_customer ->> 'acquisition_channel', ''),
    nullif(p_customer ->> 'bexio_contact_id', '')::integer,
    coalesce(nullif(p_customer ->> 'bexio_sync_status', ''), 'pending'),
    nullif(p_customer ->> 'bexio_synced_at', '')::timestamptz,
    nullif(p_customer ->> 'notes', ''),
    coalesce((p_customer ->> 'is_active')::boolean, true),
    auth.uid(),
    auth.uid()
  )
  returning id into v_customer_id;

  insert into public.customer_addresses (
    customer_id, address_type, is_default_for_type, recipient_name,
    street, street_number, zip, city, country,
    floor, has_elevator, access_notes,
    lat, lng, geocoded_at, is_active, created_by, updated_by
  ) values (
    v_customer_id,
    coalesce(nullif(p_address ->> 'address_type', ''), 'primary'),
    coalesce((p_address ->> 'is_default_for_type')::boolean, true),
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
  );

  return v_customer_id;
end;
$$;

revoke execute on function public.create_customer_with_primary_address(jsonb, jsonb) from public, anon;
grant execute on function public.create_customer_with_primary_address(jsonb, jsonb) to authenticated;

-- Atomic update RPC -----------------------------------------------------------
-- Replaces the application-layer two-call (customer UPDATE + address
-- UPDATE-or-INSERT) flow with a single transaction. The `bexio_sync_status`
-- retrigger logic stays in the application: caller passes the desired value
-- (or omits the key to leave it unchanged). NULL values in jsonb sub-fields
-- are interpreted as "leave column unchanged" (json `null`) vs. "set to NULL"
-- (json string `""`), mirroring the create-RPC's `nullif(... ,'')` convention
-- but with explicit "unset" semantics via key-absence.
--
-- Address upsert key: (customer_id, address_type, is_default_for_type=true).
-- This naturally cooperates with the partial unique index
-- `idx_customer_addresses_default_per_type_unique` on the same triple.

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

  -- Address invariants (same as create) ---------------------------------------
  if nullif(p_address ->> 'street', '') is null then
    raise exception 'address.street must not be empty' using errcode = '22023';
  end if;
  if nullif(p_address ->> 'zip', '') is null then
    raise exception 'address.zip must not be empty' using errcode = '22023';
  end if;
  if nullif(p_address ->> 'city', '') is null then
    raise exception 'address.city must not be empty' using errcode = '22023';
  end if;

  -- Resolve the post-update customer_type (incoming or existing) so the
  -- name-vs-type guard matches the row that will be persisted.
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

  -- Customer UPDATE — only the keys present in p_customer are touched. -------
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

  -- Primary address UPSERT ----------------------------------------------------
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
  on conflict (customer_id, address_type) where (is_default_for_type = true)
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

comment on function public.gen_next_customer_number() is
  'Story 2.1 (review fix 00025) — admin/office-gated customer-number generator. 10-digit zero-padded.';

comment on function public.create_customer_with_primary_address(jsonb, jsonb) is
  'Story 2.1 (review fix 00025) — atomic create with NULL/name-vs-type guards. audit_trigger_fn emits two audit_log rows.';

comment on function public.update_customer_with_primary_address(uuid, jsonb, jsonb) is
  'Story 2.1 (review fix 00025) — atomic update on customers + upsert on primary customer_addresses. Two audit_log rows when both rows change.';
