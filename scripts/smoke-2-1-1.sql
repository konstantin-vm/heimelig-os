-- Story 2.1.1 smoke matrix — IV-Marker + Erbengemeinschaft.
-- Executed via: supabase db query --linked -f scripts/smoke-2-1-1.sql
--
-- Matrix cases (AC10):
--   A  customers_iv_dossier_required CHECK rejects iv_marker=true with
--      iv_dossier_number IS NULL (SQLSTATE 23514).
--   B  customers_iv_dossier_required CHECK accepts iv_marker=true with a
--      non-null dossier number.
--   C  customers_iv_dossier_required CHECK accepts iv_marker=false without
--      a dossier number.
--   D  customers_salutation_allowed + contact_persons_salutation_allowed
--      CHECKs accept 'erbengemeinschaft'.
--   E  Both salutation CHECKs reject an unknown value (SQLSTATE 23514).
--   F  Audit-trigger delta — at least one audit_log row is written when
--      iv_marker / iv_dossier_number flip on an existing customer.
--   Z  Residue assertion — cleanup leaves zero smoke fixtures behind.
--
-- All fixture rows are tagged with last_name `Smoke-<run_uuid>-...` so a
-- cleanup `like 'Smoke-' || run_id || '%'` cannot collide with real customers.

-- ---------------------------------------------------------------------------
-- Setup
-- ---------------------------------------------------------------------------

create temp table smoke_results (
  case_id   text primary key,
  status    text not null check (status in ('PASS','FAIL')),
  detail    text
) on commit drop;

create temp table smoke_run_meta (
  started_at timestamptz primary key,
  run_id     text not null
) on commit drop;
insert into smoke_run_meta
  values (now(), replace(gen_random_uuid()::text, '-', ''));

grant all on smoke_results to authenticated;

do $$
declare
  v_admin uuid;
  v_admin_dev constant uuid := 'b3af4f07-23e1-486b-a4f4-b300304a68a5';
begin
  select id into v_admin from auth.users
    where (raw_app_meta_data ->> 'app_role') = 'admin'
    order by created_at limit 1;
  if v_admin is null and (select count(*) from auth.users) = 0 then
    v_admin := v_admin_dev;
  end if;
  if v_admin is null then
    raise exception 'smoke-2-1-1 preflight: no auth.users row with app_role=admin' using errcode = '22023';
  end if;
  perform set_config('smoke.admin_id', v_admin::text, true);
end$$;

-- ---------------------------------------------------------------------------
-- Case A — iv_marker=true without dossier_number → 23514.
-- ---------------------------------------------------------------------------

do $a$
declare
  v_run_id text;
  v_admin  uuid := current_setting('smoke.admin_id')::uuid;
  v_claims text;
