-- Migration 00007 — Article domain.
-- Story 1.3. See data-model-spec.md §5.3.
-- Tables: articles, price_lists.

-- articles --------------------------------------------------------------------

create table if not exists public.articles (
  id                uuid          primary key default gen_random_uuid(),
  article_number    text          not null unique,
  name              text          not null,
  description       text,
  category          text          not null
                                  check (category in ('pflegebetten','mobilitaet','matratzen','zubehoer','moebel')),
  type              text          not null check (type in ('rental','purchase','service')),
  unit              text          not null check (unit in ('Mte','Stk.','Std.','Paar','Pauschal')),
  variant_of_id     uuid          references public.articles(id) on delete set null,
  variant_label     text,
  manufacturer      text,
  manufacturer_ref  text,
  weight_kg         numeric(10,2) check (weight_kg is null or weight_kg > 0),
  length_cm         integer       check (length_cm is null or length_cm > 0),
  width_cm          integer       check (width_cm  is null or width_cm  > 0),
  height_cm         integer       check (height_cm is null or height_cm > 0),
  purchase_price    numeric(10,2) check (purchase_price is null or purchase_price >= 0),
  min_stock         integer       check (min_stock      is null or min_stock      >= 0),
  is_serialized     boolean       not null default false,
  is_active         boolean       not null default true,
  bexio_article_id  integer,
  notes             text,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),
  created_by        uuid          references public.user_profiles(id) on delete set null,
  updated_by        uuid          references public.user_profiles(id) on delete set null
);

create        index if not exists idx_articles_category       on public.articles (category);
create        index if not exists idx_articles_type           on public.articles (type);
create        index if not exists idx_articles_variant_of_id  on public.articles (variant_of_id);
create        index if not exists idx_articles_is_active      on public.articles (is_active);
create unique index if not exists idx_articles_bexio_article_id_unique
  on public.articles (bexio_article_id)
  where bexio_article_id is not null;

-- Default is_serialized: rental → true when the client did not explicitly set
-- a value (INSERT omits the column or passes NULL). NULL is not a valid final
-- state (NOT NULL), so we resolve before the row is stored.
create or replace function public.articles_default_is_serialized()
returns trigger
language plpgsql
as $$
begin
  if new.is_serialized is null then
    new.is_serialized := (new.type = 'rental');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_articles_default_is_serialized on public.articles;
create trigger trg_articles_default_is_serialized
  before insert on public.articles
  for each row execute function public.articles_default_is_serialized();

alter table public.articles enable row level security;
alter table public.articles force row level security;

drop trigger if exists trg_articles_set_updated_at on public.articles;
create trigger trg_articles_set_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

-- price_lists -----------------------------------------------------------------

create table if not exists public.price_lists (
  id          uuid          primary key default gen_random_uuid(),
  article_id  uuid          not null references public.articles(id) on delete cascade,
  list_name   text          not null check (list_name in ('helsana','sanitas','visana','kpt','private')),
  amount      numeric(10,2) not null check (amount >= 0),
  currency    text          not null default 'CHF' check (currency = 'CHF'),
  valid_from  date          not null default current_date,
  valid_to    date,
  notes       text,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),
  created_by  uuid          references public.user_profiles(id) on delete set null,
  updated_by  uuid          references public.user_profiles(id) on delete set null,
  constraint price_lists_valid_range check (valid_to is null or valid_to >= valid_from),
  constraint price_lists_no_overlap exclude using gist (
    article_id with =,
    list_name  with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') with &&
  )
);

create index if not exists idx_price_lists_article_id on public.price_lists (article_id);
create index if not exists idx_price_lists_list_name  on public.price_lists (list_name);

alter table public.price_lists enable row level security;
alter table public.price_lists force row level security;

drop trigger if exists trg_price_lists_set_updated_at on public.price_lists;
create trigger trg_price_lists_set_updated_at
  before update on public.price_lists
  for each row execute function public.set_updated_at();

-- Base grants (RLS in Migration 00009).
grant select, insert, update, delete on public.articles    to authenticated;
grant select, insert, update, delete on public.price_lists to authenticated;
