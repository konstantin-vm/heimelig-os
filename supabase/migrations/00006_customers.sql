-- Migration 00006 — Customer domain.
-- Story 1.3. See data-model-spec.md §5.2.
-- Tables: customers, customer_addresses, customer_insurance, contact_persons.

-- customers -------------------------------------------------------------------

create table if not exists public.customers (
  id                   uuid          primary key default gen_random_uuid(),
  customer_number      text          not null unique,
  customer_type        text          not null default 'private'
                                      check (customer_type in ('private','institution')),
  salutation           text          check (salutation is null or salutation in ('herr','frau','divers')),
  title                text,
  first_name           text,
  last_name            text,
  company_name         text,
  addressee_line       text,
  email                text,
  phone                text,
  mobile               text,
  date_of_birth        date,
  height_cm            integer       check (height_cm is null or (height_cm > 0 and height_cm < 260)),
  weight_kg            numeric(5,1)  check (weight_kg is null or (weight_kg > 0 and weight_kg < 350)),
  language             text          not null default 'de' check (language in ('de','fr','it','en')),
  marketing_consent    boolean       not null default false,
  acquisition_channel  text          check (
                                      acquisition_channel is null
                                      or acquisition_channel in (
                                        'spitex','sozialdienst_spital','google','ki','empfehlung',
                                        'wiederholer','arzt_therapeut','shopify','sonstige')),
  bexio_contact_id     integer,
  bexio_sync_status    text          not null default 'pending'
                                      check (bexio_sync_status in ('pending','synced','failed','local_only')),
  bexio_synced_at      timestamptz,
  notes                text,
  is_active            boolean       not null default true,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  created_by           uuid          references public.user_profiles(id) on delete set null,
  updated_by           uuid          references public.user_profiles(id) on delete set null,
  constraint customers_name_vs_type check (
    (customer_type = 'private'     and last_name    is not null)
    or (customer_type = 'institution' and company_name is not null)
  )
);

create        index if not exists idx_customers_last_name       on public.customers (last_name);
create        index if not exists idx_customers_company_name    on public.customers (company_name);
create        index if not exists idx_customers_email           on public.customers (email);
create unique index if not exists idx_customers_bexio_contact_id_unique
  on public.customers (bexio_contact_id)
  where bexio_contact_id is not null;

alter table public.customers enable row level security;
alter table public.customers force row level security;

drop trigger if exists trg_customers_set_updated_at on public.customers;
create trigger trg_customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- customer_addresses ----------------------------------------------------------

create table if not exists public.customer_addresses (
  id                    uuid         primary key default gen_random_uuid(),
  customer_id           uuid         not null references public.customers(id) on delete cascade,
  address_type          text         not null check (address_type in ('primary','delivery','billing','other')),
  is_default_for_type   boolean      not null default true,
  recipient_name        text,
  street                text         not null,
  street_number         text,
  zip                   text         not null,
  city                  text         not null,
  country               text         not null default 'CH' check (country in ('CH','FL','DE','AT','FR','IT')),
  floor                 text         check (floor is null or floor in ('UG','EG','1.OG','2.OG','3.OG','4.OG','5.OG+')),
  has_elevator          text         check (has_elevator is null or has_elevator in ('ja','nein','unbekannt')),
  access_notes          text,
  lat                   numeric(9,6),
  lng                   numeric(9,6),
  geocoded_at           timestamptz,
  is_active             boolean      not null default true,
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now(),
  created_by            uuid         references public.user_profiles(id) on delete set null,
  updated_by            uuid         references public.user_profiles(id) on delete set null
);

create index if not exists idx_customer_addresses_customer_id
  on public.customer_addresses (customer_id);

create unique index if not exists idx_customer_addresses_default_per_type_unique
  on public.customer_addresses (customer_id, address_type)
  where is_default_for_type;

alter table public.customer_addresses enable row level security;
alter table public.customer_addresses force row level security;

drop trigger if exists trg_customer_addresses_set_updated_at on public.customer_addresses;
create trigger trg_customer_addresses_set_updated_at
  before update on public.customer_addresses
  for each row execute function public.set_updated_at();

-- customer_insurance ----------------------------------------------------------

create table if not exists public.customer_insurance (
  id                     uuid         primary key default gen_random_uuid(),
  customer_id            uuid         not null references public.customers(id) on delete cascade,
  partner_insurer_id     uuid         references public.partner_insurers(id) on delete set null,
  insurer_name_freetext  text,
  insurance_type         text         not null default 'grund' check (insurance_type in ('grund','zusatz')),
  insurance_number       text,
  is_primary             boolean      not null default true,
  valid_from             date,
  valid_to               date,
  is_active              boolean      not null default true,
  created_at             timestamptz  not null default now(),
  updated_at             timestamptz  not null default now(),
  created_by             uuid         references public.user_profiles(id) on delete set null,
  updated_by             uuid         references public.user_profiles(id) on delete set null,
  constraint customer_insurance_insurer_required check (
    partner_insurer_id is not null or insurer_name_freetext is not null
  )
);

create index if not exists idx_customer_insurance_customer_id
  on public.customer_insurance (customer_id);

create unique index if not exists idx_customer_insurance_primary_grund_unique
  on public.customer_insurance (customer_id)
  where is_primary and insurance_type = 'grund';

alter table public.customer_insurance enable row level security;
alter table public.customer_insurance force row level security;

drop trigger if exists trg_customer_insurance_set_updated_at on public.customer_insurance;
create trigger trg_customer_insurance_set_updated_at
  before update on public.customer_insurance
  for each row execute function public.set_updated_at();

-- contact_persons -------------------------------------------------------------

create table if not exists public.contact_persons (
  id                   uuid         primary key default gen_random_uuid(),
  customer_id          uuid         not null references public.customers(id) on delete cascade,
  role                 text         not null check (role in (
                                      'angehoerige','spitex','sozialdienst','arzt',
                                      'heim','therapeut','sonstige')),
  salutation           text         check (salutation is null or salutation in ('herr','frau','divers')),
  title                text,
  first_name           text         not null,
  last_name            text         not null,
  organization         text,
  phone                text,
  email                text,
  notes                text,
  is_primary_contact   boolean      not null default false,
  is_active            boolean      not null default true,
  created_at           timestamptz  not null default now(),
  updated_at           timestamptz  not null default now(),
  created_by           uuid         references public.user_profiles(id) on delete set null,
  updated_by           uuid         references public.user_profiles(id) on delete set null
);

create index if not exists idx_contact_persons_customer_id
  on public.contact_persons (customer_id);

create unique index if not exists idx_contact_persons_primary_unique
  on public.contact_persons (customer_id)
  where is_primary_contact;

alter table public.contact_persons enable row level security;
alter table public.contact_persons force row level security;

drop trigger if exists trg_contact_persons_set_updated_at on public.contact_persons;
create trigger trg_contact_persons_set_updated_at
  before update on public.contact_persons
  for each row execute function public.set_updated_at();

-- Base grants (RLS policies come in Migration 00009).
grant select, insert, update, delete on public.customers           to authenticated;
grant select, insert, update, delete on public.customer_addresses  to authenticated;
grant select, insert, update, delete on public.customer_insurance  to authenticated;
grant select, insert, update, delete on public.contact_persons     to authenticated;
