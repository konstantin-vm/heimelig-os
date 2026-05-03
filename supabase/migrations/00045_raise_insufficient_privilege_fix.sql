-- Migration 00045 — Story 3.1 round-1 patch (smoke-driven).
-- Fix: PG 14+ rejects `raise <condition_name> using errcode = '...'` when
-- the condition_name already implies that errcode (raises 42601 "RAISE
-- option already specified: ERRCODE" at function call time, not at create
-- time, so the bug ships invisibly until the technician path is exercised).
--
-- 00043 emitted both `replace_price_list_entry` and `create_article_with_prices`
-- with `raise insufficient_privilege using ..., errcode = '42501'`.
-- 00044 inherited the same line in the same-day-update version of
-- `replace_price_list_entry`. The smoke matrix Case D4 (technician path)
-- caught this at story close-out.
--
-- Fix: drop the redundant `errcode` option — `raise insufficient_privilege`
-- alone yields SQLSTATE `42501` per the PG condition-code table.
-- Idempotent on replay; both functions are emitted via `create or replace`.

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
begin
  if not (public.is_admin() or public.is_office()) then
    raise insufficient_privilege using
      message = 'Nur admin/office dürfen Preise ändern';
  end if;

  if p_article_id is null then
    raise exception 'p_article_id darf nicht NULL sein' using errcode = '22023';
  end if;
  if p_list_name is null
     or p_list_name not in ('helsana','sanitas','visana','kpt','private') then
    raise exception 'Ungültiger list_name: %', p_list_name using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'amount muss >= 0 sein' using errcode = '23514';
  end if;
  if p_valid_from is null then
    raise exception 'p_valid_from darf nicht NULL sein' using errcode = '22023';
  end if;

  if not exists (select 1 from public.articles where id = p_article_id) then
    raise exception 'Artikel % existiert nicht', p_article_id using errcode = '23503';
  end if;

  -- Look up + lock the open entry (if any).
  select id, valid_from
    into v_existing_id, v_existing_valid_from
    from public.price_lists
   where article_id = p_article_id
     and list_name  = p_list_name
     and valid_to is null
   for update;

  if v_existing_id is not null and v_existing_valid_from = p_valid_from then
    -- Same-day re-edit — UPDATE the existing row's amount in place.
    update public.price_lists
       set amount     = p_amount,
           notes      = p_notes,
           updated_by = auth.uid()
     where id = v_existing_id
     returning id into v_new_id;
    return v_new_id;
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
    created_by, updated_by
  )
  values (
    p_article_id, p_list_name, p_amount, 'CHF',
    p_valid_from, null, p_notes,
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
  v_article_id uuid;
  v_price       jsonb;
  v_list_name   text;
  v_amount      numeric;
begin
  if not (public.is_admin() or public.is_office()) then
    raise insufficient_privilege using
      message = 'Nur admin/office dürfen Artikel anlegen';
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

      if v_list_name is null
         or v_list_name not in ('helsana','sanitas','visana','kpt','private') then
        raise exception 'Ungültiger list_name in p_prices: %', v_list_name
          using errcode = '22023';
      end if;
      if v_amount < 0 then
        raise exception 'amount in p_prices muss >= 0 sein' using errcode = '23514';
      end if;

      insert into public.price_lists (
        article_id, list_name, amount, currency,
        valid_from, valid_to, notes,
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
        auth.uid(),
        auth.uid()
      );
    end loop;
  end if;

  return v_article_id;
end;
$$;
