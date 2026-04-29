-- Story 2.1 smoke matrix — customer create/edit RPCs + audit log + RLS.
-- Executed via: supabase db query --linked -f scripts/smoke-2-1.sql
--
-- Matrix cases (AC9 + AC15):
--   A  gen_next_customer_number() — admin + office succeed (10-digit
--      zero-padded), technician + warehouse get 42501 (review-fix P17).
--   B  create_customer_with_primary_address — admin + office succeed,
--      technician + warehouse get permission denied (P0001 → 42501).
--   C  customer_number DEFAULT generates a unique number when client omits.
--   D  customer_addresses default-uniqueness CHECK: second primary with
--      is_default_for_type=true on the same customer is rejected.
--   E  Audit-log delta — create writes ≥2 rows (customers + customer_addresses);
--      single-field UPDATE on customers writes exactly 1 audit_log row.
--   F  update_customer_with_primary_address — admin succeeds (review-fix P3,
--      atomic update via 00025 RPC); upserts primary address; technician fails.
--   Z  Residue assertion — cleanup leaves zero smoke fixtures behind.
--
-- All fixture rows are tagged with last_name `Smoke-<run_uuid>-...` so a
-- cleanup `like 'Smoke-' || run_id || '%'` cannot collide with real customers
-- whose surname happens to start with "Smoke" (review-fix P18).

-- ---------------------------------------------------------------------------
-- Setup
-- ---------------------------------------------------------------------------

