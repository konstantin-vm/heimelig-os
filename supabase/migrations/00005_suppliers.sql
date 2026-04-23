-- Migration 00005 — suppliers (no seed).
-- Story 1.3. See data-model-spec.md §5.4.3.

create table if not exists public.suppliers (
  id                  uuid          primary key default gen_random_uuid(),
  supplier_number     text,
  name                text          not null,
  street              text,
  street_number       text,
  zip                 text,
  city                text,
  country             text          not null default 'CH' check (country in ('CH','FL','DE','AT','FR','IT')),
  phone               text,
  email               text,
  website             text,
  contact_person      text,
  bexio_supplier_id   integer,
  is_active           boolean       not null default true,
  notes               text,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),
  created_by          uuid          references public.user_profiles(id) on delete set null,
  updated_by          uuid          references public.user_profiles(id) on delete set null
);

create unique index if not exists idx_suppliers_supplier_number_unique
  on public.suppliers (supplier_number)
  where supplier_number is not null;

create unique index if not exists idx_suppliers_bexio_supplier_id_unique
  on public.suppliers (bexio_supplier_id)
  where bexio_supplier_id is not null;

alter table public.suppliers enable row level security;
alter table public.suppliers force row level security;

drop trigger if exists trg_suppliers_set_updated_at on public.suppliers;
create trigger trg_suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.suppliers to authenticated;
