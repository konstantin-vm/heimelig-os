-- Migration 00023 — Customer-number generator + atomic create RPC.
-- Story 2.1 (Create & Edit Customer Records).
-- See _bmad-output/implementation-artifacts/2-1-create-edit-customer-records.md (AC5, AC6).
-- Q3 = Option A: 10-digit zero-padded sequence continuing above the highest known
-- Blue Office number (10031369). Start at 10100000 to leave headroom for migration.

-- Sequence --------------------------------------------------------------------

create sequence if not exists public.customer_number_seq
  as bigint
  minvalue 10000000
  start with 10100000
  increment by 1
  no cycle
  owned by public.customers.customer_number;

revoke all on sequence public.customer_number_seq from public, anon;
grant usage, select on sequence public.customer_number_seq to authenticated;

-- Generator function ----------------------------------------------------------

create or replace function public.gen_next_customer_number()
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select lpad(nextval('public.customer_number_seq')::text, 10, '0');
$$;

revoke execute on function public.gen_next_customer_number() from public, anon;
grant execute on function public.gen_next_customer_number() to authenticated;

-- Apply as DEFAULT on customers.customer_number (was: NOT NULL UNIQUE without default).
alter table public.customers
  alter column customer_number set default public.gen_next_customer_number();

-- Atomic create RPC -----------------------------------------------------------
-- Inserts a customers row + primary customer_addresses row inside one transaction.
-- The audit_trigger_fn (Story 1.5) auto-emits two audit_log rows.
--
-- Security: SECURITY DEFINER + explicit role gate. Only admin + office may call;
-- technician/warehouse get permission denied. RLS on the underlying tables also
-- applies to the function-owner-acting-as-admin (force RLS is enabled), but the
-- explicit guard here is the primary contract.

create or replace function public.create_customer_with_primary_address(
  p_customer jsonb,
  p_address  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid;
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

  insert into public.customers (
    customer_number, customer_type, salutation, title,
    first_name, last_name, company_name, addressee_line,
    email, phone, mobile, date_of_birth,
    height_cm, weight_kg, language, marketing_consent,
    acquisition_channel, bexio_contact_id, bexio_sync_status,
    bexio_synced_at, notes, is_active, created_by, updated_by
  ) values (
    coalesce(nullif(p_customer ->> 'customer_number', ''), public.gen_next_customer_number()),
    coalesce(p_customer ->> 'customer_type', 'private'),
    nullif(p_customer ->> 'salutation', ''),
    nullif(p_customer ->> 'title', ''),
    nullif(p_customer ->> 'first_name', ''),
    nullif(p_customer ->> 'last_name', ''),
    nullif(p_customer ->> 'company_name', ''),
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

comment on function public.gen_next_customer_number() is
  'Story 2.1 — returns next 10-digit zero-padded customer_number from customer_number_seq. Q3 Option A.';

comment on function public.create_customer_with_primary_address(jsonb, jsonb) is
  'Story 2.1 — atomic insert of customers row + primary customer_addresses row. Role-gated to admin+office. audit_trigger_fn emits two audit_log rows automatically.';
