-- Migration 00004 — warehouses + seed.
-- Story 1.3. See data-model-spec.md §5.4.2.

create table if not exists public.warehouses (
  id                   uuid          primary key default gen_random_uuid(),
  code                 text          not null unique,
  name                 text          not null,
  description          text,
  street               text,
  street_number        text,
  zip                  text,
  city                 text,
  country              text          not null default 'CH' check (country in ('CH','FL','DE','AT','FR','IT')),
  lat                  numeric(9,6),
  lng                  numeric(9,6),
  is_active            boolean       not null default true,
  is_default_outbound  boolean       not null default false,
  is_default_inbound   boolean       not null default false,
  notes                text,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  created_by           uuid          references public.user_profiles(id) on delete set null,
  updated_by           uuid          references public.user_profiles(id) on delete set null
);

-- At most one default outbound and one default inbound warehouse at a time.
create unique index if not exists idx_warehouses_default_outbound_unique
  on public.warehouses ((true))
  where is_default_outbound;

create unique index if not exists idx_warehouses_default_inbound_unique
  on public.warehouses ((true))
  where is_default_inbound;

alter table public.warehouses enable row level security;
alter table public.warehouses force row level security;

drop trigger if exists trg_warehouses_set_updated_at on public.warehouses;
create trigger trg_warehouses_set_updated_at
  before update on public.warehouses
  for each row execute function public.set_updated_at();

-- Seed: the two Blue-Office warehouses (Bürglen). Idempotent via unique code.
insert into public.warehouses (code, name, is_default_inbound, is_default_outbound, is_active)
values
  ('BG-NEU', 'Bürglen Neugeräte', false, false, true),
  ('BG-MIT', 'Bürglen Mietpool',  true,  true,  true)
on conflict (code) do nothing;

grant select, insert, update, delete on public.warehouses to authenticated;
