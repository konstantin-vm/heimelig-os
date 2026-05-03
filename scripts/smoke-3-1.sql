-- Story 3.1 smoke matrix — articles schema migration, RLS isolation,
-- replace_price_list_entry + create_article_with_prices RPCs, audit trail,
-- technician_articles view, supabase_realtime publication membership.
-- Executed via: npx supabase db query --linked -f scripts/smoke-3-1.sql
--
-- Compatibility: this file uses only standard SQL (no psql backslash
-- commands) so it runs through the Cloud-management `db query` endpoint.
--
-- Matrix cases (AC7, AC8, AC9, AC10, AC11):
--   A   Schema additions: is_rentable / is_sellable / vat_rate /
--       critical_stock + CHECK constraints + articles_type_check.
--   B   technician_articles view: shape, no purchase_price column,
--       grant SELECT to authenticated, articles_technician_select policy
--       dropped.
--   C   RLS: technician → 0 rows on articles (policy dropped); ≥1 row on
--       technician_articles for the active SMOKE fixture.
--   D   replace_price_list_entry: admin/office succeed, technician 42501;
--       two consecutive same-day calls produce exactly 1 open + 1 closed
--       row (GIST [) disjointness, no overlap error).
--   E   create_article_with_prices: office succeeds, technician 42501;
--       sparse input is silently skipped.
--   F   supabase_realtime publication contains articles + price_lists.
--   G   Idempotency / trigger body anchors on is_rentable.

-- =============================================================================
-- Helper — flip the simulated caller for a single case.
-- =============================================================================

create or replace function pg_temp.set_role_for(p_user_id uuid, p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user_id::text,
      'role', 'authenticated',
      'app_metadata', json_build_object('app_role', p_role)
    )::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

-- =============================================================================
-- Fixture article — created in admin context so FORCE RLS doesn't block.
-- =============================================================================

do $$
declare
  v_admin uuid;
begin
  select id into v_admin
    from public.user_profiles where app_role = 'admin' and is_active = true limit 1;
  perform pg_temp.set_role_for(v_admin, 'admin');

  insert into public.articles (
    article_number, name, category, type, is_rentable, is_sellable, vat_rate, unit
  )
  values
    ('SMOKE-3-1-A1', 'Smoke Pflegebett', 'pflegebetten', 'physical', true, false, 'standard', 'Mte')
  on conflict (article_number) do update
    set name = excluded.name;

  -- Reset role so the standalone schema-introspection SELECTs below don't
  -- inherit the admin JWT and confuse pg_catalog reads.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case A — schema additions
-- =============================================================================

select 'CASE A1' as case, column_name, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'articles'
   and column_name in ('is_rentable','is_sellable','vat_rate','critical_stock')
 order by column_name;

select 'CASE A2 — type CHECK predicate' as case,
       pg_get_constraintdef(oid) as check_def
  from pg_constraint
 where conname = 'articles_type_check'
   and conrelid = 'public.articles'::regclass;

select 'CASE A3 — vat_rate CHECK predicate' as case,
       pg_get_constraintdef(oid) as check_def
  from pg_constraint
 where conname = 'articles_vat_rate_check'
   and conrelid = 'public.articles'::regclass;

-- =============================================================================
-- Case B — technician_articles view
-- =============================================================================

select 'CASE B1 — view exists' as case, viewname
  from pg_views
 where schemaname = 'public'
   and viewname = 'technician_articles';

select 'CASE B2 — purchase_price NOT in view (expect 0)' as case,
       count(*) filter (where column_name = 'purchase_price') as has_purchase_price
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'technician_articles';

select 'CASE B3 — view grants authenticated SELECT' as case, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name = 'technician_articles'
   and grantee = 'authenticated'
   and privilege_type = 'SELECT';

select 'CASE B4 — articles_technician_select policy dropped (expect 0)' as case,
       count(*) as policy_count
  from pg_policies
 where schemaname = 'public'
   and tablename = 'articles'
   and policyname = 'articles_technician_select';

-- =============================================================================
-- Case C — RLS technician access
-- =============================================================================

do $$
declare
  v_tech uuid;
  v_articles_seen int;
  v_view_seen int;
begin
  select id into v_tech
    from public.user_profiles
   where app_role = 'technician'
     and is_active = true
   limit 1;
  if v_tech is null then
    raise notice 'CASE C — SKIPPED (no technician user_profile found in seed)';
    return;
  end if;

  perform pg_temp.set_role_for(v_tech, 'technician');

  select count(*) into v_articles_seen
    from public.articles
   where article_number like 'SMOKE-3-1-%';
  raise notice 'CASE C1 — technician on articles: visible_rows=% (expect 0)', v_articles_seen;

  select count(*) into v_view_seen
    from public.technician_articles
   where article_number like 'SMOKE-3-1-%';
  raise notice 'CASE C2 — technician on technician_articles: visible_rows=% (expect ≥1)', v_view_seen;
end$$;

-- =============================================================================
-- Case D — replace_price_list_entry
-- =============================================================================

do $$
declare
  v_admin uuid;
  v_tech  uuid;
  v_bed   uuid;
  v_id1   uuid;
  v_id2   uuid;
  v_rows  int;
  v_open  int;
  v_closed int;
  v_caught boolean;
