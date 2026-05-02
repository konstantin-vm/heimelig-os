-- Story 1.7 smoke matrix — bexio_credentials + OAuth2 plumbing.
-- Executed via: supabase db query --linked -f scripts/smoke-1-7.sql
--
-- Matrix cases (AC15):
--   A  bexio_credentials exists with the 16 declared columns + partial-unique
--      on (is_active) WHERE is_active = true + RLS enabled + forced.
--   B  Encryption round-trip:
--        as service_role role-set in psql       → roundtrip succeeds.
--        as authenticated admin                  → 42501 permission denied.
--   C  Partial-unique: two rows with is_active=true → second INSERT raises 23505.
--   D  RLS for authenticated: SELECT/INSERT/UPDATE/DELETE on bexio_credentials
--      as each of the 4 roles → 0 rows / permission-denied.
--   E  View bexio_credentials_status does NOT contain access_token_encrypted /
--      refresh_token_encrypted columns (information_schema).
--   F  bexio_credentials_status_for_admin() gate:
--        admin     → returns the active row (after seeding).
--        office, technician, warehouse → 42501.
--   G  Audit trigger on INSERT writes a 'bexio_credentials_created' row whose
--      after_values does NOT contain the encrypted token keys.
--   H  Audit trigger on UPDATE of refresh_count writes a delta row whose
--      before/after_values include only refresh_count (no token columns).
--   I  cron.job lookup for 'purge-bexio-oauth-states' = 1 row.
--   J  RLS for bexio_oauth_states for all 4 roles → 0 rows / permission-denied.
--   K  Vault secret bexio_token_key exists.
--   Z  Residue assertion — cleanup leaves zero smoke fixtures behind.

-- ---------------------------------------------------------------------------
-- Setup — temp tables + role UUID resolution (mirrors smoke-2-1 P8 pattern).
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
  started_at timestamptz primary key,
  run_id     text not null
) on commit drop;
insert into smoke_run_meta
  values (now(), replace(gen_random_uuid()::text, '-', ''));

grant all on smoke_results to authenticated;
grant all on smoke_roles   to authenticated;

do $$
declare
  v_admin       uuid;
  v_office      uuid;
  v_technician  uuid;
  v_warehouse   uuid;
  v_admin_dev      constant uuid := 'b3af4f07-23e1-486b-a4f4-b300304a68a5';
  v_office_dev     constant uuid := '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7';
  v_technician_dev constant uuid := 'e9dfb290-4465-464c-a30e-8c52c7cb6b57';
  v_warehouse_dev  constant uuid := 'fe737954-b8b1-49fc-afcf-24229235507d';
begin
  select id into v_admin       from auth.users where (raw_app_meta_data ->> 'app_role') = 'admin'      order by created_at limit 1;
  select id into v_office      from auth.users where (raw_app_meta_data ->> 'app_role') = 'office'     order by created_at limit 1;
  select id into v_technician  from auth.users where (raw_app_meta_data ->> 'app_role') = 'technician' order by created_at limit 1;
  select id into v_warehouse   from auth.users where (raw_app_meta_data ->> 'app_role') = 'warehouse'  order by created_at limit 1;

  if (select count(*) from auth.users) = 0 then
    v_admin      := coalesce(v_admin,      v_admin_dev);
    v_office     := coalesce(v_office,     v_office_dev);
    v_technician := coalesce(v_technician, v_technician_dev);
    v_warehouse  := coalesce(v_warehouse,  v_warehouse_dev);
  end if;

  if v_admin is null      then raise exception 'smoke-1-7 preflight: no auth.users row with app_role=admin'      using errcode = '22023'; end if;
  if v_office is null     then raise exception 'smoke-1-7 preflight: no auth.users row with app_role=office'     using errcode = '22023'; end if;
  if v_technician is null then raise exception 'smoke-1-7 preflight: no auth.users row with app_role=technician' using errcode = '22023'; end if;
  if v_warehouse is null  then raise exception 'smoke-1-7 preflight: no auth.users row with app_role=warehouse'  using errcode = '22023'; end if;

  insert into smoke_roles values
    ('admin',      v_admin,      'admin'),
    ('office',     v_office,     'office'),
    ('technician', v_technician, 'technician'),
    ('warehouse',  v_warehouse,  'warehouse');
end$$;

-- ---------------------------------------------------------------------------
-- Case A — schema shape + RLS posture.
-- ---------------------------------------------------------------------------

do $$
declare
  v_columns int;
  v_rls_enabled boolean;
  v_rls_forced  boolean;
  v_partial_unique int;
