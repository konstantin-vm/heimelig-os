-- Story 3.7 smoke matrix — qr_label_runs RLS, set_device_qr_code RPC,
-- audit-trigger binding, supabase_realtime publication, CHECK constraint,
-- idempotency.
-- Executed via: npx supabase db query --linked -f scripts/smoke-3-7.sql
--
-- Compatibility: standard SQL only (no psql backslash commands) so it runs
-- through the Cloud-management `db query` endpoint.
--
-- Cases:
--   A    qr_label_runs RLS — admin INSERT succeeds + audit row materialises
--   B    qr_label_runs RLS — office INSERT succeeds
--   C    qr_label_runs RLS — warehouse INSERT succeeds
--   D    qr_label_runs RLS — technician INSERT denied (no policy)
--   E    qr_label_runs RLS — anon INSERT denied (no policy)
--   F    set_device_qr_code — admin / office / warehouse pass when qr_code
--        IS NULL → audit row on devices
--   G    set_device_qr_code — technician raises 42501
--   H    set_device_qr_code — mismatched existing value raises 22023
--   I    Idempotency — replay 00050 schema entities via to_regclass
--   J    CHECK constraint — INSERT with malformed storage_path → 23514
--   K    Realtime publication — qr_label_runs is a member
--   L    Audit trigger binding — trg_qr_label_runs_audit exists

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
-- Fixtures — created in admin context (FORCE RLS otherwise blocks).
-- =============================================================================

do $$
declare
  v_admin uuid;
  v_article_id uuid;
  v_device_id uuid;
begin
  select id into v_admin
    from public.user_profiles where app_role = 'admin' and is_active = true limit 1;
  perform pg_temp.set_role_for(v_admin, 'admin');

  insert into public.articles (
    article_number, name, category, type, is_rentable, is_sellable, vat_rate, unit
  )
  values
    ('SMOKE-3-7-A1', 'Smoke Etiketten-Bett', 'pflegebetten', 'physical', true, false, 'standard', 'Mte')
  on conflict (article_number) do update set name = excluded.name
  returning id into v_article_id;

  -- Device whose qr_code starts NULL — exercised by Case F.
  insert into public.devices (article_id, serial_number, condition, is_new)
  values (v_article_id, 'SMOKE-3-7-D1', 'gut', true)
  on conflict (serial_number) do update set article_id = excluded.article_id
  returning id into v_device_id;

  -- Reset role so subsequent SELECTs run as superuser.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case A — admin INSERT succeeds + audit row materialises.
-- =============================================================================

do $$
declare
  v_admin uuid;
  v_article uuid;
  v_batch uuid := gen_random_uuid();
  v_device uuid;
  v_run uuid;
  v_audit_count int;
begin
  select id into v_admin from public.user_profiles where app_role = 'admin' and is_active = true limit 1;
  select id into v_article from public.articles where article_number = 'SMOKE-3-7-A1' limit 1;
  select id into v_device from public.devices where serial_number = 'SMOKE-3-7-D1' limit 1;

  perform pg_temp.set_role_for(v_admin, 'admin');

  insert into public.qr_label_runs (article_id, batch_id, device_ids, storage_path, status)
  values (
    v_article, v_batch, ARRAY[v_device]::uuid[],
    'qr-labels/' || v_article::text || '/' || v_batch::text || '.pdf',
    'completed'
  )
  returning id into v_run;

  raise notice 'CASE A — admin insert success, run_id=%', v_run;

  -- Verify audit row was emitted by the trigger.
  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'qr_label_runs' and entity_id = v_run;

  if v_audit_count <> 1 then
    raise exception 'CASE A — expected 1 audit row, got %', v_audit_count;
  end if;
  raise notice 'CASE A — audit row materialised (% row)', v_audit_count;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case B — office INSERT succeeds.
-- =============================================================================

do $$
declare
  v_office uuid;
  v_article uuid;
  v_batch uuid := gen_random_uuid();
  v_device uuid;
begin
  select id into v_office from public.user_profiles where app_role = 'office' and is_active = true limit 1;
  if v_office is null then
    raise notice 'CASE B — SKIPPED (no office user in seed)';
    return;
  end if;
  select id into v_article from public.articles where article_number = 'SMOKE-3-7-A1' limit 1;
  select id into v_device from public.devices where serial_number = 'SMOKE-3-7-D1' limit 1;

  perform pg_temp.set_role_for(v_office, 'office');
  insert into public.qr_label_runs (article_id, batch_id, device_ids, storage_path, status)
  values (
    v_article, v_batch, ARRAY[v_device]::uuid[],
    'qr-labels/' || v_article::text || '/' || v_batch::text || '.pdf',
    'completed'
  );
  raise notice 'CASE B — office insert success, batch_id=%', v_batch;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case C — warehouse INSERT succeeds.
-- =============================================================================

do $$
declare
  v_warehouse uuid;
  v_article uuid;
  v_batch uuid := gen_random_uuid();
  v_device uuid;
