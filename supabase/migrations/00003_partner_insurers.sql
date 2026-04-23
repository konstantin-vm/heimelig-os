-- Migration 00003 — partner_insurers + seed.
-- Story 1.3. See data-model-spec.md §5.2.5.

create table if not exists public.partner_insurers (
  id                         uuid          primary key default gen_random_uuid(),
  code                       text          not null unique check (code ~ '^[a-z_]+$'),
  name                       text          not null,
  max_monthly_reimbursement  numeric(10,2) not null default 81.10 check (max_monthly_reimbursement >= 0),
  bexio_contact_id           integer,
  billing_street             text,
  billing_street_number      text,
  billing_zip                text,
  billing_city               text,
  contact_email              text,
  contact_phone              text,
  is_active                  boolean       not null default true,
  notes                      text,
  created_at                 timestamptz   not null default now(),
  updated_at                 timestamptz   not null default now(),
  created_by                 uuid          references public.user_profiles(id) on delete set null,
  updated_by                 uuid          references public.user_profiles(id) on delete set null
);

create unique index if not exists idx_partner_insurers_bexio_contact_id_unique
  on public.partner_insurers (bexio_contact_id)
  where bexio_contact_id is not null;

alter table public.partner_insurers enable row level security;
alter table public.partner_insurers force row level security;

drop trigger if exists trg_partner_insurers_set_updated_at on public.partner_insurers;
create trigger trg_partner_insurers_set_updated_at
  before update on public.partner_insurers
  for each row execute function public.set_updated_at();

-- Seed: the 4 Swiss partner health insurers. Idempotent via unique code.
insert into public.partner_insurers (code, name, max_monthly_reimbursement, is_active)
values
  ('helsana', 'Helsana Versicherungen AG',  81.10, true),
  ('sanitas', 'Sanitas Krankenversicherung', 81.10, true),
  ('visana',  'Visana Services AG',          81.10, true),
  ('kpt',     'KPT Krankenkasse AG',         81.10, true)
on conflict (code) do nothing;

grant select, insert, update, delete on public.partner_insurers to authenticated;