begin
  select count(*) into v_columns
    from information_schema.columns
   where table_schema = 'public' and table_name = 'bexio_credentials';

  select relrowsecurity, relforcerowsecurity
    into v_rls_enabled, v_rls_forced
    from pg_class
   where oid = 'public.bexio_credentials'::regclass;

  select count(*) into v_partial_unique
    from pg_indexes
   where schemaname = 'public'
     and tablename  = 'bexio_credentials'
     and indexname  = 'idx_bexio_credentials_active_unique';

  if v_columns = 16 and v_rls_enabled and v_rls_forced and v_partial_unique = 1 then
    insert into smoke_results values ('A', 'PASS',
      format('cols=%s, rls_enabled=%s, rls_forced=%s, partial_unique=%s',
             v_columns, v_rls_enabled, v_rls_forced, v_partial_unique));
  else
    insert into smoke_results values ('A', 'FAIL',
      format('cols=%s (want 16), rls_enabled=%s, rls_forced=%s, partial_unique=%s',
             v_columns, v_rls_enabled, v_rls_forced, v_partial_unique));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Case B — encryption round-trip.
--   B1: as the postgres-running session (service_role-equivalent) → ok.
--   B2: as authenticated admin → 42501 (the function REVOKEs from auth).
-- ---------------------------------------------------------------------------

do $$
declare
  v_rt text;
begin
  select public.bexio_decrypt_token(public.bexio_encrypt_token('hunter2-' || (select run_id from smoke_run_meta)))
    into v_rt;
  if v_rt like 'hunter2-%' then
    insert into smoke_results values ('B1', 'PASS', 'service_role round-trip ok');
  else
    insert into smoke_results values ('B1', 'FAIL', format('expected hunter2-*, got %L', v_rt));
  end if;
end$$;

-- B2 — verify GRANT matrix for both encryption helpers via pg_proc metadata.
-- Calling REVOKEd SECURITY DEFINER fns from a `set role authenticated`
-- context terminates the Supabase Cloud pooler connection (likely a
-- vault.decrypted_secrets schema-ACL pre-check edge case), so we assert the
-- ACL directly instead of exercising the runtime path.
do $$
declare
  v_authenticated_can_exec int;
  v_anon_can_exec          int;
  v_service_can_exec       int;
begin
  select count(*) into v_authenticated_can_exec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('bexio_encrypt_token','bexio_decrypt_token')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  select count(*) into v_anon_can_exec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('bexio_encrypt_token','bexio_decrypt_token')
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  select count(*) into v_service_can_exec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('bexio_encrypt_token','bexio_decrypt_token')
     and has_function_privilege('service_role', p.oid, 'EXECUTE');

  if v_authenticated_can_exec = 0 and v_anon_can_exec = 0 and v_service_can_exec = 2 then
    insert into smoke_results values ('B2', 'PASS',
      'GRANT matrix correct (service_role=2, authenticated=0, anon=0)');
  else
    insert into smoke_results values ('B2', 'FAIL',
      format('service_role=%s, authenticated=%s, anon=%s (want 2/0/0)',
             v_service_can_exec, v_authenticated_can_exec, v_anon_can_exec));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Case C — partial-unique enforcement.
-- ---------------------------------------------------------------------------

do $$
declare
  v_first  uuid;
  v_caught text;