create temp table smoke_results (
  case_id   text primary key,
  status    text not null check (status in ('PASS','FAIL')),
  detail    text
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

-- P8 (Round 3) — resolve user UUIDs from auth.users by `app_metadata.app_role`
-- so the smoke matrix runs against any environment (dev / staging / fresh
-- project). Fall back to the dev cloud's known UUIDs if the lookup yields
-- nothing — useful for one-off local runs against a snapshot — but raise a
-- clear error if a role is genuinely missing in this environment.
do $$
declare
  v_admin       uuid;
  v_office      uuid;
  v_technician  uuid;
  v_warehouse   uuid;
  -- Dev cloud fallbacks (only used when auth.users lookup yields nothing).
  v_admin_dev      constant uuid := 'b3af4f07-23e1-486b-a4f4-b300304a68a5';
  v_office_dev     constant uuid := '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7';
  v_technician_dev constant uuid := 'e9dfb290-4465-464c-a30e-8c52c7cb6b57';
  v_warehouse_dev  constant uuid := 'fe737954-b8b1-49fc-afcf-24229235507d';
begin
  select id into v_admin       from auth.users where (raw_app_meta_data ->> 'app_role') = 'admin'      order by created_at limit 1;
  select id into v_office      from auth.users where (raw_app_meta_data ->> 'app_role') = 'office'     order by created_at limit 1;
  select id into v_technician  from auth.users where (raw_app_meta_data ->> 'app_role') = 'technician' order by created_at limit 1;
  select id into v_warehouse   from auth.users where (raw_app_meta_data ->> 'app_role') = 'warehouse'  order by created_at limit 1;

  -- Fallback to dev cloud UUIDs only if auth.users itself is empty (e.g.
  -- running against a snapshot that hasn't been seeded). If auth.users has
  -- rows but a specific role is missing, prefer the loud failure.
  if (select count(*) from auth.users) = 0 then
    v_admin      := coalesce(v_admin,      v_admin_dev);
    v_office     := coalesce(v_office,     v_office_dev);
    v_technician := coalesce(v_technician, v_technician_dev);
    v_warehouse  := coalesce(v_warehouse,  v_warehouse_dev);
  end if;

  if v_admin is null      then raise exception 'smoke-2-1 preflight: no auth.users row with app_role=admin'      using errcode = '22023'; end if;
  if v_office is null     then raise exception 'smoke-2-1 preflight: no auth.users row with app_role=office'     using errcode = '22023'; end if;
  if v_technician is null then raise exception 'smoke-2-1 preflight: no auth.users row with app_role=technician' using errcode = '22023'; end if;
  if v_warehouse is null  then raise exception 'smoke-2-1 preflight: no auth.users row with app_role=warehouse'  using errcode = '22023'; end if;

  insert into smoke_roles values
    ('admin',      v_admin,      'admin'),
    ('office',     v_office,     'office'),
    ('technician', v_technician, 'technician'),
    ('warehouse',  v_warehouse,  'warehouse');
end$$;

-- ---------------------------------------------------------------------------
-- Case A — gen_next_customer_number() role gate (review-fix P17).
--   admin + office: returns 10-digit zero-padded string.
--   technician + warehouse: 42501 permission denied.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r            record;
  v_claims     text;
  v_number     text;
begin
  for r in select * from smoke_roles loop
    v_number := null;
    begin
      v_claims := json_build_object(
        'sub', r.user_id::text,
        'role', 'authenticated',
        'app_metadata', jsonb_build_object('app_role', r.app_role)
      )::text;
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);

      v_number := public.gen_next_customer_number();
    exception when others then
      reset role;
      reset request.jwt.claims;
      if r.app_role in ('admin','office') then
        insert into smoke_results values ('A:' || r.role_key, 'FAIL',
          format('%s / %s (expected success)', sqlstate, sqlerrm));
      else
        if sqlstate = '42501' then
          insert into smoke_results values ('A:' || r.role_key, 'PASS',
            'permission denied as expected');
        else
          insert into smoke_results values ('A:' || r.role_key, 'FAIL',
            format('expected 42501 got %s / %s', sqlstate, sqlerrm));
        end if;
      end if;
      continue;
    end;
    reset role;
    reset request.jwt.claims;

    if r.app_role in ('admin','office') then
      if v_number is null then
        insert into smoke_results values ('A:' || r.role_key, 'FAIL',
          'returned null');
      elsif length(v_number) <> 10 or v_number !~ '^[0-9]{10}$' then
        insert into smoke_results values ('A:' || r.role_key, 'FAIL',
          format('not 10-digit zero-padded: %s', v_number));
      else
        insert into smoke_results values ('A:' || r.role_key, 'PASS', v_number);
      end if;
    else
      insert into smoke_results values ('A:' || r.role_key, 'FAIL',
        'expected permission denied but call succeeded');
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case B — create_customer_with_primary_address role gate.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r          record;
  v_run_id   text;
  v_claims   text;
  v_id       uuid;
  v_payload  jsonb;
  v_address  jsonb := jsonb_build_object(
    'street', 'Smoke Street',
    'street_number', '1',
    'zip',    '8001',
    'city',   'Zürich',
    'country','CH'
  );
begin
  select run_id into v_run_id from smoke_run_meta;
  v_payload := jsonb_build_object(
    'customer_type', 'private',
    'first_name', 'Smoke',
    'last_name',  'Smoke-' || v_run_id || '-CaseB',
    'phone',      '+41 79 000 00 00',
    'language',   'de'
  );
  for r in select * from smoke_roles loop
    v_id := null;
    begin
      v_claims := json_build_object(
        'sub', r.user_id::text,
        'role', 'authenticated',
        'app_metadata', jsonb_build_object('app_role', r.app_role)
      )::text;
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);

      v_id := public.create_customer_with_primary_address(v_payload, v_address);
    exception when others then
      reset role;
      reset request.jwt.claims;
      if r.app_role in ('admin','office') then
        insert into smoke_results values ('B:' || r.role_key, 'FAIL',
          format('%s / %s (expected success)', sqlstate, sqlerrm));
      else
        if sqlstate = '42501' then
          insert into smoke_results values ('B:' || r.role_key, 'PASS',
            'permission denied as expected');
        else
          insert into smoke_results values ('B:' || r.role_key, 'FAIL',
            format('expected 42501 got %s / %s', sqlstate, sqlerrm));
        end if;
      end if;
      continue;
    end;
    reset role;
    reset request.jwt.claims;

    if r.app_role in ('admin','office') then
      if v_id is null then
        insert into smoke_results values ('B:' || r.role_key, 'FAIL', 'returned null');
      else
        insert into smoke_results values ('B:' || r.role_key, 'PASS', v_id::text);
      end if;
    else
      insert into smoke_results values ('B:' || r.role_key, 'FAIL',
        'expected permission denied but call succeeded');
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case C — customer_number DEFAULT generates a unique 10-digit number when
-- client omits it. Run as admin (RLS allows insert).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_admin    smoke_roles%rowtype;
  v_run_id   text;
  v_id       uuid;
  v_number_a text;
  v_number_b text;
  v_claims   text;
