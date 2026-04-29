-- Story 2.3 smoke matrix — customer_insurance CRUD + Hauptversicherung +
-- audit log + RLS + XOR check.
-- Executed via: supabase db query --linked -f scripts/smoke-2-3.sql
--
-- Matrix cases (AC8 + AC10 + AC12):
--   A  RLS SELECT — admin + office can read; technician + warehouse cannot.
--   B  RLS INSERT — admin + office succeed; technician + warehouse 42501.
--   C  Partial unique index `idx_customer_insurance_primary_unique` enforces
--      one primary per (customer, insurance_type). Two Grund primaries collide
--      (23505); a Grund primary + a Zusatz primary coexist for the same
--      customer.
--   D  XOR check `customer_insurance_insurer_xor` — neither set → 23514;
--      both set → 23514; exactly one set → OK.
--   E  set_primary_customer_insurance — same-type prior primary emits exactly
--      2 audit rows (demote + promote); cross-type prior primary emits exactly
--      1 audit row (promote only — no cross-type demote).
--   F  Soft-delete (is_active=false) emits 1 audit row.
--   G  INSERT emits 1 audit row; single-field UPDATE emits 1 audit row.
--   H  set_primary_customer_insurance role gate — technician/warehouse 42501.
--   Z  Residue assertion — cleanup leaves zero smoke fixtures behind.

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
  started_at timestamptz primary key
) on commit drop;
insert into smoke_run_meta values (now());

grant all on smoke_results to authenticated;
grant all on smoke_roles   to authenticated;