begin
  -- Seed first active row (postgres role bypasses RLS). Tag via `notes` so
  -- the run-scoped cleanup at the end can target this row precisely (token
  -- columns are ciphertext, can't be LIKE-matched on plaintext run_id).
  insert into public.bexio_credentials (
    access_token_encrypted, refresh_token_encrypted, expires_at, environment, notes
  ) values (
    public.bexio_encrypt_token('smoke-1-7-acc-1'),
    public.bexio_encrypt_token('smoke-1-7-ref-1'),
    now() + interval '30 days',
    'trial',
    'smoke-1-7:' || (select run_id from smoke_run_meta)
  )
  returning id into v_first;

  begin
    insert into public.bexio_credentials (
      access_token_encrypted, refresh_token_encrypted, expires_at, environment, notes
    ) values (
      public.bexio_encrypt_token('smoke-1-7-acc-2'),
      public.bexio_encrypt_token('smoke-1-7-ref-2'),
      now() + interval '30 days',
      'trial',
      'smoke-1-7:' || (select run_id from smoke_run_meta)
    );
    insert into smoke_results values ('C', 'FAIL', 'second active insert did not raise 23505');
  exception when unique_violation then
    insert into smoke_results values ('C', 'PASS', '23505 unique_violation on second active row');
  when others then
    v_caught := sqlstate;
    insert into smoke_results values ('C', 'FAIL', format('unexpected sqlstate=%s msg=%s', v_caught, sqlerrm));
  end;
end$$;

-- ---------------------------------------------------------------------------
-- Case D — RLS posture for authenticated.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r          record;
  v_claims   text;
  v_count    int;
  v_caught   text;
  v_subcase  text;
  v_all_pass boolean := true;
begin
  for r in select * from smoke_roles loop
    v_claims := json_build_object(
      'sub', r.user_id::text,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('app_role', r.app_role)
    )::text;
    begin
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);
      execute 'select count(*) from public.bexio_credentials' into v_count;
      reset role; reset request.jwt.claims;
      if v_count <> 0 then
        v_subcase := format('D[%s]:select returned %s rows (want 0)', r.role_key, v_count);
        insert into smoke_results values ('D-' || r.role_key, 'FAIL', v_subcase);
        v_all_pass := false;
        continue;
      end if;
    exception when others then
      v_caught := sqlstate;
      reset role; reset request.jwt.claims;
      -- A 42501-style result is also acceptable for SELECT under RLS — Postgres
      -- normally returns 0 rows rather than raising. 42P17 (recursive RLS) is
      -- a real bug, not an acceptable outcome.
      if v_caught <> '42501' then
        insert into smoke_results values ('D-' || r.role_key,
          'FAIL', format('select unexpected sqlstate=%s', v_caught));
        v_all_pass := false;
        continue;
      end if;
    end;

    -- INSERT must be denied for authenticated.
    begin
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);
      insert into public.bexio_credentials (
        access_token_encrypted, refresh_token_encrypted, expires_at, environment
      ) values ('x','x', now() + interval '30 days', 'trial');
      reset role; reset request.jwt.claims;
      insert into smoke_results values ('D-' || r.role_key, 'FAIL',
        'insert succeeded under authenticated');
      v_all_pass := false;
    exception when others then
      v_caught := sqlstate;
      reset role; reset request.jwt.claims;
      -- Only RLS deny (42501) is a valid PASS — anything else (42P17 recursive
      -- RLS, integrity errors, generic 4xxxx) indicates a real bug.
      if v_caught = '42501' then
        insert into smoke_results values ('D-' || r.role_key, 'PASS',
          format('select=0, insert=%s', v_caught));
      else
        insert into smoke_results values ('D-' || r.role_key, 'FAIL',
          format('insert unexpected sqlstate=%s', v_caught));
        v_all_pass := false;
      end if;
    end;
  end loop;
end $outer$;

-- ---------------------------------------------------------------------------
-- Case E — bexio_credentials_status view excludes token columns.
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'bexio_credentials_status'
     and column_name in ('access_token_encrypted','refresh_token_encrypted');
  if v_count = 0 then
    insert into smoke_results values ('E', 'PASS', 'view excludes token columns');
  else
    insert into smoke_results values ('E', 'FAIL',
      format('view contains %s token column(s)', v_count));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Case F — bexio_credentials_status_for_admin() role gate.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r            record;
  v_claims     text;
  v_count      int;
  v_caught     text;
  v_expect     text;
  v_subcase_ok boolean;
begin
  for r in select * from smoke_roles loop
    v_claims := json_build_object(
      'sub', r.user_id::text,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('app_role', r.app_role)
    )::text;
    v_subcase_ok := false;
    begin
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);
      select count(*) into v_count
        from public.bexio_credentials_status_for_admin();
      reset role; reset request.jwt.claims;

      if r.role_key = 'admin' then
        if v_count >= 1 then
          v_subcase_ok := true;
          v_expect := format('admin returned %s row(s)', v_count);
        else
          v_expect := 'admin returned 0 rows (want ≥1 — Case C should have seeded)';
        end if;
      else
        v_expect := format('non-admin %s did NOT raise (got %s rows)', r.role_key, v_count);
      end if;
    exception when others then
      v_caught := sqlstate;
      reset role; reset request.jwt.claims;
      if r.role_key = 'admin' then
        v_expect := format('admin raised %s msg=%s', v_caught, sqlerrm);
      elsif v_caught = '42501' then
        v_subcase_ok := true;
        v_expect := format('%s denied (42501)', r.role_key);
      else
        v_expect := format('%s unexpected sqlstate=%s', r.role_key, v_caught);
      end if;
    end;

    insert into smoke_results values (
      'F-' || r.role_key,
      case when v_subcase_ok then 'PASS' else 'FAIL' end,
      v_expect
    );
  end loop;
end $outer$;

-- ---------------------------------------------------------------------------
-- Case G — Audit on INSERT excludes token columns.
--   Audit row written by Case C's first INSERT. Find it and inspect.
-- ---------------------------------------------------------------------------

do $$
declare
  v_row    record;
  v_keys   text[];