begin
  select * into v_admin from smoke_roles where role_key = 'admin';
  select run_id into v_run_id from smoke_run_meta;
  v_claims := json_build_object(
    'sub', v_admin.user_id::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', v_admin.app_role)
  )::text;

  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    insert into public.customers (last_name, language)
      values ('Smoke-' || v_run_id || '-DefA', 'de')
      returning id, customer_number into v_id, v_number_a;

    insert into public.customers (last_name, language)
      values ('Smoke-' || v_run_id || '-DefB', 'de')
      returning customer_number into v_number_b;
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('C', 'FAIL',
      format('%s / %s', sqlstate, sqlerrm));
    return;
  end;
  reset role;
  reset request.jwt.claims;

  if v_number_a is null or v_number_b is null then
    insert into smoke_results values ('C', 'FAIL', 'numbers null');
  elsif length(v_number_a) <> 10 or length(v_number_b) <> 10 then
    insert into smoke_results values ('C', 'FAIL',
      format('not 10-digit: %s / %s', v_number_a, v_number_b));
  elsif v_number_a = v_number_b then
    insert into smoke_results values ('C', 'FAIL',
      format('duplicate: %s', v_number_a));
  else
    insert into smoke_results values ('C', 'PASS',
      format('%s, %s', v_number_a, v_number_b));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case D — customer_addresses default-uniqueness: only one primary
-- address per customer may have is_default_for_type=true.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_admin    smoke_roles%rowtype;
  v_run_id   text;
  v_claims   text;
  v_cust_id  uuid;
  v_first    uuid;
  v_violated boolean := false;
begin
  select * into v_admin from smoke_roles where role_key = 'admin';
  select run_id into v_run_id from smoke_run_meta;
  v_claims := json_build_object(
    'sub', v_admin.user_id::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', v_admin.app_role)
  )::text;

  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    insert into public.customers (last_name, language)
      values ('Smoke-' || v_run_id || '-DefD', 'de') returning id into v_cust_id;

    insert into public.customer_addresses (customer_id, address_type, is_default_for_type, street, zip, city, country)
      values (v_cust_id, 'primary', true, 'Bahnhofstrasse', '8001', 'Zürich', 'CH')
      returning id into v_first;

    begin
      insert into public.customer_addresses (customer_id, address_type, is_default_for_type, street, zip, city, country)
        values (v_cust_id, 'primary', true, 'Limmatquai', '8001', 'Zürich', 'CH');
    exception when unique_violation then
      v_violated := true;
    end;
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('D', 'FAIL',
      format('%s / %s', sqlstate, sqlerrm));
    return;
  end;
  reset role;
  reset request.jwt.claims;

  if v_violated then
    insert into smoke_results values ('D', 'PASS',
      'second primary-default rejected as expected');
  else
    insert into smoke_results values ('D', 'FAIL',
      'second primary-default was accepted (constraint missing?)');
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case E — audit_log deltas:
--   E1: create_customer_with_primary_address writes ≥2 audit_log rows.
--   E2: single-field UPDATE on the customer writes exactly 1 audit_log row.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_admin    smoke_roles%rowtype;
  v_run_id   text;
  v_claims   text;
  v_cust_id  uuid;
  v_count_e1 integer;
  v_count_e2 integer;
