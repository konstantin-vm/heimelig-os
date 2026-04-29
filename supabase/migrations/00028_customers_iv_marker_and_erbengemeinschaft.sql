-- Migration 00028 — Story 2.1.1 (MTG-009 follow-up, 2026-04-28).
-- See _bmad-output/implementation-artifacts/2-1-1-iv-marker-erbengemeinschaft.md.
--
-- Three additive changes to the customer domain:
--   1. customers.iv_marker boolean NOT NULL default false — tags IV
--      (Invalidenversicherung) cases.
--   2. customers.iv_dossier_number text — free-form dossier reference
--      (e.g. "320/2025/004391/0"). CHECK couples it to iv_marker so a flagged
--      customer always has a dossier number.
--   3. Salutation enum extension on customers + contact_persons: adds
--      'erbengemeinschaft' to the CHECK list. Auto-switch on contract
--      termination via Rückgabegrund=Todesfall is owned by Story 5.3 — this
--      migration only ensures the value is accepted.
--
-- Also re-emits `create_customer_with_primary_address` and
-- `update_customer_with_primary_address` (last shipped in 00029) to thread
-- the two new IV columns through the atomic create + update RPCs. The
-- salutation column is already wired into both functions via the generic
-- `nullif(p_customer ->> 'salutation', '')` path, so no change needed there.
--
-- Idempotency:
--   - ADD COLUMN uses IF NOT EXISTS.
--   - ADD CONSTRAINT is wrapped in a DO block + pg_constraint lookup so a
--     replay does not raise.
--   - CREATE INDEX uses IF NOT EXISTS.
--   - The salutation CHECKs are auto-named (`customers_salutation_check`,
--     `contact_persons_salutation_check`); we DROP IF EXISTS the auto name
--     and the explicit name we are about to add, then ADD with the explicit
--     name so a re-run does not duplicate.
--   - `create or replace function` is idempotent by definition.

-- ---------------------------------------------------------------------------
-- 1. customers — IV columns + CHECK + partial index
-- ---------------------------------------------------------------------------

alter table public.customers
  add column if not exists iv_marker boolean not null default false;

alter table public.customers
  add column if not exists iv_dossier_number text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'customers_iv_dossier_required'
       and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_iv_dossier_required
        check (iv_marker = false or iv_dossier_number is not null);
  end if;
end$$;

create index if not exists idx_customers_iv_marker
  on public.customers (id)
  where iv_marker;

-- ---------------------------------------------------------------------------
-- 2. customers.salutation — extend CHECK with 'erbengemeinschaft'
-- ---------------------------------------------------------------------------
-- The original inline CHECK from 00006 was auto-named
-- `customers_salutation_check`. We drop the auto name AND the explicit name
-- we are about to add (covers replay), then re-add with the explicit name.

alter table public.customers
  drop constraint if exists customers_salutation_check;

alter table public.customers
  drop constraint if exists customers_salutation_allowed;

alter table public.customers
  add constraint customers_salutation_allowed
    check (
      salutation is null
      or salutation in ('herr','frau','divers','erbengemeinschaft')
    );

-- ---------------------------------------------------------------------------
-- 3. contact_persons.salutation — extend CHECK with 'erbengemeinschaft'
-- ---------------------------------------------------------------------------

alter table public.contact_persons
  drop constraint if exists contact_persons_salutation_check;

alter table public.contact_persons
  drop constraint if exists contact_persons_salutation_allowed;

alter table public.contact_persons
  add constraint contact_persons_salutation_allowed
    check (
      salutation is null
      or salutation in ('herr','frau','divers','erbengemeinschaft')
    );

-- ---------------------------------------------------------------------------
-- 4. create_customer_with_primary_address — thread iv_marker + iv_dossier_number
-- ---------------------------------------------------------------------------
-- Re-emits the function last shipped in 00025. Body identical except for the
-- two new IV columns in the customers INSERT. Address upsert + role gate are
-- unchanged.

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

  if nullif(p_address ->> 'street', '') is null then
    raise exception 'address.street must not be empty' using errcode = '22023';
  end if;
  if nullif(p_address ->> 'zip', '') is null then
    raise exception 'address.zip must not be empty' using errcode = '22023';
  end if;
  if nullif(p_address ->> 'city', '') is null then
    raise exception 'address.city must not be empty' using errcode = '22023';
  end if;

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
    bexio_synced_at, notes, is_active,
    iv_marker, iv_dossier_number,
    created_by, updated_by
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
    coalesce((p_customer ->> 'iv_marker')::boolean, false),
    nullif(p_customer ->> 'iv_dossier_number', ''),
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

comment on function public.create_customer_with_primary_address(jsonb, jsonb) is
  'Story 2.1.1 (00028) — atomic create on customers + primary customer_addresses. Threads iv_marker + iv_dossier_number alongside existing columns.';

-- ---------------------------------------------------------------------------
-- 5. update_customer_with_primary_address — thread iv_marker + iv_dossier_number
-- ---------------------------------------------------------------------------
-- Re-emits the function last shipped in 00029. Body identical except for the
-- two new IV columns added to the customers UPDATE SET clause with the
-- case-when key-presence guard pattern (P1 from Round 3).

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
    iv_marker            = case when p_customer ? 'iv_marker' then (p_customer ->> 'iv_marker')::boolean else c.iv_marker end,
    iv_dossier_number    = case when p_customer ? 'iv_dossier_number' then nullif(p_customer ->> 'iv_dossier_number', '') else c.iv_dossier_number end,
    updated_by           = auth.uid()
  where c.id = p_id;

  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    raise exception 'customer update affected 0 rows (RLS denial or row gone)'
      using errcode = '42501';
  end if;

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
  'Story 2.1.1 (00028) — atomic update on customers + upsert on primary customer_addresses. Threads iv_marker + iv_dossier_number through the case-when key-presence guard pattern (absent keys preserve existing values).';