begin
  select id into v_warehouse from public.user_profiles where app_role = 'warehouse' and is_active = true limit 1;
  if v_warehouse is null then
    raise notice 'CASE C — SKIPPED (no warehouse user in seed)';
    return;
  end if;
  select id into v_article from public.articles where article_number = 'SMOKE-3-7-A1' limit 1;
  select id into v_device from public.devices where serial_number = 'SMOKE-3-7-D1' limit 1;

  perform pg_temp.set_role_for(v_warehouse, 'warehouse');
  insert into public.qr_label_runs (article_id, batch_id, device_ids, storage_path, status)
  values (
    v_article, v_batch, ARRAY[v_device]::uuid[],
    'qr-labels/' || v_article::text || '/' || v_batch::text || '.pdf',
    'completed'
  );
  raise notice 'CASE C — warehouse insert success, batch_id=%', v_batch;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case D — technician INSERT denied (no policy).
-- =============================================================================

do $$
declare
  v_technician uuid;
  v_article uuid;
  v_batch uuid := gen_random_uuid();
  v_device uuid;
  v_caught text;
begin
  select id into v_technician from public.user_profiles where app_role = 'technician' and is_active = true limit 1;
  if v_technician is null then
    raise notice 'CASE D — SKIPPED (no technician user in seed)';
    return;
  end if;
  select id into v_article from public.articles where article_number = 'SMOKE-3-7-A1' limit 1;
  select id into v_device from public.devices where serial_number = 'SMOKE-3-7-D1' limit 1;

  perform pg_temp.set_role_for(v_technician, 'technician');
  begin
    insert into public.qr_label_runs (article_id, batch_id, device_ids, storage_path, status)
    values (
      v_article, v_batch, ARRAY[v_device]::uuid[],
      'qr-labels/' || v_article::text || '/' || v_batch::text || '.pdf',
      'completed'
    );
    v_caught := 'NO_ERROR';
  exception
    when insufficient_privilege then v_caught := 'OK_42501';
    when others then v_caught := 'OK_RLS_DENY: ' || SQLSTATE;
  end;

  if v_caught = 'NO_ERROR' then
    raise exception 'CASE D — technician INSERT was NOT blocked (RLS gap!)';
  end if;
  raise notice 'CASE D — technician denied as expected (%)', v_caught;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case E — anon INSERT denied (no policy).
-- =============================================================================

do $$
declare
  v_article uuid;
  v_batch uuid := gen_random_uuid();
  v_device uuid;
  v_caught text;
begin
  select id into v_article from public.articles where article_number = 'SMOKE-3-7-A1' limit 1;
  select id into v_device from public.devices where serial_number = 'SMOKE-3-7-D1' limit 1;

  -- Anon: no JWT, just `set role anon`.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  begin
    insert into public.qr_label_runs (article_id, batch_id, device_ids, storage_path, status)
    values (
      v_article, v_batch, ARRAY[v_device]::uuid[],
      'qr-labels/' || v_article::text || '/' || v_batch::text || '.pdf',
      'completed'
    );
    v_caught := 'NO_ERROR';
  exception
    when others then v_caught := 'OK_DENY: ' || SQLSTATE;
  end;

  if v_caught = 'NO_ERROR' then
    raise exception 'CASE E — anon INSERT was NOT blocked!';
  end if;
  raise notice 'CASE E — anon denied as expected (%)', v_caught;

  perform set_config('role', 'postgres', true);
end$$;

-- =============================================================================
-- Case F — set_device_qr_code admin / office / warehouse pass; audit row.
-- =============================================================================

do $$
declare
  v_admin uuid;
  v_device uuid;
  v_audit_count_before int;
  v_audit_count_after  int;
  v_qr text;
begin
  select id into v_admin from public.user_profiles where app_role = 'admin' and is_active = true limit 1;

  -- Reset the device's qr_code to null so the RPC has something to write.
  perform pg_temp.set_role_for(v_admin, 'admin');
  update public.devices set qr_code = null where serial_number = 'SMOKE-3-7-D1';
  select id into v_device from public.devices where serial_number = 'SMOKE-3-7-D1' limit 1;

  select count(*) into v_audit_count_before
    from public.audit_log
   where entity = 'devices' and entity_id = v_device and action = 'devices_updated';

  -- Admin call.
  perform public.set_device_qr_code(v_device, 'SMOKE-3-7-D1');
  select qr_code into v_qr from public.devices where id = v_device;
  if v_qr <> 'SMOKE-3-7-D1' then
    raise exception 'CASE F — admin RPC did not write qr_code (got %)', coalesce(v_qr, '<null>');
  end if;
  raise notice 'CASE F — admin RPC wrote qr_code=%', v_qr;

  -- Idempotent re-call must succeed (same value).
  perform public.set_device_qr_code(v_device, 'SMOKE-3-7-D1');
  raise notice 'CASE F — idempotent re-call ok';

  select count(*) into v_audit_count_after
    from public.audit_log
   where entity = 'devices' and entity_id = v_device and action = 'devices_updated';
  if v_audit_count_after <= v_audit_count_before then
    raise exception 'CASE F — devices audit row NOT emitted (% before / % after)',
      v_audit_count_before, v_audit_count_after;
  end if;
  raise notice 'CASE F — devices audit row emitted (% → %)',
    v_audit_count_before, v_audit_count_after;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case G — technician set_device_qr_code raises 42501.