begin
  select * into v_admin from smoke_roles where role_key = 'admin';
  select run_id into v_run_id from smoke_run_meta;
  v_claims := json_build_object(
    'sub', v_admin.user_id::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', v_admin.app_role)
  )::text;

  -- All work inside the admin role-simulation block — audit_log SELECT is
  -- RLS-gated to admin/office, so we cannot read it after reset role.
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    -- E1 — create.
    v_cust_id := public.create_customer_with_primary_address(
      jsonb_build_object(
        'customer_type','private',
        'first_name','Smoke','last_name','Smoke-' || v_run_id || '-AuditE1',
        'phone','+41 79 111 22 33','language','de'),
      jsonb_build_object(
        'street','Audittest','zip','9000','city','St. Gallen','country','CH')
    );

    select count(*) into v_count_e1
      from public.audit_log
     where (entity = 'customers' and entity_id = v_cust_id)
        or (entity = 'customer_addresses'
            and (after_values ->> 'customer_id')::uuid = v_cust_id);

    -- E2 — single-field update. Action filter alone is sufficient: E1 only
    -- writes `customers_created` + `customer_addresses_created` rows, so
    -- counting `customers_updated` for this entity_id picks up E2 cleanly.
    -- (Removed the original `created_at >= clock_timestamp()` filter from
    -- review-fix P27: audit_log.created_at defaults to now() = transaction
    -- start, which is *earlier* than every clock_timestamp() reading taken
    -- later in the same transaction — so the time filter excluded the E2
    -- row 100% of the time. See Story 2.1 review round 2, finding F:admin/E2.)
    update public.customers
       set notes = 'Smoke E2 update'
     where id = v_cust_id;

    -- P7 (Round 3) — assert on the audit row's after_values delta, not just
    -- the count. A future trigger that writes `customers_updated` from
    -- inside `create_customer_with_primary_address` (e.g. a post-insert
    -- touch-up) would otherwise mask regressions: count goes ≥2 and the
    -- test would report a failure for the wrong reason. By assertion-level
    -- locking onto the actual change ('Smoke E2 update'), only an audit
    -- row that captured the right edit counts toward the PASS criterion.
    select count(*) into v_count_e2
      from public.audit_log
     where entity = 'customers'
       and entity_id = v_cust_id
       and action = 'customers_updated'
       and (after_values ->> 'notes') = 'Smoke E2 update';
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('E1', 'FAIL',
      format('%s / %s', sqlstate, sqlerrm));
    return;
  end;
  reset role;
  reset request.jwt.claims;

  if v_count_e1 >= 2 then
    insert into smoke_results values ('E1', 'PASS',
      format('audit rows: %s', v_count_e1));
  else
    insert into smoke_results values ('E1', 'FAIL',
      format('expected ≥2 audit rows, got %s', v_count_e1));
  end if;

  if v_count_e2 = 1 then
    insert into smoke_results values ('E2', 'PASS',
      'exactly 1 audit row with after_values.notes match');
  else
    insert into smoke_results values ('E2', 'FAIL',
      format('expected 1 row with after_values.notes=Smoke E2 update, got %s', v_count_e2));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case F — update_customer_with_primary_address (review-fix P3).
--   Admin: succeeds, customer columns updated, primary address upserted.
--   Technician: 42501 permission denied.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r          record;
  v_run_id   text;
  v_claims   text;
  v_admin_id uuid;
  v_cust_id  uuid;
  v_returned uuid;
  v_notes    text;
  v_street   text;
