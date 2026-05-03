-- Migration 00043 — Story 3.1 (Article Master Data & Price Lists).
-- Reshapes the article schema to support the orthogonal `is_rentable` /
-- `is_sellable` flags + Swiss VAT rate + critical-stock threshold, redacts
-- `purchase_price` from technicians via a dedicated view, and ships the two
-- atomic RPCs (`replace_price_list_entry`, `create_article_with_prices`) plus
-- a `current_price_for_article` SQL helper that the application layer uses to
-- read the currently-active price for any (article, list_name) pair without
-- materialising the whole `price_lists` row set.
--
-- Background — `articles.type` mutex collapse:
--   Migration 00007 modelled article kind as a tri-state enum
--   `('rental','purchase','service')`. MTG-009 (2026-04-28) surfaced that the
--   same article can be both rented and sold (e.g. Pflegebett mit Kaufoption),
--   which the mutex enum cannot express. data-model-spec §5.3.1 was amended
--   in this story's first commit to adopt option (a): collapse `type` to
--   `('physical','service')` and add `is_rentable boolean` + `is_sellable
--   boolean` as the orthogonal flags. The `articles_default_is_serialized`
--   trigger is re-emitted to key off `new.is_rentable = true` instead of
--   `new.type = 'rental'`.
--
-- Background — `articles.vat_rate`:
--   Required by Epic 3 AC1 / Epic 6 invoice generation. CHECK against
--   `('standard','reduced','accommodation')` (Schweizer MWST 2024+: 8.1% /
--   2.6% / 3.8%). Display-only in the UI; bexio mapping happens in 6.2.
--
-- Background — `articles.critical_stock`:
--   Resolved 2026-04-20 in `docs/internal/open-questions/2026-04-30_review.md`
--   ("Mindestbestand-Threshold") — additional rotes-Warnungs-Threshold next
--   to the existing `min_stock`. Story 3.4 reads it for the inventory list.
--
-- Background — `technician_articles` view:
--   Migration 00009 currently grants `articles_technician_select` on the raw
--   `articles` table including the `purchase_price` column (anti-pattern per
--   data-model-spec §5.3.1 — Einkaufspreis is admin/office-only). 00043 drops
--   that policy so technicians have NO direct SELECT on the table, and adds a
--   redacted view (without `purchase_price`) that runs as owner so technicians
--   can still read the rest of the article catalog. Pattern is reusable for
--   Story 3.2's `devices` redaction (acquisition_price column).
--
-- Background — `replace_price_list_entry`:
--   Direct UPDATE on `price_lists.amount` would mutate Bestandsschutz: Epic-5
--   contracts that reference a `price_lists.id` via `price_snapshot_source_id`
--   need the original amount to remain readable. The atomic RPC closes the
--   currently-open entry (sets `valid_to = p_valid_from`) and inserts a new
--   row in one transaction, sidestepping the GIST `price_lists_no_overlap`
--   exclusion via half-open `[)` range disjointness.
--
--   Note on AC3 wording — AC3 stipulates the closed entry's `valid_to =
--   current_date - 1 day`. With the GIST half-open `[)` semantics already in
--   place (00007 line 91), `valid_to = p_valid_from` is the correct close
--   (closed range `[old_from, p_valid_from)` is disjoint from the new
--   `[p_valid_from, infinity)`, no coverage gap). Closing at
--   `p_valid_from - 1` would introduce a 1-day uncovered window. The Section
--   5 prose ("valid_to = $valid_from") and the data-model-spec query pattern
--   (`valid_to > current_date`, treating valid_to as exclusive) both align
--   with `valid_to = p_valid_from`. Documented deviation from AC3 literal
--   wording for correctness.
--
-- Background — `create_article_with_prices`:
--   Single-transaction create that inserts into `articles` and (optionally) up
--   to 5 `price_lists` rows. Sidesteps the form-level race where a user
--   creates an article + 5 prices and the SDK splits that into 6 sequential
--   network calls (any one of which can fail leaving orphan state).
--
-- Background — `articles` + `price_lists` realtime publication:
--   Story 3.4 (Inventory page realtime) and Epic 4 (Cart) need
--   `postgres_changes` events on these tables. Migration 00038 established
--   the idempotent membership-check pattern; 00043 reuses it.
--
-- Replay safety: every step uses `if exists` / `if not exists` / `drop ...
-- if exists` so a second `supabase db push --linked` is a no-op. The data
-- transformations (back-fill, type re-mapping) are guarded with predicates
-- that NULL-out on a second run.

-- =============================================================================
-- 1. Add new columns (nullable first; tighten in step 3 once back-filled).
-- =============================================================================

alter table public.articles
  add column if not exists is_rentable    boolean,
  add column if not exists is_sellable    boolean,
  add column if not exists vat_rate       text,
  add column if not exists critical_stock integer;

-- =============================================================================
-- 2. Back-fill from old `type` values (idempotent — only updates NULL rows).
-- =============================================================================
-- Verified 2026-05-03 against linked DB: `select count(*) from articles` = 0.
-- The mapping below is therefore zero-risk for existing data; the loss-of-
-- second-flag concern (a row that was meant to be rental + purchase under the
-- old single-type model) is not actionable. If/when prod data lands via Blue-
-- Office migration (Story 9.1), the migration script there is the place to
-- pre-classify dual-mode rows correctly — at that point this migration is
-- already long-applied and only the Story-9.1 importer reads it.

update public.articles
   set is_rentable = (type = 'rental')
 where is_rentable is null;

update public.articles
   set is_sellable = (type = 'purchase')
 where is_sellable is null;

update public.articles
   set vat_rate = 'standard'
 where vat_rate is null;

-- critical_stock stays nullable (no back-fill needed).

-- =============================================================================
-- 3. Lock down NOT NULL + DEFAULT on the back-filled columns.
-- =============================================================================

alter table public.articles
  alter column is_rentable set default false,
  alter column is_rentable set not null,
  alter column is_sellable set default false,
  alter column is_sellable set not null,
  alter column vat_rate    set default 'standard',
  alter column vat_rate    set not null;

-- =============================================================================
-- 4. Add CHECKs for vat_rate + critical_stock.
-- =============================================================================

alter table public.articles
  drop constraint if exists articles_vat_rate_check;
alter table public.articles
  add  constraint articles_vat_rate_check
       check (vat_rate in ('standard','reduced','accommodation'));

alter table public.articles
  drop constraint if exists articles_critical_stock_check;
alter table public.articles
  add  constraint articles_critical_stock_check
       check (critical_stock is null or critical_stock >= 0);

-- =============================================================================
-- 5. Re-map old `type` values + replace the type CHECK constraint.
-- =============================================================================

-- Idempotent: rows already at 'physical' are skipped by the predicate.
update public.articles
   set type = 'physical'
 where type in ('rental','purchase');

alter table public.articles
  drop constraint if exists articles_type_check;
alter table public.articles
  add  constraint articles_type_check
       check (type in ('physical','service'));

-- =============================================================================
-- 6. Re-emit `articles_default_is_serialized` to key off `is_rentable`.
-- =============================================================================
-- Drops the dependency on the old `type='rental'` semantics. P10 search_path
-- hardening preserved per migration 00010.

create or replace function public.articles_default_is_serialized()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Column default is dropped (00010 D1) → NEW.is_serialized is NULL whenever
  -- the client omits the column. Default to is_rentable (rentable items are
  -- typically serialized for tracking; non-rentable items rarely are).
  if new.is_serialized is null then
    new.is_serialized := new.is_rentable;
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 7. `technician_articles` view — column-redacted (no purchase_price).
-- =============================================================================
-- Created without `with (security_invoker = true)` so it runs as the view
-- owner (postgres) and bypasses RLS on `articles`. The redaction is the
-- column list; technicians cannot bypass the view because their SELECT
-- policy on `articles` is dropped below.
--
-- Filters `is_active = true` so soft-deleted articles disappear from the
-- technician's view by default. Office/admin/warehouse keep direct SELECT on
-- the table and can still see inactive rows when needed.

drop view if exists public.technician_articles;
create view public.technician_articles as
  select
    id,
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
    -- purchase_price intentionally excluded (Einkaufspreis redaction)
    min_stock,
    critical_stock,
    is_serialized,
    is_active,
    bexio_article_id,
    notes,
    created_at,
    updated_at,
    created_by,
    updated_by
  from public.articles
  where is_active = true;

comment on view public.technician_articles is
  'Column-redacted view of public.articles for the technician role. '
  'Excludes purchase_price (Einkaufspreis) per data-model-spec §5.3.1. '
  'Created without security_invoker so it runs as owner and bypasses RLS on '
  'articles — technicians cannot SELECT the underlying table directly '
  '(policy dropped in this migration).';

revoke all on public.technician_articles from public, anon;
grant select on public.technician_articles to authenticated;

-- Drop the technician's direct SELECT policy on articles.
-- After this, technicians have NO policy matching SELECT on articles → RLS
-- denies by default. They MUST go through technician_articles.
drop policy if exists articles_technician_select on public.articles;

-- =============================================================================
-- 8. `current_price_for_article` SQL helper.
-- =============================================================================
-- STABLE / SECURITY INVOKER so that RLS on price_lists still applies (the
-- caller must be admin/office/admin-via-RPC for the read to return rows).
-- Returns NULL if no active entry exists for the (article, list_name) pair.

create or replace function public.current_price_for_article(
  p_article_id uuid,
  p_list_name  text
)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select amount
    from public.price_lists
   where article_id = p_article_id
     and list_name  = p_list_name
     and valid_from <= current_date
     and (valid_to is null or valid_to > current_date)
   order by valid_from desc
   limit 1;
$$;

revoke execute on function public.current_price_for_article(uuid, text) from public, anon;
grant  execute on function public.current_price_for_article(uuid, text) to authenticated;

-- =============================================================================
-- 9. `replace_price_list_entry` SECURITY DEFINER RPC.
-- =============================================================================
-- Atomic close-old + insert-new for a single (article, list_name) pair.
-- Admin/office gated server-side (RLS on price_lists already restricts to
-- admin/office; explicit gate is defense-in-depth for the SECURITY DEFINER
-- elevation).
--
-- Closes the currently-open entry (`valid_to is null`) by setting
-- `valid_to = p_valid_from`. With the existing GIST `[)` exclusion the
-- closed range `[old_from, p_valid_from)` is disjoint from the new
-- `[p_valid_from, infinity)` — no overlap, no coverage gap.

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
  v_new_id uuid;
begin
  -- Admin/office gate (defense-in-depth — RLS already enforces this on the
  -- INSERT/UPDATE statements below, but raising explicitly produces a clearer
  -- error code than a generic RLS denial).
  if not (public.is_admin() or public.is_office()) then
    raise insufficient_privilege using
      message = 'Nur admin/office dürfen Preise ändern',
      errcode = '42501';
  end if;

  -- Argument validation (Zod-parity at the RPC boundary).
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

  -- Verify the article exists (avoids inserting orphan price rows).
  if not exists (select 1 from public.articles where id = p_article_id) then
    raise exception 'Artikel % existiert nicht', p_article_id using errcode = '23503';
  end if;

  -- Close the currently-open entry, if any. The `valid_from < p_valid_from`
  -- guard prevents closing an entry whose own valid_from is in the future
  -- relative to the new entry (would produce an empty/inverted range that
  -- the price_lists_valid_range CHECK would reject).
  update public.price_lists
     set valid_to   = p_valid_from,
         updated_by = auth.uid()
   where article_id = p_article_id
     and list_name  = p_list_name
     and valid_to is null
     and valid_from < p_valid_from;

  -- Insert the new open-ended entry.
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

revoke execute on function public.replace_price_list_entry(uuid, text, numeric, date, text)
  from public, anon;
grant execute on function public.replace_price_list_entry(uuid, text, numeric, date, text)
  to authenticated;

comment on function public.replace_price_list_entry(uuid, text, numeric, date, text) is
  'Atomic close-old + insert-new for a single (article, list_name) price row. '
  'Admin/office gated. Returns the new price_lists.id. Preserves Bestandsschutz: '
  'old rows stay intact, contracts referencing them via price_snapshot_source_id '
  'continue to read the original amount.';

-- =============================================================================
-- 10. `create_article_with_prices` SECURITY DEFINER RPC.
-- =============================================================================
-- Single-transaction create for an article + up to 5 price rows.
-- Admin/office gated. Returns the new article id.
--
-- The `p_prices` argument is a jsonb array; each element must have at least
-- `list_name` (text) and `amount` (numeric). Optional: `notes`, `valid_from`
-- (defaults to current_date). Empty / amount-missing entries are silently
-- skipped so the form can submit a sparse 5-list with only some lines filled.

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
  -- Admin/office gate.
  if not (public.is_admin() or public.is_office()) then
    raise insufficient_privilege using
      message = 'Nur admin/office dürfen Artikel anlegen',
      errcode = '42501';
  end if;

  if p_article is null or jsonb_typeof(p_article) <> 'object' then
    raise exception 'p_article muss ein jsonb-Objekt sein' using errcode = '22023';
  end if;

  -- Insert the article. The trigger `articles_default_is_serialized` fills
  -- is_serialized when the jsonb omits it (NULL).
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
    nullif(p_article->>'is_serialized', '')::boolean,  -- nullable; trigger handles default
    auth.uid(),
    auth.uid()
  )
  returning id into v_article_id;

  -- Insert prices, if any. Skip entries with missing/empty amount.
  if p_prices is not null and jsonb_typeof(p_prices) = 'array' then
    for v_price in select * from jsonb_array_elements(p_prices)
    loop
      v_list_name := v_price->>'list_name';
      v_amount    := nullif(v_price->>'amount', '')::numeric;

      -- Silent skip when amount is empty/null (form-driven sparse submit).
      continue when v_amount is null;

      -- Validate list_name (matches the table CHECK).
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

revoke execute on function public.create_article_with_prices(jsonb, jsonb) from public, anon;
grant  execute on function public.create_article_with_prices(jsonb, jsonb) to authenticated;

comment on function public.create_article_with_prices(jsonb, jsonb) is
  'Single-transaction create of an article plus up to 5 price_lists rows. '
  'Admin/office gated. Returns the new article id. Empty/null amounts in '
  'p_prices are silently skipped so the form can submit a sparse 5-list.';

-- =============================================================================
-- 11. supabase_realtime publication — articles + price_lists.
-- =============================================================================
-- Idempotent membership-check pattern from migration 00038. Story 3.4 (the
-- inventory page) and Epic 4 (the cart) subscribe to postgres_changes on
-- these tables; without publication membership, channels mount cleanly but
-- never fire row events.

do $$
declare
  t_name text;
  v_target_tables text[] := ARRAY[
    'articles',
    'price_lists'
  ];
begin
  foreach t_name in array v_target_tables
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname    = 'supabase_realtime'
         and schemaname = 'public'
         and tablename  = t_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        t_name
      );
    end if;
  end loop;
end;
$$;
