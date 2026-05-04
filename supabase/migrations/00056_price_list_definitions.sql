-- Migration 00056 — Story 3.1.1 (Scalable Price-List Definitions).
--
-- David's kickoff wish (16.04.): "Ich kann selbst eine Preisliste hinzufügen,
-- relativ einfach." Today the 5 price lists (private + 4 KKs) are hard-coded
-- as a CHECK enum on `price_lists.list_name` (00007 line 77) and re-validated
-- inside `replace_price_list_entry` (00046 line 54) and
-- `create_article_with_prices` (00043 line 473). 00056 keeps the existing
-- text column untouched (forward-only safety, no data migration), and
-- introduces a side-table `price_list_definitions` that the UI reads to
-- render the price-list grid dynamically. The 5 system rows seed against the
-- existing slugs so every existing `price_lists` row has a matching
-- definition; a new FK column is added + back-filled but stays nullable for
-- now (the CHECK on `list_name` continues to gate writes — full FK
-- enforcement and the matching CHECK relaxation are scheduled for a follow-
-- up migration once the UI layer is fully cut over and tested in production).
--
-- System-list protection: `is_system=true` rows cannot be deleted and their
-- slug cannot be renamed — the existing app code, RPC arguments, and
-- contracts all reference the slugs as identifiers; renaming would break
-- write paths until 00043 / 00046 are updated. The `name`, `sort_order`, and
-- `is_active` columns of system rows are still freely editable so the
-- display label and ordering can adapt.
--
-- Replay safety: every step uses `if not exists` / `do $$ ... $$` guards so
-- a second `supabase db push --linked` is a no-op.

-- =============================================================================
-- 1. price_list_definitions table.
-- =============================================================================

create table if not exists public.price_list_definitions (
  id          uuid          primary key default gen_random_uuid(),
  slug        text          not null unique,
  name        text          not null,
  sort_order  integer       not null default 0,
  is_active   boolean       not null default true,
  is_system   boolean       not null default false,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),
  constraint price_list_definitions_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint price_list_definitions_name_nonempty
    check (length(trim(name)) > 0)
);

create index if not exists idx_price_list_definitions_active_sort
  on public.price_list_definitions (is_active, sort_order);

-- =============================================================================
-- 2. Seed the 5 system rows. Idempotent on replay (slug is unique).
-- =============================================================================

insert into public.price_list_definitions (slug, name, sort_order, is_system)
values
  ('private', 'Privat',  0, true),
  ('helsana', 'Helsana', 1, true),
  ('sanitas', 'Sanitas', 2, true),
  ('visana',  'Visana',  3, true),
  ('kpt',     'KPT',     4, true)
on conflict (slug) do nothing;

-- =============================================================================
-- 3. price_lists.price_list_definition_id FK (additive, nullable).
-- =============================================================================
-- Nullable for now: the existing CHECK on `price_lists.list_name` still
-- enforces the 5 known slugs, and writes go through the existing RPCs that
-- key off `list_name`. A follow-up migration will:
--   (a) add `price_list_definition_id not null`,
--   (b) drop the CHECK on `list_name`,
--   (c) re-emit the RPCs to look up the definition by slug or id.
-- Done in two passes so production traffic is never blocked on a long
-- back-fill / FK validation step.

alter table public.price_lists
  add column if not exists price_list_definition_id uuid;

update public.price_lists pl
   set price_list_definition_id = pld.id
  from public.price_list_definitions pld
 where pl.list_name = pld.slug
   and pl.price_list_definition_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'price_lists_definition_fk'
  ) then
    alter table public.price_lists
      add constraint price_lists_definition_fk
      foreign key (price_list_definition_id)
      references public.price_list_definitions(id)
      on delete restrict;
  end if;
end $$;

create index if not exists idx_price_lists_definition_id
  on public.price_lists (price_list_definition_id);

-- =============================================================================
-- 4. RLS — admin/office can SELECT, admin can INSERT/UPDATE/DELETE.
-- =============================================================================

alter table public.price_list_definitions enable row level security;
alter table public.price_list_definitions force row level security;

drop policy if exists price_list_definitions_select_admin_office
  on public.price_list_definitions;
create policy price_list_definitions_select_admin_office
  on public.price_list_definitions
  for select
  using (public.is_admin() or public.is_office());

drop policy if exists price_list_definitions_insert_admin
  on public.price_list_definitions;
create policy price_list_definitions_insert_admin
  on public.price_list_definitions
  for insert
  with check (public.is_admin());

drop policy if exists price_list_definitions_update_admin
  on public.price_list_definitions;
