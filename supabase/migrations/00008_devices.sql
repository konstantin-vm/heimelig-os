-- Migration 00008 — devices.
-- Story 1.3. See data-model-spec.md §5.4.1.

create table if not exists public.devices (
  id                         uuid          primary key default gen_random_uuid(),
  serial_number              text          not null unique,
  article_id                 uuid          not null references public.articles(id),
  qr_code                    text,
  status                     text          not null default 'available'
                                           check (status in ('available','rented','cleaning','repair','sold')),
  condition                  text          not null default 'gut'
                                           check (condition in ('gut','gebrauchsspuren','reparaturbeduerftig')),
  current_warehouse_id       uuid          references public.warehouses(id) on delete set null,
  -- FK constraint deferred to Story 5.x when `rental_contracts` is introduced.
  current_contract_id        uuid,
  supplier_id                uuid          references public.suppliers(id) on delete set null,
  inbound_date               date,
  outbound_date              date,
  acquired_at                date,
  acquisition_price          numeric(10,2) check (acquisition_price is null or acquisition_price >= 0),
  reserved_for_customer_id   uuid          references public.customers(id) on delete set null,
  reserved_at                timestamptz,
  retired_at                 date,
  notes                      text,
  created_at                 timestamptz   not null default now(),
  updated_at                 timestamptz   not null default now(),
  created_by                 uuid          references public.user_profiles(id) on delete set null,
  updated_by                 uuid          references public.user_profiles(id) on delete set null
);

create unique index if not exists idx_devices_qr_code_unique
  on public.devices (qr_code)
  where qr_code is not null;

create index if not exists idx_devices_article_id            on public.devices (article_id);
create index if not exists idx_devices_status                on public.devices (status);
create index if not exists idx_devices_current_warehouse_id  on public.devices (current_warehouse_id);
create index if not exists idx_devices_current_contract_id   on public.devices (current_contract_id);
create index if not exists idx_devices_reserved_for_customer on public.devices (reserved_for_customer_id);

alter table public.devices enable row level security;
alter table public.devices force row level security;

drop trigger if exists trg_devices_set_updated_at on public.devices;
create trigger trg_devices_set_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

-- Base grants (RLS in Migration 00009).
grant select, insert, update, delete on public.devices to authenticated;
