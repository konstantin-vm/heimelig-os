-- Migration 00029 — Story 2.1 review-of-review-of-review fix (Round 3, 2026-04-29).
-- See _bmad-output/implementation-artifacts/2-1-create-edit-customer-records.md
-- under "### Review Findings — Round 3".
--
-- Slot 00029 is consumed because 00027 (Story 2.3) and 00028 (Story 2.1.1) are
-- already reserved. Story 2.3 ships next under 00027 unchanged.
--
-- Five fixes:
--   P1 (HIGH) — `update_customer_with_primary_address` UPSERT DO UPDATE blindly
--   set every column from `excluded.*`, so a payload that did not include
--   recipient_name (the form sends `recipient_name: null` always) silently nulled
--   that column on every edit. Same shape would apply to any future field the
--   form leaves at null. Fix: case-when guard on every nullable column —
--   only overwrite when the caller actually included the key.
--
--   P2 (HIGH) — UPDATE on `customers` had no ROW_COUNT check. If RLS allowed the
--   existence-check SELECT but denied the UPDATE (asymmetric policy / archived
--   row visible-but-not-writable), the function silently returned `p_id` and
--   proceeded with the address upsert. Caller's success toast fired; the
--   customer columns were never persisted. Fix: GET DIAGNOSTICS + raise on 0
--   rows.
--
--   P5 (HIGH) — `customer_number` was never in the UPDATE SET clause and was not
--   stripped from the form payload. Today the form does not include the field,
--   but any future regression would silently no-op. Fix: raise on
--   `p_customer ? 'customer_number'` with errcode 22023 (immutable).
--
--   P6 (MEDIUM) — `gen_next_customer_number()` admin/office gate (added in 00025)
--   broke any caller without a JWT carrying `app_metadata.app_role` —
--   service_role from Edge Functions, pg_cron jobs, future Blue-Office
--   migration scripts. Fix: short-circuit on `auth.uid() IS NULL` (background
--   contexts) so the role check applies only to authenticated user sessions.
--
-- Body of `update_customer_with_primary_address` is otherwise identical to
-- 00026; this migration re-emits it whole because Postgres requires
-- `create or replace function` to repeat the entire body.

create or replace function public.gen_next_customer_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  -- Allow background callers (service_role, pg_cron, migration scripts)
  -- through unconditionally; only authenticated user sessions go through
  -- the admin/office app_role gate.
  if auth.uid() is not null then
    if not (public.is_admin() or public.is_office()) then
      raise exception 'permission denied: only admin or office may generate customer numbers'
        using errcode = '42501';
    end if;
  end if;

  v_next := nextval('public.customer_number_seq');
  return lpad(v_next::text, 10, '0');
end;
$$;

revoke execute on function public.gen_next_customer_number() from public, anon;
grant execute on function public.gen_next_customer_number() to authenticated, service_role;

comment on function public.gen_next_customer_number() is
  'Story 2.1 (review fix 00029) — admin/office gate applies only to authenticated user sessions; service_role + pg_cron + migration scripts (auth.uid() IS NULL) bypass.';


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
  v_row_count integer;
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

  -- P5: customer_number is immutable. Reject explicitly instead of silently
  -- ignoring the key.
  if p_customer ? 'customer_number' then
    raise exception 'customer_number is immutable' using errcode = '22023';
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
    bexio_synced_at      = case when p_customer ? 'bexio_synced_at' then nullif(p_customer ->> 'bexio_synced_at', '')::timestamptz else c.bexio_synced_at end,
    notes                = case when p_customer ? 'notes' then nullif(p_customer ->> 'notes', '') else c.notes end,
    is_active            = case when p_customer ? 'is_active' then (p_customer ->> 'is_active')::boolean else c.is_active end,
    updated_by           = auth.uid()
  where c.id = p_id;

  -- P2: explicit ROW_COUNT check. RLS-denied UPDATE silently affects 0 rows
  -- without raising; we must surface that as a hard failure so the address
  -- upsert never runs against an un-mutated customer.
  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    raise exception 'customer update affected 0 rows (RLS denial or row gone)'
      using errcode = '42501';
  end if;

  -- P1: case-when guards on every nullable column. Only overwrite when the
  -- caller included the key in p_address. excluded.col without a guard
  -- silently nulled fields the form left at null (e.g. recipient_name).
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
    -- Force is_active=true on the primary-default upsert path. The form
    -- never offers a UI to soft-delete the primary address; this guards
    -- against a hand-crafted RPC payload that would set is_active=false
    -- and then fall outside the partial-unique-index predicate, breaking
    -- the ON CONFLICT resolver.
    true,
    auth.uid(),
    auth.uid()
  )
  on conflict (customer_id, address_type) where (is_default_for_type and is_active)
  do update set
    recipient_name = case when p_address ? 'recipient_name' then excluded.recipient_name else customer_addresses.recipient_name end,
    street         = excluded.street,
    street_number  = case when p_address ? 'street_number' then excluded.street_number else customer_addresses.street_number end,
    zip            = excluded.zip,
    city           = excluded.city,
    country        = case when p_address ? 'country' then excluded.country else customer_addresses.country end,
    floor          = case when p_address ? 'floor' then excluded.floor else customer_addresses.floor end,
    has_elevator   = case when p_address ? 'has_elevator' then excluded.has_elevator else customer_addresses.has_elevator end,
    access_notes   = case when p_address ? 'access_notes' then excluded.access_notes else customer_addresses.access_notes end,
    lat            = case when p_address ? 'lat' then excluded.lat else customer_addresses.lat end,
    lng            = case when p_address ? 'lng' then excluded.lng else customer_addresses.lng end,
    geocoded_at    = case when p_address ? 'geocoded_at' then excluded.geocoded_at else customer_addresses.geocoded_at end,
    is_active      = customer_addresses.is_active,
    updated_by     = auth.uid();

  return p_id;
end;
$$;

revoke execute on function public.update_customer_with_primary_address(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_customer_with_primary_address(uuid, jsonb, jsonb) to authenticated;

comment on function public.update_customer_with_primary_address(uuid, jsonb, jsonb) is
  'Story 2.1 (review fix 00029) — atomic update on customers + upsert on primary customer_addresses. ROW_COUNT check on customers UPDATE; case-when guards on UPSERT DO UPDATE so absent keys do not silently null existing data; customer_number rejected as immutable.';