create policy price_list_definitions_update_admin
  on public.price_list_definitions
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists price_list_definitions_delete_admin
  on public.price_list_definitions;
create policy price_list_definitions_delete_admin
  on public.price_list_definitions
  for delete
  using (public.is_admin());

revoke all on public.price_list_definitions from public, anon;
grant select, insert, update, delete on public.price_list_definitions to authenticated;

-- =============================================================================
-- 5. System-row protection trigger — slug + delete locked when is_system.
-- =============================================================================

create or replace function public.price_list_definitions_protect_system()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'System-Preisliste kann nicht gelöscht werden'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.is_system and new.slug is distinct from old.slug then
      raise exception 'Slug einer System-Preisliste kann nicht geändert werden'
        using errcode = '42501';
    end if;
    if old.is_system and new.is_system = false then
      raise exception 'is_system einer System-Preisliste kann nicht zurückgesetzt werden'
        using errcode = '42501';
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_price_list_definitions_protect_system
  on public.price_list_definitions;
create trigger trg_price_list_definitions_protect_system
  before update or delete on public.price_list_definitions
  for each row execute function public.price_list_definitions_protect_system();

-- =============================================================================
-- 6. updated_at trigger — reuses set_updated_at() from 00001.
-- =============================================================================

drop trigger if exists trg_price_list_definitions_set_updated_at
  on public.price_list_definitions;
create trigger trg_price_list_definitions_set_updated_at
  before update on public.price_list_definitions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 7. Realtime publication — idempotent membership-check pattern from 00038.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname    = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'price_list_definitions'
  ) then
    alter publication supabase_realtime
      add table public.price_list_definitions;
  end if;
end $$;

comment on table public.price_list_definitions is
  'Story 3.1.1 — scalable price-list catalogue. The 5 seeded `is_system=true` '
  'rows mirror the historical CHECK enum on `price_lists.list_name`; admin '
  'can add custom (`is_system=false`) rows via the /settings/price-lists UI. '
  'System rows are protected against slug rename + DELETE; name/sort/active '
  'remain editable.';

-- =============================================================================
-- 8. Drop the historical CHECK on `price_lists.list_name` and re-emit the
--    write-path RPCs to validate against `price_list_definitions` instead.
-- =============================================================================
-- David's wish only matters end-to-end if a custom price-list slug actually
-- accepts price rows. The `price_lists_list_name_check` constraint and the
-- two RPCs (`replace_price_list_entry`, `create_article_with_prices`) all
-- hard-code the 5 system slugs; relax all three. The new validation rule:
-- `list_name` must equal the slug of an *active* `price_list_definitions`
-- row. Inactive rows are explicitly rejected so deactivation cleanly removes
-- a list from the writable surface.
--
-- Idempotent: `drop constraint if exists` + `create or replace function`
-- replay safely.

alter table public.price_lists
  drop constraint if exists price_lists_list_name_check;