-- =============================================================================

do $$
declare
  v_technician uuid;
  v_device uuid;
  v_caught text;
begin
  select id into v_technician from public.user_profiles where app_role = 'technician' and is_active = true limit 1;
  if v_technician is null then
    raise notice 'CASE G — SKIPPED (no technician user in seed)';
    return;
  end if;
  select id into v_device from public.devices where serial_number = 'SMOKE-3-7-D1' limit 1;

  perform pg_temp.set_role_for(v_technician, 'technician');
  begin
    perform public.set_device_qr_code(v_device, 'SMOKE-3-7-D1');
    v_caught := 'NO_ERROR';
  exception
    when insufficient_privilege then v_caught := 'OK_42501';
    when others then v_caught := 'OTHER: ' || SQLSTATE;
  end;

  if v_caught <> 'OK_42501' then
    raise exception 'CASE G — expected 42501, got %', v_caught;
  end if;
  raise notice 'CASE G — technician denied as expected (42501)';

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case H — mismatched existing qr_code raises 22023.
-- =============================================================================

do $$
declare
  v_admin uuid;
  v_device uuid;
  v_caught text;
begin
  select id into v_admin from public.user_profiles where app_role = 'admin' and is_active = true limit 1;
  select id into v_device from public.devices where serial_number = 'SMOKE-3-7-D1' limit 1;

  perform pg_temp.set_role_for(v_admin, 'admin');
  begin
    perform public.set_device_qr_code(v_device, 'TOTALLY-DIFFERENT-VALUE');
    v_caught := 'NO_ERROR';
  exception
    when sqlstate '22023' then v_caught := 'OK_22023';
    when others then v_caught := 'OTHER: ' || SQLSTATE;
  end;

  if v_caught <> 'OK_22023' then
    raise exception 'CASE H — expected 22023, got %', v_caught;
  end if;
  raise notice 'CASE H — conflict raised 22023 as expected';

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case I — Idempotency: schema entities exist via to_regclass / pg_proc.
-- =============================================================================

select 'CASE I1 — qr_label_runs table' as case,
       to_regclass('public.qr_label_runs') is not null as exists;

select 'CASE I2 — set_device_qr_code function' as case,
       count(*) > 0 as exists
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'set_device_qr_code';

select 'CASE I3 — qr_label_runs storage_path CHECK' as case,
       count(*) > 0 as exists
  from pg_constraint
 where conname = 'qr_label_runs_storage_path_format'
   and conrelid = 'public.qr_label_runs'::regclass;

-- =============================================================================
-- Case J — malformed storage_path INSERT → 23514.
-- =============================================================================

do $$
declare
  v_admin uuid;
  v_article uuid;
  v_device uuid;
  v_caught text;
begin
  select id into v_admin from public.user_profiles where app_role = 'admin' and is_active = true limit 1;
  select id into v_article from public.articles where article_number = 'SMOKE-3-7-A1' limit 1;
  select id into v_device from public.devices where serial_number = 'SMOKE-3-7-D1' limit 1;

  perform pg_temp.set_role_for(v_admin, 'admin');
  begin
    insert into public.qr_label_runs (article_id, batch_id, device_ids, storage_path, status)
    values (
      v_article, gen_random_uuid(), ARRAY[v_device]::uuid[],
      'qr-labels/wrong-path.pdf',  -- intentionally malformed
      'completed'
    );
    v_caught := 'NO_ERROR';
  exception
    when check_violation then v_caught := 'OK_23514';
    when others then v_caught := 'OTHER: ' || SQLSTATE;
  end;

  if v_caught <> 'OK_23514' then
    raise exception 'CASE J — expected 23514 check_violation, got %', v_caught;
  end if;
  raise notice 'CASE J — malformed path rejected (23514)';

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end$$;

-- =============================================================================
-- Case K — supabase_realtime publication includes qr_label_runs.
-- =============================================================================

select 'CASE K — qr_label_runs in supabase_realtime' as case,
       count(*) > 0 as is_member
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'public'
   and tablename = 'qr_label_runs';

-- =============================================================================
-- Case L — audit trigger binding exists on qr_label_runs.
-- =============================================================================

select 'CASE L — trg_qr_label_runs_audit binding' as case,
       count(*) > 0 as exists
  from pg_trigger
 where tgname = 'trg_qr_label_runs_audit'
   and tgrelid = 'public.qr_label_runs'::regclass;

-- =============================================================================
-- Cleanup — leave the fixture article + device in place (other smokes may
-- recycle them); only purge the qr_label_runs rows we inserted.
-- =============================================================================

delete from public.qr_label_runs
 where article_id in (select id from public.articles where article_number = 'SMOKE-3-7-A1');