insert into smoke_roles values
  ('admin',      'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid, 'admin'),
  ('office',     '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7'::uuid, 'office'),
  ('technician', 'e9dfb290-4465-464c-a30e-8c52c7cb6b57'::uuid, 'technician'),
  ('warehouse',  'fe737954-b8b1-49fc-afcf-24229235507d'::uuid, 'warehouse');

-- Setup — one customer; one Grund row + one Zusatz row.

create temp table smoke_fixture (
  customer_id        uuid,
  helsana_id         uuid,
  sanitas_id         uuid,
  visana_id          uuid,
  grund_a_id         uuid,
  zusatz_a_id        uuid
) on commit drop;

grant all on smoke_fixture to authenticated;

do $setup$
declare
  v_customer_id uuid;
  v_grund_a     uuid;
  v_zusatz_a    uuid;
  v_helsana     uuid;
  v_sanitas     uuid;
  v_visana      uuid;
  v_admin       smoke_roles%rowtype;
  v_claims      text;
begin
  select * into v_admin from smoke_roles where role_key = 'admin';
  v_claims := json_build_object(
    'sub', v_admin.user_id::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  select id into v_helsana from public.partner_insurers where code = 'helsana';
  select id into v_sanitas from public.partner_insurers where code = 'sanitas';
  select id into v_visana  from public.partner_insurers where code = 'visana';

  v_customer_id := public.create_customer_with_primary_address(
    jsonb_build_object(
      'customer_type','private',
      'first_name','Smoke','last_name','Two-Three',
      'phone','+41 79 000 23 23','language','de'
    ),
    jsonb_build_object('street','Versicherung Strasse','street_number','23',
                       'zip','8002','city','Zürich','country','CH')
  );

  insert into public.customer_insurance
    (customer_id, partner_insurer_id, insurance_type, insurance_number, is_primary)
    values (v_customer_id, v_helsana, 'grund', 'V-001', true)
    returning id into v_grund_a;

  insert into public.customer_insurance
    (customer_id, partner_insurer_id, insurance_type, insurance_number, is_primary)
    values (v_customer_id, v_sanitas, 'zusatz', 'V-002', true)
    returning id into v_zusatz_a;

  insert into smoke_fixture values (v_customer_id, v_helsana, v_sanitas, v_visana, v_grund_a, v_zusatz_a);

  reset role;
  reset request.jwt.claims;
end;
$setup$;

-- ---------------------------------------------------------------------------
-- Case A — RLS SELECT matrix.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r            record;
  v_claims     text;
  v_count      integer;
  v_fixture    smoke_fixture%rowtype;
begin
  select * into v_fixture from smoke_fixture limit 1;
  for r in select * from smoke_roles loop
    v_count := -1;
    begin
      v_claims := json_build_object(
        'sub', r.user_id::text, 'role', 'authenticated',
        'app_metadata', jsonb_build_object('app_role', r.app_role)
      )::text;
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);

      select count(*) into v_count
        from public.customer_insurance
       where customer_id = v_fixture.customer_id;
    exception when others then
      v_count := -1;
    end;
    reset role;
    reset request.jwt.claims;

    if r.app_role in ('admin','office') then
      if v_count = 2 then
        insert into smoke_results values ('A:' || r.role_key, 'PASS', '2 rows');
      else
        insert into smoke_results values ('A:' || r.role_key, 'FAIL',
          format('expected 2 rows, got %s', v_count));
      end if;
    else
      if v_count = 0 or v_count = -1 then
        insert into smoke_results values ('A:' || r.role_key, 'PASS',
          'denied / 0 rows as expected');
      else
        insert into smoke_results values ('A:' || r.role_key, 'FAIL',
          format('expected 0 visible rows, got %s', v_count));
      end if;
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case B — RLS INSERT (admin/office succeed; technician/warehouse 42501).
-- ---------------------------------------------------------------------------

do $outer$
declare
  r          record;
  v_claims   text;
  v_id       uuid;
  v_fixture  smoke_fixture%rowtype;
begin
  select * into v_fixture from smoke_fixture limit 1;
  for r in select * from smoke_roles loop
    v_id := null;
    begin
      v_claims := json_build_object(
        'sub', r.user_id::text, 'role', 'authenticated',
        'app_metadata', jsonb_build_object('app_role', r.app_role)
      )::text;
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);

      insert into public.customer_insurance
        (customer_id, insurer_name_freetext, insurance_type, is_primary)
      values (v_fixture.customer_id,
              'Smoke-Insert-' || r.role_key,
              'zusatz', false)
      returning id into v_id;
    exception when others then
      reset role;
      reset request.jwt.claims;
      if r.app_role in ('admin','office') then
        insert into smoke_results values ('B:' || r.role_key, 'FAIL',
          format('%s / %s (expected success)', sqlstate, sqlerrm));
      elsif sqlstate = '42501' then
        insert into smoke_results values ('B:' || r.role_key, 'PASS',
          'permission denied as expected');
      else
        insert into smoke_results values ('B:' || r.role_key, 'FAIL',
          format('expected 42501 got %s / %s', sqlstate, sqlerrm));
      end if;
      continue;
    end;
    reset role;
    reset request.jwt.claims;

    if r.app_role in ('admin','office') then
      if v_id is null then
        insert into smoke_results values ('B:' || r.role_key, 'FAIL', 'no id');
      else
        insert into smoke_results values ('B:' || r.role_key, 'PASS', v_id::text);
        -- Cleanup the row to keep residue assertion green.
        delete from public.customer_insurance where id = v_id;
      end if;
    else
      insert into smoke_results values ('B:' || r.role_key, 'FAIL',
        'expected permission denied but call succeeded');
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case C — Partial unique index enforcement.
--   C1: a Grund primary + a Zusatz primary coexist (no conflict — already
--       in the fixture from setup; no-op assertion that count=2).
--   C2: trying to add a second Grund primary collides (23505).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture  smoke_fixture%rowtype;
  v_admin    smoke_roles%rowtype;
  v_claims   text;
  v_state    text := null;
  v_primary_count integer;