begin
  select run_id into v_run_id from smoke_run_meta;
  v_claims := json_build_object(
    'sub', v_admin::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    insert into public.customers (last_name, language, iv_marker, iv_dossier_number)
      values ('Smoke-' || v_run_id || '-A', 'de', true, null);

    -- Should never reach here
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('A', 'FAIL', 'CHECK did not fire');
  exception when others then
    reset role;
    reset request.jwt.claims;
    if sqlstate = '23514' then
      insert into smoke_results values ('A', 'PASS', 'CHECK rejected as expected');
    else
      insert into smoke_results values ('A', 'FAIL',
        format('expected 23514 got %s / %s', sqlstate, sqlerrm));
    end if;
  end;
end$a$;

-- ---------------------------------------------------------------------------
-- Case B — iv_marker=true with dossier_number → accepted.
-- ---------------------------------------------------------------------------

do $b$
declare
  v_run_id text;
  v_admin  uuid := current_setting('smoke.admin_id')::uuid;
  v_claims text;
  v_id     uuid;
begin
  select run_id into v_run_id from smoke_run_meta;
  v_claims := json_build_object(
    'sub', v_admin::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    insert into public.customers (last_name, language, iv_marker, iv_dossier_number)
      values ('Smoke-' || v_run_id || '-B', 'de', true, '320/2025/' || v_run_id || '/0')
      returning id into v_id;
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('B', 'FAIL',
      format('%s / %s', sqlstate, sqlerrm));
    return;
  end;
  reset role;
  reset request.jwt.claims;

  if v_id is null then
    insert into smoke_results values ('B', 'FAIL', 'returned null');
  else
    insert into smoke_results values ('B', 'PASS', 'iv_marker+dossier accepted');
  end if;
end$b$;

-- ---------------------------------------------------------------------------
-- Case C — iv_marker=false without dossier_number → accepted.
-- ---------------------------------------------------------------------------

do $c$
declare
  v_run_id text;
  v_admin  uuid := current_setting('smoke.admin_id')::uuid;
  v_claims text;
  v_id     uuid;
begin
  select run_id into v_run_id from smoke_run_meta;
  v_claims := json_build_object(
    'sub', v_admin::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    insert into public.customers (last_name, language)
      values ('Smoke-' || v_run_id || '-C', 'de')
      returning id into v_id;
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('C', 'FAIL',
      format('%s / %s', sqlstate, sqlerrm));
    return;
  end;
  reset role;
  reset request.jwt.claims;

  if v_id is null then
    insert into smoke_results values ('C', 'FAIL', 'returned null');
  else
    insert into smoke_results values ('C', 'PASS', 'default false accepted without dossier');
  end if;
end$c$;

-- ---------------------------------------------------------------------------
-- Case D — salutation 'erbengemeinschaft' on customers + contact_persons.
-- ---------------------------------------------------------------------------

do $d$
declare
  v_run_id    text;
  v_admin     uuid := current_setting('smoke.admin_id')::uuid;
  v_claims    text;
  v_cust_id   uuid;
  v_contact_id uuid;
begin
  select run_id into v_run_id from smoke_run_meta;
  v_claims := json_build_object(
    'sub', v_admin::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    insert into public.customers (last_name, language, salutation)
      values ('Smoke-' || v_run_id || '-D', 'de', 'erbengemeinschaft')
      returning id into v_cust_id;

    insert into public.contact_persons
      (customer_id, role, salutation, first_name, last_name)
      values (v_cust_id, 'angehoerige', 'erbengemeinschaft',
              'Smoke', 'Smoke-' || v_run_id || '-D-contact')
      returning id into v_contact_id;
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('D', 'FAIL',
      format('%s / %s', sqlstate, sqlerrm));
    return;
  end;
  reset role;
  reset request.jwt.claims;

  if v_cust_id is null or v_contact_id is null then
    insert into smoke_results values ('D', 'FAIL', 'returned null on insert');
  else
    insert into smoke_results values ('D', 'PASS',
      'erbengemeinschaft accepted on customers + contact_persons');
  end if;
end$d$;

-- ---------------------------------------------------------------------------
-- Case E — invalid salutation 'foo' rejected on customers + contact_persons.
-- ---------------------------------------------------------------------------

do $e$
declare
  v_run_id   text;
  v_admin    uuid := current_setting('smoke.admin_id')::uuid;
  v_claims   text;
  v_cust_pass boolean := false;
  v_contact_pass boolean := false;
  v_cust_id  uuid;
begin
  select run_id into v_run_id from smoke_run_meta;
  v_claims := json_build_object(
    'sub', v_admin::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;

  -- E.1 customers reject
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    insert into public.customers (last_name, language, salutation)
      values ('Smoke-' || v_run_id || '-E-cust', 'de', 'foo');
  exception when others then
    if sqlstate = '23514' then
      v_cust_pass := true;
    end if;
  end;
  reset role;
  reset request.jwt.claims;

  -- Need a real customer to attach the contact to so the rejection isn't
  -- masked by a FK violation.
  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    insert into public.customers (last_name, language)
      values ('Smoke-' || v_run_id || '-E-host', 'de')
      returning id into v_cust_id;

    insert into public.contact_persons
      (customer_id, role, salutation, first_name, last_name)
      values (v_cust_id, 'angehoerige', 'foo',
              'Smoke', 'Smoke-' || v_run_id || '-E-contact');
  exception when others then
    if sqlstate = '23514' then
      v_contact_pass := true;
    end if;
  end;
  reset role;
  reset request.jwt.claims;

  if v_cust_pass and v_contact_pass then
    insert into smoke_results values ('E', 'PASS',
      'invalid salutation rejected on both tables');
  else
    insert into smoke_results values ('E', 'FAIL',
      format('customers=%s contact_persons=%s (expected both true)',
        v_cust_pass, v_contact_pass));
  end if;
end$e$;

-- ---------------------------------------------------------------------------
-- Case F — audit_log delta on iv_marker / iv_dossier_number update.
-- ---------------------------------------------------------------------------

do $f$
declare
  v_run_id   text;
  v_admin    uuid := current_setting('smoke.admin_id')::uuid;
  v_claims   text;
  v_cust_id  uuid;
  v_audit_count integer;
begin
  select run_id into v_run_id from smoke_run_meta;
  v_claims := json_build_object(
    'sub', v_admin::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;

  begin
    execute format($sql$
      set local role authenticated;
      set local request.jwt.claims = %L;
    $sql$, v_claims);

    insert into public.customers (last_name, language)
      values ('Smoke-' || v_run_id || '-F', 'de')
      returning id into v_cust_id;

    update public.customers
      set iv_marker = true,
          iv_dossier_number = '320/2025/' || v_run_id || '/F'
      where id = v_cust_id;
  exception when others then
    reset role;
    reset request.jwt.claims;
    insert into smoke_results values ('F', 'FAIL',
      format('%s / %s', sqlstate, sqlerrm));
    return;
  end;
  reset role;
  reset request.jwt.claims;

  -- audit_trigger_fn (00014) writes one row per UPDATE that produces a delta.
  -- We filter by action='customers_updated' alone — the create row uses
  -- 'customers_created', so action separation is sufficient. (audit_log.
  -- created_at defaults to now() = txn start, which is BEFORE every later
  -- clock_timestamp() in the same transaction; a timestamp filter would
  -- always miss the row — same trap as smoke-2-1 round 2.)
  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'customers'
     and entity_id = v_cust_id
     and action = 'customers_updated';

  if v_audit_count >= 1 then
    insert into smoke_results values ('F', 'PASS',
      format('%s audit row(s) written for IV update', v_audit_count));
  else
    insert into smoke_results values ('F', 'FAIL',
      format('expected ≥1 customers_updated audit row, got %s', v_audit_count));
  end if;
end$f$;

-- ---------------------------------------------------------------------------
-- Cleanup — delete smoke fixtures (run-id scoped).
-- ---------------------------------------------------------------------------

do $cleanup$
declare
  v_run_id text;
begin
  select run_id into v_run_id from smoke_run_meta;
  -- contact_persons fall via ON DELETE CASCADE on customer_id.
  delete from public.customers
   where last_name like 'Smoke-' || v_run_id || '-%';
end$cleanup$;

-- Z — residue assertion: no smoke customer rows remain.
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
end$z$;

-- ---------------------------------------------------------------------------
-- Final result
-- ---------------------------------------------------------------------------

select case_id, status, detail from smoke_results order by case_id;