begin
  -- Reset role first — the previous DO block may have left technician
  -- claims in `request.jwt.claims`, which would block the SELECT below
  -- because articles_technician_select was dropped in 00043.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select id into v_admin
    from public.user_profiles where app_role = 'admin' and is_active = true limit 1;
  select id into v_tech
    from public.user_profiles where app_role = 'technician' and is_active = true limit 1;

  perform pg_temp.set_role_for(v_admin, 'admin');

  select id into v_bed
    from public.articles where article_number = 'SMOKE-3-1-A1';

  v_id1 := public.replace_price_list_entry(v_bed, 'private', 1234.50, current_date, 'smoke d1');
  raise notice 'CASE D1 — first replace returned id=% (expect non-null)', v_id1;

  v_id2 := public.replace_price_list_entry(v_bed, 'private', 1500.00, current_date, 'smoke d2');
  raise notice 'CASE D2 — second replace returned id=% (expect non-null, ≠ id1)', v_id2;

  select
    count(*),
    count(*) filter (where valid_to is null),
    count(*) filter (where valid_to is not null)
    into v_rows, v_open, v_closed
    from public.price_lists
   where article_id = v_bed
     and list_name = 'private';
  raise notice 'CASE D3 — total=% open=% closed=% (expect 2/1/1)', v_rows, v_open, v_closed;

  -- Technician path
  v_caught := false;
  perform pg_temp.set_role_for(v_tech, 'technician');
  begin
    perform public.replace_price_list_entry(v_bed, 'private', 999.00, current_date, null);
  exception when insufficient_privilege then
    v_caught := true;
  end;
  raise notice 'CASE D4 — technician → 42501 caught: %', v_caught;
  if not v_caught then
    raise exception 'CASE D4 FAILED — expected 42501 from technician';
  end if;
end$$;

-- =============================================================================
-- Case E — create_article_with_prices
-- =============================================================================

do $$
declare
  v_office uuid;
  v_tech   uuid;
  v_new_id uuid;
  v_prices int;
  v_caught boolean;
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select id into v_office
    from public.user_profiles where app_role = 'office' and is_active = true limit 1;
  select id into v_tech
    from public.user_profiles where app_role = 'technician' and is_active = true limit 1;

  -- Skip guard — mirrors Cases A–D. Without this the DO block crashes
  -- with `null role for pg_temp.set_role_for` when the seed lacks an
  -- office or technician row.
  if v_office is null or v_tech is null then
    raise notice 'CASE E — SKIPPED (office=% / tech=% missing)', v_office, v_tech;
    return;
  end if;

  perform pg_temp.set_role_for(v_office, 'office');

  v_new_id := public.create_article_with_prices(
    jsonb_build_object(
      'article_number', 'SMOKE-3-1-E1',
      'name', 'Smoke Variant',
      'category', 'mobilitaet',
      'type', 'physical',
      'is_rentable', true,
      'is_sellable', true,
      'vat_rate', 'standard',
      'unit', 'Stk.'
    ),
    jsonb_build_array(
      jsonb_build_object('list_name', 'private', 'amount', 100),
      jsonb_build_object('list_name', 'helsana', 'amount', 80),
      jsonb_build_object('list_name', 'sanitas', 'amount', '')
    )
  );
  raise notice 'CASE E1 — office create returned id=% (expect non-null)', v_new_id;

  select count(*) into v_prices
    from public.price_lists where article_id = v_new_id;
  raise notice 'CASE E2 — sparse input → % price rows (expect 2)', v_prices;

  v_caught := false;
  perform pg_temp.set_role_for(v_tech, 'technician');
  begin
    perform public.create_article_with_prices(
      jsonb_build_object(
        'article_number', 'SMOKE-3-1-E-DENIED',
        'name', 'Should Not Persist',
        'category', 'zubehoer',
        'type', 'service',
        'unit', 'Pauschal'
      ),
      '[]'::jsonb
    );
  exception when insufficient_privilege then
    v_caught := true;
  end;
  raise notice 'CASE E3 — technician → 42501 caught: %', v_caught;
  if not v_caught then
    raise exception 'CASE E3 FAILED — expected 42501 from technician';
  end if;
end$$;

-- =============================================================================
-- Case F — supabase_realtime publication membership
-- =============================================================================

select 'CASE F — articles + price_lists in supabase_realtime' as case,
       count(*) filter (where tablename = 'articles')    as articles_count,
       count(*) filter (where tablename = 'price_lists') as price_lists_count
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'public'
   and tablename in ('articles', 'price_lists');

-- =============================================================================
-- Case G — idempotency markers
-- =============================================================================

select 'CASE G1 — articles_default_is_serialized keys off is_rentable' as case,
       pg_get_functiondef(oid) ilike '%new.is_rentable%' as ok
  from pg_proc
 where proname = 'articles_default_is_serialized'
   and pronamespace = 'public'::regnamespace;

do $$
declare
  v_admin uuid;
  v_audit_rows int;
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select id into v_admin
    from public.user_profiles where app_role = 'admin' and is_active = true limit 1;
  perform pg_temp.set_role_for(v_admin, 'admin');

  select count(*) into v_audit_rows
    from public.audit_log al
   where al.entity = 'articles'
     and al.entity_id in (
       select id from public.articles
        where article_number like 'SMOKE-3-1-%'
     );
  raise notice 'CASE G2 — audit rows for SMOKE-3-1 articles: % (expect ≥1 from fixture inserts)', v_audit_rows;
  if v_audit_rows < 1 then
    raise exception 'CASE G2 FAILED — no audit rows for SMOKE-3-1 articles';
  end if;
end$$;

-- =============================================================================
-- Cleanup — must run with admin claims so RLS lets the deletes through.
-- =============================================================================

do $$
declare
  v_admin uuid;
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select id into v_admin
    from public.user_profiles where app_role = 'admin' and is_active = true limit 1;
  perform pg_temp.set_role_for(v_admin, 'admin');

  delete from public.price_lists pl
   using public.articles a
   where pl.article_id = a.id
     and a.article_number like 'SMOKE-3-1-%';

  delete from public.articles
   where article_number like 'SMOKE-3-1-%';
end$$;