begin
  select * into v_fixture from smoke_fixture limit 1;
  select * into v_admin   from smoke_roles where role_key = 'admin';
  v_claims := json_build_object(
    'sub', v_admin.user_id::text, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  -- C1: Grund + Zusatz both primary already (from setup).
  select count(*) into v_primary_count
    from public.customer_insurance
   where customer_id = v_fixture.customer_id
     and is_primary = true;

  if v_primary_count = 2 then
    insert into smoke_results values ('C1', 'PASS',
      'Grund + Zusatz primaries coexist as expected');
  else
    insert into smoke_results values ('C1', 'FAIL',
      format('expected 2 primaries, got %s', v_primary_count));
  end if;

  -- C2: insert a 2nd Grund primary → 23505.
  begin
    insert into public.customer_insurance
      (customer_id, partner_insurer_id, insurance_type, insurance_number, is_primary)
    values (v_fixture.customer_id, v_fixture.visana_id, 'grund', 'V-DUP', true);
  exception when unique_violation then
    v_state := '23505';
  when others then
    v_state := sqlstate;
  end;
  reset role;
  reset request.jwt.claims;

  if v_state = '23505' then
    insert into smoke_results values ('C2', 'PASS',
      'second Grund primary rejected (23505)');
  else
    insert into smoke_results values ('C2', 'FAIL',
      format('expected 23505, got %s', coalesce(v_state, 'no error')));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case D — XOR check `customer_insurance_insurer_xor`.
--   D1: neither set → 23514.
--   D2: both set → 23514.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture  smoke_fixture%rowtype;
  v_admin    smoke_roles%rowtype;
  v_claims   text;
  v_state    text;
begin
  select * into v_fixture from smoke_fixture limit 1;
  select * into v_admin   from smoke_roles where role_key = 'admin';
  v_claims := json_build_object(
    'sub', v_admin.user_id::text, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  v_state := null;
  begin
    insert into public.customer_insurance
      (customer_id, insurance_type, is_primary)
    values (v_fixture.customer_id, 'zusatz', false);
  exception when check_violation then
    v_state := '23514';
  when others then
    v_state := sqlstate;
  end;
  if v_state = '23514' then
    insert into smoke_results values ('D1', 'PASS',
      'neither set → 23514 as expected');
  else
    insert into smoke_results values ('D1', 'FAIL',
      format('expected 23514 got %s', coalesce(v_state, 'no error')));
  end if;

  v_state := null;
  begin
    insert into public.customer_insurance
      (customer_id, partner_insurer_id, insurer_name_freetext,
       insurance_type, is_primary)
    values (v_fixture.customer_id, v_fixture.visana_id, 'Both-Set',
            'zusatz', false);
  exception when check_violation then
    v_state := '23514';
  when others then
    v_state := sqlstate;
  end;
  reset role;
  reset request.jwt.claims;

  if v_state = '23514' then
    insert into smoke_results values ('D2', 'PASS',
      'both set → 23514 as expected');
  else
    insert into smoke_results values ('D2', 'FAIL',
      format('expected 23514 got %s', coalesce(v_state, 'no error')));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case E — set_primary_customer_insurance same-type vs cross-type.
--   E1: promote a new Grund row over the existing Grund primary → 2 audit rows
--       (demote prior + promote new) within the (customer, 'grund') partition.
--   E2: promote a new Zusatz row over an existing Grund primary → 1 audit row
--       (promote only; the Grund primary is unaffected).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture     smoke_fixture%rowtype;
  v_admin       smoke_roles%rowtype;
  v_claims      text;
  v_grund_b     uuid;
  v_grund_a_primary boolean;
  v_grund_b_primary boolean;
  v_zusatz_a_primary boolean;
  v_audit_count integer;
begin
  select * into v_fixture from smoke_fixture limit 1;
  select * into v_admin   from smoke_roles where role_key = 'admin';
  v_claims := json_build_object(
    'sub', v_admin.user_id::text, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  -- E1: insert a second Grund (non-primary), then promote it.
  insert into public.customer_insurance
    (customer_id, partner_insurer_id, insurance_type, insurance_number, is_primary)
  values (v_fixture.customer_id, v_fixture.visana_id, 'grund', 'V-003', false)
  returning id into v_grund_b;

  -- snapshot
  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'customer_insurance'
     and entity_id in (v_fixture.grund_a_id, v_grund_b)
     and action = 'customer_insurance_updated';

  perform public.set_primary_customer_insurance(v_grund_b);

  select is_primary into v_grund_a_primary
    from public.customer_insurance where id = v_fixture.grund_a_id;
  select is_primary into v_grund_b_primary
    from public.customer_insurance where id = v_grund_b;

  declare
    v_audit_after integer;
  begin
    select count(*) into v_audit_after
      from public.audit_log
     where entity = 'customer_insurance'
       and entity_id in (v_fixture.grund_a_id, v_grund_b)
       and action = 'customer_insurance_updated';
    if not v_grund_a_primary and v_grund_b_primary
       and (v_audit_after - v_audit_count) = 2 then
      insert into smoke_results values ('E1', 'PASS',
        'same-type promote+demote → 2 audit rows');
    else
      insert into smoke_results values ('E1', 'FAIL',
        format('a=%s b=%s delta=%s', v_grund_a_primary, v_grund_b_primary,
               (v_audit_after - v_audit_count)));
    end if;
  end;

  -- E2: cross-type — current Zusatz primary stays primary; promoting it
  -- emits no rows (already primary). To exercise the cross-type case, we
  -- demote the Zusatz primary first then promote it back; only one update
  -- (the promote) should produce an audit row, and the Grund primary
  -- (v_grund_b) must be unaffected.
  update public.customer_insurance
     set is_primary = false
   where id = v_fixture.zusatz_a_id;

  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'customer_insurance'
     and entity_id in (v_grund_b, v_fixture.zusatz_a_id)
     and action = 'customer_insurance_updated';

  perform public.set_primary_customer_insurance(v_fixture.zusatz_a_id);

  select is_primary into v_grund_b_primary
    from public.customer_insurance where id = v_grund_b;
  select is_primary into v_zusatz_a_primary
    from public.customer_insurance where id = v_fixture.zusatz_a_id;

  declare
    v_audit_after integer;
  begin
    select count(*) into v_audit_after
      from public.audit_log
     where entity = 'customer_insurance'
       and entity_id in (v_grund_b, v_fixture.zusatz_a_id)
       and action = 'customer_insurance_updated';
    if v_grund_b_primary and v_zusatz_a_primary
       and (v_audit_after - v_audit_count) = 1 then
      insert into smoke_results values ('E2', 'PASS',
        'cross-type promote → 1 audit row, Grund primary unaffected');
    else
      insert into smoke_results values ('E2', 'FAIL',
        format('grund_b=%s zusatz=%s delta=%s', v_grund_b_primary,
               v_zusatz_a_primary, (v_audit_after - v_audit_count)));
    end if;
  end;

  -- Cleanup the v_grund_b extra row.
  delete from public.customer_insurance where id = v_grund_b;

  reset role;
  reset request.jwt.claims;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case F — soft-delete emits 1 audit row.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture     smoke_fixture%rowtype;
  v_admin       smoke_roles%rowtype;
  v_claims      text;
  v_audit_before integer;
  v_audit_after  integer;
begin
  select * into v_fixture from smoke_fixture limit 1;
  select * into v_admin   from smoke_roles where role_key = 'admin';
  v_claims := json_build_object(
    'sub', v_admin.user_id::text, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  select count(*) into v_audit_before
    from public.audit_log
   where entity = 'customer_insurance'
     and entity_id = v_fixture.zusatz_a_id
     and action = 'customer_insurance_updated';

  update public.customer_insurance
     set is_active = false
   where id = v_fixture.zusatz_a_id;

  select count(*) into v_audit_after
    from public.audit_log
   where entity = 'customer_insurance'
     and entity_id = v_fixture.zusatz_a_id
     and action = 'customer_insurance_updated';
  reset role;
  reset request.jwt.claims;

  if v_audit_after - v_audit_before = 1 then
    insert into smoke_results values ('F', 'PASS',
      'soft-delete emitted 1 audit row delta');
  else
    insert into smoke_results values ('F', 'FAIL',
      format('expected delta=1 got before=%s after=%s',
             v_audit_before, v_audit_after));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case G — INSERT emits 1 audit row; single-field UPDATE emits 1 audit row.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture     smoke_fixture%rowtype;
  v_admin       smoke_roles%rowtype;
  v_claims      text;
  v_new_id      uuid;
  v_audit_ins   integer;
  v_audit_upd   integer;
begin
  select * into v_fixture from smoke_fixture limit 1;
  select * into v_admin   from smoke_roles where role_key = 'admin';
  v_claims := json_build_object(
    'sub', v_admin.user_id::text, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  insert into public.customer_insurance
    (customer_id, insurer_name_freetext, insurance_type, is_primary)
  values
    (v_fixture.customer_id, 'Smoke-G Concordia', 'zusatz', false)
  returning id into v_new_id;

  select count(*) into v_audit_ins
    from public.audit_log
   where entity = 'customer_insurance'
     and entity_id = v_new_id
     and action = 'customer_insurance_created';

  update public.customer_insurance
     set insurance_number = 'V-G-001'
   where id = v_new_id;

  select count(*) into v_audit_upd
    from public.audit_log
   where entity = 'customer_insurance'
     and entity_id = v_new_id
     and action = 'customer_insurance_updated';

  -- Cleanup the row.
  delete from public.customer_insurance where id = v_new_id;

  reset role;
  reset request.jwt.claims;

  if v_audit_ins = 1 and v_audit_upd = 1 then
    insert into smoke_results values ('G', 'PASS',
      format('insert=%s update=%s', v_audit_ins, v_audit_upd));
  else
    insert into smoke_results values ('G', 'FAIL',
      format('expected 1+1 got insert=%s update=%s', v_audit_ins, v_audit_upd));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case H — set_primary_customer_insurance role gate.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r          record;
  v_claims   text;
  v_state    text;
  v_fixture  smoke_fixture%rowtype;
begin
  select * into v_fixture from smoke_fixture limit 1;
  for r in select * from smoke_roles loop
    v_state := null;
    begin
      v_claims := json_build_object(
        'sub', r.user_id::text, 'role', 'authenticated',
        'app_metadata', jsonb_build_object('app_role', r.app_role)
      )::text;
      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);

      perform public.set_primary_customer_insurance(v_fixture.grund_a_id);
      v_state := 'OK';
    exception when others then
      v_state := sqlstate;
    end;
    reset role;
    reset request.jwt.claims;

    if r.app_role in ('admin','office') then
      if v_state = 'OK' then
        insert into smoke_results values ('H:' || r.role_key, 'PASS', 'allowed');
      else
        insert into smoke_results values ('H:' || r.role_key, 'FAIL',
          format('expected OK got %s', v_state));
      end if;
    else
      if v_state = '42501' then
        insert into smoke_results values ('H:' || r.role_key, 'PASS',
          'permission denied as expected');
      else
        insert into smoke_results values ('H:' || r.role_key, 'FAIL',
          format('expected 42501 got %s', v_state));
      end if;
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Cleanup — fixture customer cascades insurance rows; audit rows survive.
-- ---------------------------------------------------------------------------

do $cleanup$
declare
  v_fixture smoke_fixture%rowtype;
begin
  select * into v_fixture from smoke_fixture limit 1;
  delete from public.customers where id = v_fixture.customer_id;
end;
$cleanup$;

-- Z — residue assertion.
do $z$
declare
  v_remaining integer;
  v_fixture   smoke_fixture%rowtype;
begin
  select * into v_fixture from smoke_fixture limit 1;
  select count(*) into v_remaining
    from public.customer_insurance
   where customer_id = v_fixture.customer_id;
  if v_remaining = 0 then
    insert into smoke_results values ('Z', 'PASS', 'no fixtures left');
  else
    insert into smoke_results values ('Z', 'FAIL',
      format('%s residual insurance rows', v_remaining));
  end if;
end;
$z$;

-- ---------------------------------------------------------------------------
-- Final result
-- ---------------------------------------------------------------------------

select case_id, status, detail from smoke_results order by case_id;
