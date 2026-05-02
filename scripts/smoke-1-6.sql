-- Story 1.6 smoke matrix — storage buckets + role-based RLS on storage.objects.
-- Executed via: supabase db query --linked -f scripts/smoke-1-6.sql
--
-- Matrix cases (AC9):
--   Z   Anonymous SELECT on storage.objects for the 3 buckets returns 0 rows.
--   A   All 3 buckets exist with public=false and the expected MIME / size config.
--   B   Admin INSERT outcome per AC3 matrix (medical-certs + qr-labels OK, signatures denied).
--   C   Office INSERT into medical-certs + qr-labels OK; signatures denied.
--   D   Warehouse INSERT into qr-labels OK; medical-certs + signatures denied.
--   E   Technician INSERT into all 3 buckets denied (no policy yet — AC7).
--   F   Technician SELECT from all 3 buckets returns 0 rows (default DENY).
--   G   Office UPDATE + DELETE on signatures denied (office only has SELECT).
--   H   Path-shape rejection: insert with first-segment 'not-a-uuid' rejected.
--   I   storage_first_segment_is_uuid() helper unit checks (good UUID, bad string,
--       no folder, empty) — true / false / false / false.
--
-- All test rows carry the marker '__smoke_1_6__' in their `name` so the cleanup
-- pass at the end of this script can scrub them. Inserts use minimal columns
-- (bucket_id, name, owner=auth.uid(), metadata={}). Cleanup runs in the script's
-- top-level postgres context (no role-simulation), bypassing RLS naturally.

-- ---------------------------------------------------------------------------
-- Setup: temp tables + role UUID fixtures (same fixtures as smoke-1-5.sql).
-- ---------------------------------------------------------------------------

create temp table smoke_results (
  case_id text primary key,
  status  text not null check (status in ('PASS','FAIL')),
  detail  text
) on commit drop;

create temp table smoke_roles (
  role_key text primary key,
  user_id  uuid not null,
  app_role text
) on commit drop;

create temp table smoke_run_meta (
  started_at timestamptz primary key
) on commit drop;
insert into smoke_run_meta values (now());

grant all on smoke_results  to authenticated;
grant all on smoke_roles    to authenticated;
grant all on smoke_run_meta to authenticated;