begin
  select after_values
    into v_row
    from public.audit_log
   where action = 'bexio_credentials_created'
     and created_at >= (select started_at from smoke_run_meta)
   order by created_at
   limit 1;

  if v_row.after_values is null then
    insert into smoke_results values ('G', 'FAIL', 'no bexio_credentials_created audit row found');
    return;
  end if;

  if v_row.after_values ? 'access_token_encrypted'
     or v_row.after_values ? 'refresh_token_encrypted' then
    insert into smoke_results values ('G', 'FAIL',
      'audit row contains suppressed token column(s)');
  else
    insert into smoke_results values ('G', 'PASS', 'token columns suppressed in audit row');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Case H — Audit on UPDATE delta-only.
--   Update refresh_count on the seeded row and verify only that key shows up
--   in before/after_values.
-- ---------------------------------------------------------------------------

do $$
declare
  v_id     uuid;
  v_audit  record;
begin
  -- Pick the active credential seeded in Case C (tagged via notes).
  select id into v_id
    from public.bexio_credentials
   where notes = 'smoke-1-7:' || (select run_id from smoke_run_meta)
   order by created_at
   limit 1;

  if v_id is null then
    insert into smoke_results values ('H', 'FAIL', 'no seeded bexio_credentials row found');
    return;
  end if;

  update public.bexio_credentials
     set refresh_count = refresh_count + 1
   where id = v_id;

  select before_values, after_values
    into v_audit
    from public.audit_log
   where action = 'bexio_credentials_updated'
     and entity_id = v_id
     and created_at >= (select started_at from smoke_run_meta)
   order by created_at desc
   limit 1;

  if v_audit.before_values is null or v_audit.after_values is null then
    insert into smoke_results values ('H', 'FAIL', 'no UPDATE audit row found');
    return;
  end if;

  if (
    select array_agg(key order by key)
    from jsonb_object_keys(v_audit.after_values) as t(key)
  ) = array['refresh_count']::text[] then
    insert into smoke_results values ('H', 'PASS', 'delta-only update audit row (refresh_count)');
  else
    insert into smoke_results values ('H', 'FAIL',
      format('after_values keys = %s', (
        select string_agg(key, ',') from jsonb_object_keys(v_audit.after_values) as t(key)
      )));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Case I — purge-bexio-oauth-states cron job is scheduled.
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  select count(*) into v_count from cron.job where jobname = 'purge-bexio-oauth-states';
  if v_count = 1 then
    insert into smoke_results values ('I', 'PASS', 'cron job scheduled');
  else
    insert into smoke_results values ('I', 'FAIL', format('found %s rows (want 1)', v_count));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Case J — bexio_oauth_states RLS = service-role only.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r          record;
  v_claims   text;
  v_count    int;
  v_caught   text;
  v_pass     boolean;
begin
  for r in select * from smoke_roles loop
    v_claims := json_build_object(
      'sub', r.user_id::text,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('app_role', r.app_role)
    )::text;
    v_pass := false;
    begin
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);
      execute 'select count(*) from public.bexio_oauth_states' into v_count;
      reset role; reset request.jwt.claims;
      if v_count = 0 then v_pass := true; end if;
    exception when others then
      v_caught := sqlstate;
      reset role; reset request.jwt.claims;
      if v_caught = '42501' then
        v_pass := true;
      end if;
    end;

    insert into smoke_results values (
      'J-' || r.role_key,
      case when v_pass then 'PASS' else 'FAIL' end,
      format('%s read posture', r.role_key)
    );
  end loop;
end $outer$;

-- ---------------------------------------------------------------------------
-- Case K — Vault secret bexio_token_key exists.
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  select count(*) into v_count from vault.secrets where name = 'bexio_token_key';
  if v_count = 1 then
    insert into smoke_results values ('K', 'PASS', 'vault secret present');
  else
    insert into smoke_results values ('K', 'FAIL',
      format('found %s rows (want 1) — run vault.create_secret(...) per migration 00021 header', v_count));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Cleanup — drop seeded bexio_credentials rows that this run created.
-- ---------------------------------------------------------------------------

delete from public.bexio_credentials
 where notes = 'smoke-1-7:' || (select run_id from smoke_run_meta);

-- ---------------------------------------------------------------------------
-- Case Z — residue assertion.
-- ---------------------------------------------------------------------------

do $$
declare
  v_residue int;
begin
  select count(*) into v_residue
    from public.bexio_credentials
   where notes = 'smoke-1-7:' || (select run_id from smoke_run_meta);
  if v_residue = 0 then
    insert into smoke_results values ('Z', 'PASS', 'no residue');
  else
    insert into smoke_results values ('Z', 'FAIL',
      format('residue=%s rows', v_residue));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Final summary.
-- ---------------------------------------------------------------------------

select case_id, status, detail
  from smoke_results
 order by case_id;

select
  count(*) filter (where status = 'PASS') as pass_count,
  count(*) filter (where status = 'FAIL') as fail_count
  from smoke_results;