begin
  select run_id into v_run_id from smoke_run_meta;

  -- Seed: create a customer as admin to update later.
  select user_id into v_admin_id from smoke_roles where role_key = 'admin';
  v_claims := json_build_object(
    'sub', v_admin_id::text, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  v_cust_id := public.create_customer_with_primary_address(
    jsonb_build_object(
      'customer_type','private',
      'first_name','Smoke',
      'last_name','Smoke-' || v_run_id || '-CaseF',
      'phone','+41 79 222 33 44','language','de'),
    jsonb_build_object(
      'street','SeedStrasse','zip','3001','city','Bern','country','CH')
  );
  reset role;
  reset request.jwt.claims;

  for r in select * from smoke_roles where role_key in ('admin','technician') loop
    v_returned := null;
    begin
      v_claims := json_build_object(
        'sub', r.user_id::text, 'role', 'authenticated',
        'app_metadata', jsonb_build_object('app_role', r.app_role)
      )::text;
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);

      v_returned := public.update_customer_with_primary_address(
        v_cust_id,
        jsonb_build_object('notes', 'Update via RPC'),
        jsonb_build_object(
          'street','UpdatedStrasse','zip','3001','city','Bern','country','CH')
      );

      if r.app_role = 'admin' then
        select notes, (select street from public.customer_addresses
                        where customer_id = v_cust_id and address_type='primary'
                          and is_default_for_type = true)
          into v_notes, v_street
          from public.customers where id = v_cust_id;
      end if;
    exception when others then
      reset role;
      reset request.jwt.claims;
      if r.app_role = 'admin' then
        insert into smoke_results values ('F:' || r.role_key, 'FAIL',
          format('%s / %s (expected success)', sqlstate, sqlerrm));
      else
        if sqlstate = '42501' then
          insert into smoke_results values ('F:' || r.role_key, 'PASS',
            'permission denied as expected');
        else
          insert into smoke_results values ('F:' || r.role_key, 'FAIL',
            format('expected 42501 got %s / %s', sqlstate, sqlerrm));
        end if;
      end if;
      continue;
    end;
    reset role;
    reset request.jwt.claims;

    if r.app_role = 'admin' then
      if v_returned <> v_cust_id then
        insert into smoke_results values ('F:' || r.role_key, 'FAIL',
          format('returned wrong id: %s', v_returned));
      elsif v_notes <> 'Update via RPC' then
        insert into smoke_results values ('F:' || r.role_key, 'FAIL',
          format('notes not updated: %s', v_notes));
      elsif v_street <> 'UpdatedStrasse' then
        insert into smoke_results values ('F:' || r.role_key, 'FAIL',
          format('address not upserted: %s', v_street));
      else
        insert into smoke_results values ('F:' || r.role_key, 'PASS',
          'atomic update + address upsert OK');
      end if;
    else
      insert into smoke_results values ('F:' || r.role_key, 'FAIL',
        'expected permission denied but call succeeded');
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Cleanup — delete smoke fixtures (run-id scoped per review-fix P18).
-- audit_log entries written for them are left in place (audit is immutable).
-- ---------------------------------------------------------------------------

do $cleanup$
declare
  v_run_id text;
begin
  select run_id into v_run_id from smoke_run_meta;
  delete from public.customers
   where last_name like 'Smoke-' || v_run_id || '-%';
end;
$cleanup$;

-- Z — residue assertion: no smoke customer rows remain (run-id scoped).
do $z$
declare
  v_run_id    text;
  v_remaining integer;
begin
  select run_id into v_run_id from smoke_run_meta;
  select count(*) into v_remaining
    from public.customers
   where last_name like 'Smoke-' || v_run_id || '-%';
  if v_remaining = 0 then
    insert into smoke_results values ('Z', 'PASS', 'no fixtures left');
  else
    insert into smoke_results values ('Z', 'FAIL',
      format('%s residual customer rows', v_remaining));
  end if;
end;
$z$;

-- ---------------------------------------------------------------------------
-- Final result
-- ---------------------------------------------------------------------------

select case_id, status, detail from smoke_results order by case_id;