create or replace function public.replace_price_list_entry(
  p_article_id uuid,
  p_list_name  text,
  p_amount     numeric,
  p_valid_from date    default current_date,
  p_notes      text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_id        uuid;
  v_existing_valid_from date;
  v_new_id             uuid;
  v_definition_id      uuid;
begin
  if not (public.is_admin() or public.is_office()) then
    raise insufficient_privilege using
      message = 'Nur admin/office dürfen Preise ändern';
  end if;

  if p_article_id is null then
    raise exception 'p_article_id darf nicht NULL sein' using errcode = '22023';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'amount muss >= 0 sein' using errcode = '23514';
  end if;
  if p_valid_from is null then
    raise exception 'p_valid_from darf nicht NULL sein' using errcode = '22023';
  end if;

  -- Validate list_name against the dynamic price_list_definitions table.
  if p_list_name is null then
    raise exception 'list_name darf nicht NULL sein' using errcode = '22023';
  end if;
  select id into v_definition_id
    from public.price_list_definitions
   where slug = p_list_name and is_active = true;
  if v_definition_id is null then
    raise exception 'Ungültige oder inaktive Preisliste: %', p_list_name
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.articles where id = p_article_id) then
    raise exception 'Artikel % existiert nicht', p_article_id using errcode = '23503';
  end if;

  select id, valid_from
    into v_existing_id, v_existing_valid_from
    from public.price_lists
   where article_id = p_article_id
     and list_name  = p_list_name
     and valid_to is null
   for update;

  if v_existing_id is not null and v_existing_valid_from = p_valid_from then
    update public.price_lists
       set amount     = p_amount,
           notes      = coalesce(p_notes, notes),
           updated_by = auth.uid()
     where id = v_existing_id
     returning id into v_new_id;
    return v_new_id;
  end if;

  if v_existing_id is not null and v_existing_valid_from > p_valid_from then
    raise exception
      'Es existiert bereits ein zukünftig gültiger Preis (gültig ab %). Bitte zuerst diesen Eintrag bearbeiten.',
      v_existing_valid_from
      using errcode = '23P01';
  end if;

  if v_existing_id is not null and v_existing_valid_from < p_valid_from then
    update public.price_lists
       set valid_to   = p_valid_from,
           updated_by = auth.uid()
     where id = v_existing_id;
  end if;

  insert into public.price_lists (
    article_id, list_name, amount, currency,
    valid_from, valid_to, notes,
    price_list_definition_id,
    created_by, updated_by
  )
  values (
    p_article_id, p_list_name, p_amount, 'CHF',
    p_valid_from, null, p_notes,
    v_definition_id,
    auth.uid(), auth.uid()
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

create or replace function public.create_article_with_prices(
  p_article jsonb,
  p_prices  jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_article_id    uuid;
  v_price         jsonb;
  v_list_name     text;
  v_amount        numeric;
  v_definition_id uuid;
begin
  if not (public.is_admin() or public.is_office()) then
    raise insufficient_privilege using
      message = 'Nur admin/office dürfen Artikel anlegen',
      errcode = '42501';
  end if;

  if p_article is null or jsonb_typeof(p_article) <> 'object' then
    raise exception 'p_article muss ein jsonb-Objekt sein' using errcode = '22023';
  end if;

  insert into public.articles (
    article_number,
    name,
    description,
    category,
    type,
    is_rentable,
    is_sellable,
    vat_rate,
    unit,
    variant_of_id,
    variant_label,
    manufacturer,
    manufacturer_ref,
    weight_kg,
    length_cm,
    width_cm,
    height_cm,
    purchase_price,
    min_stock,
    critical_stock,
    is_active,
    bexio_article_id,
    notes,
    is_serialized,
    created_by,
    updated_by
  )
  values (
    p_article->>'article_number',
    p_article->>'name',
    nullif(p_article->>'description', ''),
    p_article->>'category',
    p_article->>'type',
    coalesce((p_article->>'is_rentable')::boolean, false),
    coalesce((p_article->>'is_sellable')::boolean, false),
    coalesce(nullif(p_article->>'vat_rate', ''), 'standard'),
    p_article->>'unit',
    nullif(p_article->>'variant_of_id', '')::uuid,
    nullif(p_article->>'variant_label', ''),
    nullif(p_article->>'manufacturer', ''),
    nullif(p_article->>'manufacturer_ref', ''),
    nullif(p_article->>'weight_kg', '')::numeric,
    nullif(p_article->>'length_cm', '')::int,
    nullif(p_article->>'width_cm', '')::int,
    nullif(p_article->>'height_cm', '')::int,
    nullif(p_article->>'purchase_price', '')::numeric,
    nullif(p_article->>'min_stock', '')::int,
    nullif(p_article->>'critical_stock', '')::int,
    coalesce((p_article->>'is_active')::boolean, true),
    nullif(p_article->>'bexio_article_id', '')::int,
    nullif(p_article->>'notes', ''),
    nullif(p_article->>'is_serialized', '')::boolean,
    auth.uid(),
    auth.uid()
  )
  returning id into v_article_id;

  if p_prices is not null and jsonb_typeof(p_prices) = 'array' then
    for v_price in select * from jsonb_array_elements(p_prices)
    loop
      v_list_name := v_price->>'list_name';
      v_amount    := nullif(v_price->>'amount', '')::numeric;

      continue when v_amount is null;

      if v_list_name is null then
        raise exception 'list_name in p_prices darf nicht NULL sein'
          using errcode = '22023';
      end if;
      select id into v_definition_id
        from public.price_list_definitions
       where slug = v_list_name and is_active = true;
      if v_definition_id is null then
        raise exception 'Ungültige oder inaktive Preisliste in p_prices: %', v_list_name
          using errcode = '22023';
      end if;

      if v_amount < 0 then
        raise exception 'amount in p_prices muss >= 0 sein' using errcode = '23514';
      end if;

      insert into public.price_lists (
        article_id, list_name, amount, currency,
        valid_from, valid_to, notes,
        price_list_definition_id,
        created_by, updated_by
      )
      values (
        v_article_id,
        v_list_name,
        v_amount,
        'CHF',
        coalesce(nullif(v_price->>'valid_from', '')::date, current_date),
        null,
        nullif(v_price->>'notes', ''),
        v_definition_id,
        auth.uid(),
        auth.uid()
      );
    end loop;
  end if;

  return v_article_id;
end;
$$;