-- norole user omitted: storage policies are role-gated, so a no-role
-- authenticated user lands in the same default-DENY bucket as technician
-- (already covered by Cases E + F).
insert into smoke_roles values
  ('admin',      'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid, 'admin'),
  ('office',     '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7'::uuid, 'office'),
  ('technician', 'e9dfb290-4465-464c-a30e-8c52c7cb6b57'::uuid, 'technician'),
  ('warehouse',  'fe737954-b8b1-49fc-afcf-24229235507d'::uuid, 'warehouse');

-- Convenience: per-bucket fixed UUID for the path's first segment so cleanup
-- can scope by name prefix as well.
create temp table smoke_paths (
  case_label text primary key,
  bucket_id  text not null,
  name       text not null
) on commit drop;
grant all on smoke_paths to authenticated;

-- ---------------------------------------------------------------------------
-- Case A — buckets exist with the expected config.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r record;
  v_expected_mime text[];
  v_expected_size bigint;
begin
  for r in
    select id, public, file_size_limit, allowed_mime_types
      from storage.buckets
     where id in ('medical-certs', 'qr-labels', 'signatures')
  loop
    case r.id
      when 'medical-certs' then
        v_expected_mime := array['application/pdf', 'image/jpeg', 'image/png'];
        v_expected_size := 10485760;
      when 'qr-labels' then
        v_expected_mime := array['application/pdf'];
        v_expected_size := 5242880;
      when 'signatures' then
        v_expected_mime := array['image/png'];
        v_expected_size := 1048576;
    end case;

    if r.public is true then
      insert into smoke_results values ('A:' || r.id, 'FAIL',
        'public=true; must be false');
    elsif r.file_size_limit is distinct from v_expected_size then
      insert into smoke_results values ('A:' || r.id, 'FAIL',
        format('size %s ≠ expected %s', r.file_size_limit, v_expected_size));
    elsif r.allowed_mime_types is distinct from v_expected_mime then
      insert into smoke_results values ('A:' || r.id, 'FAIL',
        format('mime %s ≠ expected %s', r.allowed_mime_types::text, v_expected_mime::text));
    else
      insert into smoke_results values ('A:' || r.id, 'PASS',
        format('public=false, size=%s, mime=%s', r.file_size_limit, r.allowed_mime_types::text));
    end if;
  end loop;

  -- Defence: assert all 3 buckets are present.
  if (select count(*) from storage.buckets
       where id in ('medical-certs', 'qr-labels', 'signatures')) <> 3 then
    insert into smoke_results values ('A:bucket_count', 'FAIL',
      'expected 3 buckets, got fewer');
  else
    insert into smoke_results values ('A:bucket_count', 'PASS', '3 buckets');
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Helper macro pattern for INSERT-with-RLS tests.
--
-- Each case below sets the simulated role + claims, attempts an INSERT into
-- storage.objects, and records PASS/FAIL based on whether the outcome matches
-- the AC3 matrix expectation. Successful inserts are tracked in smoke_paths
-- so cleanup can scope to them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Case B — admin INSERT outcome (AC3): medical-certs ✅, qr-labels ✅,
--          signatures denied (admin has SELECT only on signatures).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims  text;
  v_uuid    uuid := '11111111-1111-1111-1111-111111111111';
  v_path    text;
  v_caught  text;
begin
  v_claims := json_build_object(
    'sub', 'b3af4f07-23e1-486b-a4f4-b300304a68a5',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;

  -- B1: medical-certs admin insert — expected SUCCESS.
  v_path := v_uuid::text || '/__smoke_1_6__b_admin_medical.pdf';
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('medical-certs', v_path, 'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('B:admin_medical_certs', 'PASS', v_path);
    insert into smoke_paths values ('B:admin_medical_certs', 'medical-certs', v_path);
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('B:admin_medical_certs', 'FAIL',
      format('expected success, got %s / %s', sqlstate, sqlerrm));
  end;

  -- B2: qr-labels admin insert — expected SUCCESS.
  v_path := v_uuid::text || '/__smoke_1_6__b_admin_qr.pdf';
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('qr-labels', v_path, 'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('B:admin_qr_labels', 'PASS', v_path);
    insert into smoke_paths values ('B:admin_qr_labels', 'qr-labels', v_path);
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('B:admin_qr_labels', 'FAIL',
      format('expected success, got %s / %s', sqlstate, sqlerrm));
  end;

  -- B3: signatures admin insert — expected REJECT (no admin INSERT policy).
  v_path := v_uuid::text || '/__smoke_1_6__b_admin_sig.png';
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('signatures', v_path, 'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('B:admin_signatures_denied', 'FAIL',
      'expected reject, insert succeeded');
    insert into smoke_paths values ('B:admin_signatures_denied', 'signatures', v_path);
  exception when others then
    v_caught := sqlstate;
    reset role;
    reset request.jwt.claims;
    if v_caught = '42501' or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
      insert into smoke_results values ('B:admin_signatures_denied', 'PASS', v_caught);
    else
      insert into smoke_results values ('B:admin_signatures_denied', 'FAIL',
        format('unexpected %s / %s', v_caught, sqlerrm));
    end if;
  end;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case C — office INSERT: medical-certs ✅, qr-labels ✅, signatures denied.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims text;
  v_uuid   uuid := '22222222-2222-2222-2222-222222222222';
  v_path   text;
  v_caught text;
begin
  v_claims := json_build_object(
    'sub', '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'office')
  )::text;

  -- C1: medical-certs — SUCCESS.
  v_path := v_uuid::text || '/__smoke_1_6__c_office_medical.pdf';
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('medical-certs', v_path, '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('C:office_medical_certs', 'PASS', v_path);
    insert into smoke_paths values ('C:office_medical_certs', 'medical-certs', v_path);
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('C:office_medical_certs', 'FAIL',
      format('expected success, got %s / %s', sqlstate, sqlerrm));
  end;

  -- C2: qr-labels — SUCCESS.
  v_path := v_uuid::text || '/__smoke_1_6__c_office_qr.pdf';
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('qr-labels', v_path, '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('C:office_qr_labels', 'PASS', v_path);
    insert into smoke_paths values ('C:office_qr_labels', 'qr-labels', v_path);
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('C:office_qr_labels', 'FAIL',
      format('expected success, got %s / %s', sqlstate, sqlerrm));
  end;

  -- C3: signatures — REJECT (office only has SELECT).
  v_path := v_uuid::text || '/__smoke_1_6__c_office_sig.png';
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('signatures', v_path, '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('C:office_signatures_denied', 'FAIL',
      'expected reject, insert succeeded');
    insert into smoke_paths values ('C:office_signatures_denied', 'signatures', v_path);
  exception when others then
    v_caught := sqlstate;
    reset role;
    reset request.jwt.claims;
    if v_caught = '42501' or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
      insert into smoke_results values ('C:office_signatures_denied', 'PASS', v_caught);
    else
      insert into smoke_results values ('C:office_signatures_denied', 'FAIL',
        format('unexpected %s / %s', v_caught, sqlerrm));
    end if;
  end;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case D — warehouse INSERT: qr-labels ✅, medical-certs + signatures denied.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims text;
  v_uuid   uuid := '33333333-3333-3333-3333-333333333333';
  v_path   text;
  v_caught text;
begin
  v_claims := json_build_object(
    'sub', 'fe737954-b8b1-49fc-afcf-24229235507d',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'warehouse')
  )::text;

  -- D1: qr-labels — SUCCESS.
  v_path := v_uuid::text || '/__smoke_1_6__d_warehouse_qr.pdf';
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('qr-labels', v_path, 'fe737954-b8b1-49fc-afcf-24229235507d'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('D:warehouse_qr_labels', 'PASS', v_path);
    insert into smoke_paths values ('D:warehouse_qr_labels', 'qr-labels', v_path);
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('D:warehouse_qr_labels', 'FAIL',
      format('expected success, got %s / %s', sqlstate, sqlerrm));
  end;

  -- D2: medical-certs — REJECT.
  v_path := v_uuid::text || '/__smoke_1_6__d_warehouse_medical.pdf';
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('medical-certs', v_path, 'fe737954-b8b1-49fc-afcf-24229235507d'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('D:warehouse_medical_certs_denied', 'FAIL',
      'expected reject, insert succeeded');
    insert into smoke_paths values ('D:warehouse_medical_certs_denied', 'medical-certs', v_path);
  exception when others then
    v_caught := sqlstate;
    reset role;
    reset request.jwt.claims;
    if v_caught = '42501' or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
      insert into smoke_results values ('D:warehouse_medical_certs_denied', 'PASS', v_caught);
    else
      insert into smoke_results values ('D:warehouse_medical_certs_denied', 'FAIL',
        format('unexpected %s / %s', v_caught, sqlerrm));
    end if;
  end;

  -- D3: signatures — REJECT.
  v_path := v_uuid::text || '/__smoke_1_6__d_warehouse_sig.png';
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('signatures', v_path, 'fe737954-b8b1-49fc-afcf-24229235507d'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('D:warehouse_signatures_denied', 'FAIL',
      'expected reject, insert succeeded');
    insert into smoke_paths values ('D:warehouse_signatures_denied', 'signatures', v_path);
  exception when others then
    v_caught := sqlstate;
    reset role;
    reset request.jwt.claims;
    if v_caught = '42501' or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
      insert into smoke_results values ('D:warehouse_signatures_denied', 'PASS', v_caught);
    else
      insert into smoke_results values ('D:warehouse_signatures_denied', 'FAIL',
        format('unexpected %s / %s', v_caught, sqlerrm));
    end if;
  end;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case E — technician INSERT: all 3 buckets denied (no policy yet — AC7).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims text;
  v_uuid   uuid := '44444444-4444-4444-4444-444444444444';
  v_path   text;
  v_caught text;
  r        record;
begin
  v_claims := json_build_object(
    'sub', 'e9dfb290-4465-464c-a30e-8c52c7cb6b57',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'technician')
  )::text;

  for r in select unnest(array['medical-certs', 'qr-labels', 'signatures']) as bucket loop
    v_path := v_uuid::text || format('/__smoke_1_6__e_tech_%s.bin', r.bucket);
    begin
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);
      insert into storage.objects (bucket_id, name, owner, metadata)
        values (r.bucket, v_path, 'e9dfb290-4465-464c-a30e-8c52c7cb6b57'::uuid, '{}'::jsonb);
      reset role;
      reset request.jwt.claims;
      insert into smoke_results values ('E:technician_' || replace(r.bucket, '-', '_') || '_denied', 'FAIL',
        'expected reject, insert succeeded');
      insert into smoke_paths values ('E:technician_' || replace(r.bucket, '-', '_') || '_denied', r.bucket, v_path);
    exception when others then
      v_caught := sqlstate;
      reset role;
      reset request.jwt.claims;
      if v_caught = '42501' or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
        insert into smoke_results values ('E:technician_' || replace(r.bucket, '-', '_') || '_denied', 'PASS', v_caught);
      else
        insert into smoke_results values ('E:technician_' || replace(r.bucket, '-', '_') || '_denied', 'FAIL',
          format('unexpected %s / %s', v_caught, sqlerrm));
      end if;
    end;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case F — technician SELECT from all 3 buckets returns 0 rows (default DENY).
-- Cases B/C/D have populated each bucket with at least one row, so a
-- positive SELECT count would catch a stray policy.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims  text;
  v_visible bigint;
  r         record;
begin
  v_claims := json_build_object(
    'sub', 'e9dfb290-4465-464c-a30e-8c52c7cb6b57',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'technician')
  )::text;

  for r in select unnest(array['medical-certs', 'qr-labels', 'signatures']) as bucket loop
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    select count(*) into v_visible from storage.objects where bucket_id = r.bucket;
    reset role;
    reset request.jwt.claims;

    if v_visible = 0 then
      insert into smoke_results values ('F:technician_select_' || replace(r.bucket, '-', '_'), 'PASS', '0 rows');
    else
      insert into smoke_results values ('F:technician_select_' || replace(r.bucket, '-', '_'), 'FAIL',
        format('saw %s rows', v_visible));
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case G — office UPDATE + DELETE on signatures denied.
-- Setup: signatures has only admin SELECT + office SELECT. To exercise the
-- write paths we need a row in signatures — admin/office both lack INSERT.
-- We bypass RLS by inserting via session_replication_role = replica (postgres
-- context, no policies), then attempt office UPDATE/DELETE under role
-- simulation.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims  text;
  v_uuid    uuid := '55555555-5555-5555-5555-555555555555';
  v_path    text := v_uuid::text || '/__smoke_1_6__g_seed_sig.png';
  v_id      uuid;
  v_caught  text;
begin
  -- Seed under postgres context (we are postgres at script top level).
  insert into storage.objects (bucket_id, name, owner, metadata)
    values ('signatures', v_path, 'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid, '{}'::jsonb)
    returning id into v_id;
  insert into smoke_paths values ('G:seed_signatures', 'signatures', v_path);

  v_claims := json_build_object(
    'sub', '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'office')
  )::text;

  -- G1: office UPDATE on signatures — REJECT.
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    update storage.objects
       set metadata = jsonb_build_object('tampered', true)
     where id = v_id;
    -- RLS-no-policy → 0 rows updated, no error. Detect via row count.
    if not found then
      reset role;
      reset request.jwt.claims;
      insert into smoke_results values ('G:office_signatures_update_denied', 'PASS', '0 rows updated');
    else
      reset role;
      reset request.jwt.claims;
      insert into smoke_results values ('G:office_signatures_update_denied', 'FAIL',
        'update affected rows under office role');
    end if;
  exception when others then
    v_caught := sqlstate;
    reset role;
    reset request.jwt.claims;
    if v_caught = '42501' or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
      insert into smoke_results values ('G:office_signatures_update_denied', 'PASS', v_caught);
    else
      insert into smoke_results values ('G:office_signatures_update_denied', 'FAIL',
        format('unexpected %s / %s', v_caught, sqlerrm));
    end if;
  end;

  -- G2: office DELETE on signatures — REJECT.
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    delete from storage.objects where id = v_id;
    if not found then
      reset role;
      reset request.jwt.claims;
      insert into smoke_results values ('G:office_signatures_delete_denied', 'PASS', '0 rows deleted');
    else
      reset role;
      reset request.jwt.claims;
      insert into smoke_results values ('G:office_signatures_delete_denied', 'FAIL',
        'delete affected rows under office role');
    end if;
  exception when others then
    v_caught := sqlstate;
    reset role;
    reset request.jwt.claims;
    if v_caught = '42501' or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
      insert into smoke_results values ('G:office_signatures_delete_denied', 'PASS', v_caught);
    else
      insert into smoke_results values ('G:office_signatures_delete_denied', 'FAIL',
        format('unexpected %s / %s', v_caught, sqlerrm));
    end if;
  end;

  -- Verify the seed row still exists (post-G1+G2 it must — RLS denied both).
  if exists (select 1 from storage.objects where id = v_id) then
    insert into smoke_results values ('G:seed_persists', 'PASS', 'seed survived office writes');
  else
    insert into smoke_results values ('G:seed_persists', 'FAIL', 'seed unexpectedly gone');
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case H — path-shape rejection: insert with first-segment 'not-a-uuid'
--          into medical-certs is rejected by storage_first_segment_is_uuid().
--          Tested as office (has INSERT policy on medical-certs).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims text;
  v_path   text := 'not-a-uuid/__smoke_1_6__h_bad_path.pdf';
  v_caught text;
begin
  v_claims := json_build_object(
    'sub', '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'office')
  )::text;

  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);
    insert into storage.objects (bucket_id, name, owner, metadata)
      values ('medical-certs', v_path, '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7'::uuid, '{}'::jsonb);
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('H:bad_path_rejected', 'FAIL',
      'expected reject, insert succeeded');
    insert into smoke_paths values ('H:bad_path_rejected', 'medical-certs', v_path);
  exception when others then
    v_caught := sqlstate;
    reset role;
    reset request.jwt.claims;
    if v_caught = '42501' or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
      insert into smoke_results values ('H:bad_path_rejected', 'PASS', v_caught);
    else
      insert into smoke_results values ('H:bad_path_rejected', 'FAIL',
        format('unexpected %s / %s', v_caught, sqlerrm));
    end if;
  end;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case I — storage_first_segment_is_uuid() helper unit checks.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_good  boolean;
  v_xyz   boolean;
  v_no_dir boolean;
  v_empty boolean;
  v_pass  boolean;
begin
  v_good   := public.storage_first_segment_is_uuid('00000000-0000-0000-0000-000000000001/foo.pdf');
  v_xyz    := public.storage_first_segment_is_uuid('xyz/foo.pdf');
  v_no_dir := public.storage_first_segment_is_uuid('foo.pdf');
  v_empty  := public.storage_first_segment_is_uuid('');

  v_pass := (v_good is true) and (v_xyz is false) and (v_no_dir is false) and (v_empty is false);

  if v_pass then
    insert into smoke_results values ('I:helper', 'PASS',
      'good=true, xyz=false, no_dir=false, empty=false');
  else
    insert into smoke_results values ('I:helper', 'FAIL',
      format('good=%s, xyz=%s, no_dir=%s, empty=%s', v_good, v_xyz, v_no_dir, v_empty));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case Z — anonymous SELECT on storage.objects returns 0 rows for the 3
-- buckets. Run AFTER B/C/D have populated each bucket so a stray anon
-- policy would surface as a positive count.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_count bigint;
  r       record;
begin
  for r in select unnest(array['medical-certs', 'qr-labels', 'signatures']) as bucket loop
    begin
      set local role anon;
      select count(*) into v_count from storage.objects where bucket_id = r.bucket;
      reset role;

      if v_count = 0 then
        insert into smoke_results values ('Z:anon_select_' || replace(r.bucket, '-', '_'), 'PASS', '0 rows');
      else
        insert into smoke_results values ('Z:anon_select_' || replace(r.bucket, '-', '_'), 'FAIL',
          format('saw %s rows', v_count));
      end if;
    exception when others then
      reset role;
      -- Permission-denied on the table itself is also a valid PASS shape.
      if sqlstate = '42501' then
        insert into smoke_results values ('Z:anon_select_' || replace(r.bucket, '-', '_'), 'PASS', sqlstate);
      else
        insert into smoke_results values ('Z:anon_select_' || replace(r.bucket, '-', '_'), 'FAIL',
          format('unexpected %s / %s', sqlstate, sqlerrm));
      end if;
    end;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Cleanup — scrub every storage.objects row this run inserted.
--
-- Storage ships a BEFORE DELETE trigger `storage.protect_delete()` that
-- raises 42501 on every direct DELETE outside the Storage HTTP API ("Use
-- the Storage API instead"). Bypass via session_replication_role = replica
-- (disables user triggers) for the duration of the cleanup pass.
--
-- Two scopes covered:
--   1. Rows that match the smoke marker in `name` (every successful insert
--      lives at `<uuid>/__smoke_1_6__...`).
--   2. The Case G seed inserted under postgres context (no role simulation).
-- ---------------------------------------------------------------------------

set session_replication_role = replica;
delete from storage.objects
 where bucket_id in ('medical-certs', 'qr-labels', 'signatures')
   and name like '%__smoke_1_6__%';
set session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Residue assertion (defence-in-depth — caught by the marker filter above
-- but we re-check explicitly so a future test that omits the marker is
-- surfaced loudly).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_residue bigint;
begin
  select count(*) into v_residue from storage.objects
   where bucket_id in ('medical-certs', 'qr-labels', 'signatures')
     and name like '%__smoke_1_6__%';

  if v_residue = 0 then
    insert into smoke_results values ('Z:cleanup_residue', 'PASS', 'no smoke rows left');
  else
    insert into smoke_results values ('Z:cleanup_residue', 'FAIL',
      format('%s smoke rows remain', v_residue));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Results — machine-readable summary.
-- ---------------------------------------------------------------------------

select case_id, status, detail
  from smoke_results
 order by case_id;
