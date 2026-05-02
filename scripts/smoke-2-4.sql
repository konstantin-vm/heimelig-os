-- Story 2.4 smoke matrix — customer_addresses non-primary CRUD,
-- Hauptadresse-pro-Typ RPC, audit log, RLS, partial-unique enforcement.
-- Executed via: supabase db query --linked -f scripts/smoke-2-4.sql
--
-- Matrix cases (AC8 + AC10 + AC12):
--   A   RLS SELECT — admin + office can read; technician + warehouse cannot.
--   B   RLS INSERT — admin + office succeed; technician + warehouse 42501.
--   C1  Two non-primary delivery addresses with different is_default_for_type
--       coexist (default + non-default).
--   C2  Inserting a 2nd is_default_for_type=true delivery address WITHOUT
--       going through the RPC raises 23505 against
--       idx_customer_addresses_default_per_type_unique.
--   D1  set_default_customer_address on a customer with a prior default of
--       the SAME type — exactly 2 audit rows (demote + promote) AND moves
--       the default flag.
--   D2  Same RPC on a customer with a prior default of a DIFFERENT type —
--       exactly 1 audit row (promote only — no cross-type demote).
--   D3  Same RPC on a soft-deleted target — raises P0002.
--   D4  Same RPC on address_type='primary' target — raises an explicit error
--       (errcode 22023, message mentions "primary defaults are managed by
--       Story 2.1 RPCs").
--   E1  Soft-delete sets is_active=false AND is_default_for_type=false,
--       releasing the partial-unique slot — a new default of the same type
--       can immediately be inserted post-delete (no 23505).
--   E2  Single-field UPDATE (e.g. access_notes) emits one audit_log row
--       with the correct delta + the row's audit timestamp matches the
--       transaction start (filter on action='customer_addresses_updated').
--   F   RPC role gate — admin/office allow; technician/warehouse 42501.
--   G   Soft-delete + restore round-trip — restored row comes back as
--       non-default (is_default_for_type stays false; user must re-toggle
--       Hauptadresse).
--   Z   Residue clean — no smoke fixtures remain after teardown.

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

-- Setup — one customer with primary address, plus one delivery (default) and
-- one billing (default) row.

create temp table smoke_fixture (
  customer_id        uuid,
  primary_id         uuid,
  delivery_a_id      uuid,
  billing_a_id       uuid
) on commit drop;

grant all on smoke_fixture to authenticated;

do $setup$
declare
  v_customer_id uuid;
  v_primary     uuid;
  v_delivery_a  uuid;
  v_billing_a   uuid;
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

  v_customer_id := public.create_customer_with_primary_address(
    jsonb_build_object(
      'customer_type','private',
      'first_name','Smoke','last_name','Two-Four',
      'phone','+41 79 000 24 24','language','de'
    ),
    jsonb_build_object('street','Adress Strasse','street_number','24',
                       'zip','8024','city','Zürich','country','CH')
  );

  select id into v_primary
    from public.customer_addresses
   where customer_id = v_customer_id
     and address_type = 'primary'
     and is_default_for_type;

  insert into public.customer_addresses
    (customer_id, address_type, is_default_for_type,
     street, street_number, zip, city, country, access_notes)
  values
    (v_customer_id, 'delivery', true,
     'Lieferweg', '12', '8002', 'Zürich', 'CH',
     'Schlüssel beim Hauswart')
  returning id into v_delivery_a;

  insert into public.customer_addresses
    (customer_id, address_type, is_default_for_type,
     street, street_number, zip, city, country, recipient_name)
  values
    (v_customer_id, 'billing', true,
     'Rechnungsallee', '5', '8001', 'Zürich', 'CH',
     'Krankenkasse Helsana')
  returning id into v_billing_a;

  insert into smoke_fixture values
    (v_customer_id, v_primary, v_delivery_a, v_billing_a);

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
        from public.customer_addresses
       where customer_id = v_fixture.customer_id;
    exception when others then
      v_count := -1;
    end;
    reset role;
    reset request.jwt.claims;

    if r.app_role in ('admin','office') then
      if v_count = 3 then
        insert into smoke_results values ('A:' || r.role_key, 'PASS', '3 rows');
      else
        insert into smoke_results values ('A:' || r.role_key, 'FAIL',
          format('expected 3 rows, got %s', v_count));
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

      insert into public.customer_addresses
        (customer_id, address_type, is_default_for_type,
         street, zip, city, country)
      values (v_fixture.customer_id, 'other', false,
              'Smoke-Insert-' || r.role_key, '8000', 'Zürich', 'CH')
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
        delete from public.customer_addresses where id = v_id;
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
--   C1: a delivery default + a delivery non-default coexist.
--   C2: trying to insert a 2nd delivery default raises 23505.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture     smoke_fixture%rowtype;
  v_admin       smoke_roles%rowtype;
  v_claims      text;
  v_state       text := null;
  v_default_count integer;
  v_extra_id    uuid;
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

  -- C1: insert a delivery non-default → coexists with delivery_a (default).
  insert into public.customer_addresses
    (customer_id, address_type, is_default_for_type,
     street, zip, city, country)
  values (v_fixture.customer_id, 'delivery', false,
          'Lieferweg-Extra', '8002', 'Zürich', 'CH')
  returning id into v_extra_id;

  select count(*) into v_default_count
    from public.customer_addresses
   where customer_id = v_fixture.customer_id
     and address_type = 'delivery';

  if v_default_count = 2 then
    insert into smoke_results values ('C1', 'PASS',
      'delivery default + non-default coexist');
  else
    insert into smoke_results values ('C1', 'FAIL',
      format('expected 2 delivery rows, got %s', v_default_count));
  end if;

  -- C2: second delivery default → 23505 (collides with delivery_a_id).
  begin
    insert into public.customer_addresses
      (customer_id, address_type, is_default_for_type,
       street, zip, city, country)
    values (v_fixture.customer_id, 'delivery', true,
            'Dup-Default', '8003', 'Zürich', 'CH');
  exception when unique_violation then
    v_state := '23505';
  when others then
    v_state := sqlstate;
  end;

  -- Cleanup the C1 extra row.
  delete from public.customer_addresses where id = v_extra_id;

  reset role;
  reset request.jwt.claims;

  if v_state = '23505' then
    insert into smoke_results values ('C2', 'PASS',
      'second delivery default rejected (23505)');
  else
    insert into smoke_results values ('C2', 'FAIL',
      format('expected 23505, got %s', coalesce(v_state, 'no error')));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case D — set_default_customer_address — same-type / cross-type / inactive
--          / primary-rejection.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture     smoke_fixture%rowtype;
  v_admin       smoke_roles%rowtype;
  v_claims      text;
  v_delivery_b  uuid;
  v_billing_b   uuid;
  v_inactive    uuid;
  v_a_default   boolean;
  v_b_default   boolean;
  v_audit_count integer;
  v_audit_after integer;
  v_state       text;
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

  -- D1: insert a 2nd delivery (non-default), then promote → 2 audit rows.
  insert into public.customer_addresses
    (customer_id, address_type, is_default_for_type,
     street, zip, city, country)
  values (v_fixture.customer_id, 'delivery', false,
          'Lieferweg B', '8004', 'Zürich', 'CH')
  returning id into v_delivery_b;

  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'customer_addresses'
     and entity_id in (v_fixture.delivery_a_id, v_delivery_b)
     and action = 'customer_addresses_updated';

  perform public.set_default_customer_address(v_delivery_b);

  select is_default_for_type into v_a_default
    from public.customer_addresses where id = v_fixture.delivery_a_id;
  select is_default_for_type into v_b_default
    from public.customer_addresses where id = v_delivery_b;

  select count(*) into v_audit_after
    from public.audit_log
   where entity = 'customer_addresses'
     and entity_id in (v_fixture.delivery_a_id, v_delivery_b)
     and action = 'customer_addresses_updated';

  if not v_a_default and v_b_default
     and (v_audit_after - v_audit_count) = 2 then
    insert into smoke_results values ('D1', 'PASS',
      'same-type promote+demote → 2 audit rows');
  else
    insert into smoke_results values ('D1', 'FAIL',
      format('a=%s b=%s delta=%s', v_a_default, v_b_default,
             (v_audit_after - v_audit_count)));
  end if;

  -- D2: cross-type — demote billing_a then promote → 1 audit row,
  -- delivery default stays.
  update public.customer_addresses
     set is_default_for_type = false
   where id = v_fixture.billing_a_id;

  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'customer_addresses'
     and entity_id in (v_delivery_b, v_fixture.billing_a_id)
     and action = 'customer_addresses_updated';

  perform public.set_default_customer_address(v_fixture.billing_a_id);

  select is_default_for_type into v_a_default  -- delivery_b should still be default
    from public.customer_addresses where id = v_delivery_b;
  select is_default_for_type into v_b_default  -- billing_a should be default again
    from public.customer_addresses where id = v_fixture.billing_a_id;

  select count(*) into v_audit_after
    from public.audit_log
   where entity = 'customer_addresses'
     and entity_id in (v_delivery_b, v_fixture.billing_a_id)
     and action = 'customer_addresses_updated';

  if v_a_default and v_b_default
     and (v_audit_after - v_audit_count) = 1 then
    insert into smoke_results values ('D2', 'PASS',
      'cross-type promote → 1 audit row, delivery default unaffected');
  else
    insert into smoke_results values ('D2', 'FAIL',
      format('delivery_b=%s billing_a=%s delta=%s', v_a_default, v_b_default,
             (v_audit_after - v_audit_count)));
  end if;

  -- D3: soft-deleted target → P0002.
  insert into public.customer_addresses
    (customer_id, address_type, is_default_for_type, is_active,
     street, zip, city, country)
  values (v_fixture.customer_id, 'other', false, false,
          'Inactive Other', '8005', 'Zürich', 'CH')
  returning id into v_inactive;

  v_state := null;
  begin
    perform public.set_default_customer_address(v_inactive);
    v_state := 'OK';
  exception when others then
    v_state := sqlstate;
  end;

  if v_state = 'P0002' then
    insert into smoke_results values ('D3', 'PASS',
      'inactive target → P0002 as expected');
  else
    insert into smoke_results values ('D3', 'FAIL',
      format('expected P0002, got %s', v_state));
  end if;

  -- D4: address_type='primary' target → explicit error (22023).
  v_state := null;
  begin
    perform public.set_default_customer_address(v_fixture.primary_id);
    v_state := 'OK';
  exception when others then
    v_state := sqlstate;
  end;

  if v_state = '22023' then
    insert into smoke_results values ('D4', 'PASS',
      'primary target rejected with 22023');
  else
    insert into smoke_results values ('D4', 'FAIL',
      format('expected 22023, got %s', v_state));
  end if;

  -- Cleanup intermediate fixtures.
  delete from public.customer_addresses where id in (v_delivery_b, v_inactive);

  reset role;
  reset request.jwt.claims;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case E1 — soft-delete releases the partial-unique slot.
--   Sequence: delivery_a is currently default. Soft-delete it (sets
--   is_active=false AND is_default_for_type=false). Then insert a fresh
--   delivery default — must succeed (no 23505).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture     smoke_fixture%rowtype;
  v_admin       smoke_roles%rowtype;
  v_claims      text;
  v_replaced    uuid;
  v_state       text;
  v_a_default   boolean;
  v_a_active    boolean;
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

  update public.customer_addresses
     set is_active = false,
         is_default_for_type = false
   where id = v_fixture.delivery_a_id;

  select is_active, is_default_for_type
    into v_a_active, v_a_default
    from public.customer_addresses where id = v_fixture.delivery_a_id;

  v_state := null;
  begin
    insert into public.customer_addresses
      (customer_id, address_type, is_default_for_type,
       street, zip, city, country)
    values (v_fixture.customer_id, 'delivery', true,
            'Replacement', '8006', 'Zürich', 'CH')
    returning id into v_replaced;
    v_state := 'OK';
  exception when others then
    v_state := sqlstate;
  end;

  if v_state = 'OK' and not v_a_active and not v_a_default then
    insert into smoke_results values ('E1', 'PASS',
      'soft-delete cleared default → new default insertable');
  else
    insert into smoke_results values ('E1', 'FAIL',
      format('insert state=%s a_active=%s a_default=%s', v_state,
             v_a_active, v_a_default));
  end if;

  -- Cleanup replacement and restore delivery_a for downstream cases (G).
  if v_replaced is not null then
    delete from public.customer_addresses where id = v_replaced;
  end if;

  reset role;
  reset request.jwt.claims;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case E2 — single-field UPDATE (access_notes) emits 1 audit row + audit
-- timestamp matches transaction start (Story 2.1.1 review pattern).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture        smoke_fixture%rowtype;
  v_admin          smoke_roles%rowtype;
  v_claims         text;
  v_extra_id       uuid;
  v_audit_before   integer;
  v_audit_after    integer;
  v_audit_at       timestamptz;
  v_txn_started_at timestamptz;
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

  -- Use a fresh row (delivery_a was soft-deleted in E1) so the audit count
  -- baseline is stable.
  insert into public.customer_addresses
    (customer_id, address_type, is_default_for_type,
     street, zip, city, country, access_notes)
  values (v_fixture.customer_id, 'other', false,
          'E2-Source', '8007', 'Zürich', 'CH',
          'before')
  returning id into v_extra_id;

  select count(*) into v_audit_before
    from public.audit_log
   where entity = 'customer_addresses'
     and entity_id = v_extra_id
     and action = 'customer_addresses_updated';

  v_txn_started_at := transaction_timestamp();

  update public.customer_addresses
     set access_notes = 'after'
   where id = v_extra_id;

  select count(*), max(created_at) into v_audit_after, v_audit_at
    from public.audit_log
   where entity = 'customer_addresses'
     and entity_id = v_extra_id
     and action = 'customer_addresses_updated';

  delete from public.customer_addresses where id = v_extra_id;

  reset role;
  reset request.jwt.claims;

  if (v_audit_after - v_audit_before) = 1
     and v_audit_at >= v_txn_started_at then
    insert into smoke_results values ('E2', 'PASS',
      'single-field update → 1 audit row, txn-start timestamp');
  else
    insert into smoke_results values ('E2', 'FAIL',
      format('delta=%s txn=%s audit=%s',
             (v_audit_after - v_audit_before), v_txn_started_at, v_audit_at));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case F — set_default_customer_address role gate.
-- ---------------------------------------------------------------------------

do $outer$
declare
  r          record;
  v_claims   text;
  v_state    text;
  v_target   uuid;
  v_admin    smoke_roles%rowtype;
  v_admin_claims text;
  v_fixture  smoke_fixture%rowtype;
begin
  select * into v_fixture from smoke_fixture limit 1;
  select * into v_admin   from smoke_roles where role_key = 'admin';

  -- Fresh active billing target so the 4-role loop has a row to promote.
  v_admin_claims := json_build_object(
    'sub', v_admin.user_id::text, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_admin_claims);
  insert into public.customer_addresses
    (customer_id, address_type, is_default_for_type,
     street, zip, city, country)
  values (v_fixture.customer_id, 'other', false,
          'F-Other', '8008', 'Zürich', 'CH')
  returning id into v_target;
  reset role;
  reset request.jwt.claims;

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

      perform public.set_default_customer_address(v_target);
      v_state := 'OK';
    exception when others then
      v_state := sqlstate;
    end;
    reset role;
    reset request.jwt.claims;

    if r.app_role in ('admin','office') then
      if v_state = 'OK' then
        insert into smoke_results values ('F:' || r.role_key, 'PASS', 'allowed');
      else
        insert into smoke_results values ('F:' || r.role_key, 'FAIL',
          format('expected OK got %s', v_state));
      end if;
    else
      if v_state = '42501' then
        insert into smoke_results values ('F:' || r.role_key, 'PASS',
          'permission denied as expected');
      else
        insert into smoke_results values ('F:' || r.role_key, 'FAIL',
          format('expected 42501 got %s', v_state));
      end if;
    end if;
  end loop;

  -- Cleanup the F target.
  v_admin_claims := json_build_object(
    'sub', v_admin.user_id::text, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_admin_claims);
  delete from public.customer_addresses where id = v_target;
  reset role;
  reset request.jwt.claims;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case G — Soft-delete + restore round-trip — restored row is non-default.
--   delivery_a was soft-deleted in E1 (is_active=false, is_default=false).
--   Restore via UPDATE (the app uses { is_active: true } only, leaving
--   is_default_for_type=false). Verify restored row is non-default.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture      smoke_fixture%rowtype;
  v_admin        smoke_roles%rowtype;
  v_claims       text;
  v_a_active     boolean;
  v_a_default    boolean;
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

  update public.customer_addresses
     set is_active = true
   where id = v_fixture.delivery_a_id;

  select is_active, is_default_for_type
    into v_a_active, v_a_default
    from public.customer_addresses where id = v_fixture.delivery_a_id;

  reset role;
  reset request.jwt.claims;

  if v_a_active and not v_a_default then
    insert into smoke_results values ('G', 'PASS',
      'restore → is_active=true, is_default_for_type=false');
  else
    insert into smoke_results values ('G', 'FAIL',
      format('expected active=true default=false; got active=%s default=%s',
             v_a_active, v_a_default));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Cleanup — fixture customer cascades address rows; audit rows survive.
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
    from public.customer_addresses
   where customer_id = v_fixture.customer_id;
  if v_remaining = 0 then
    insert into smoke_results values ('Z', 'PASS', 'no fixtures left');
  else
    insert into smoke_results values ('Z', 'FAIL',
      format('%s residual address rows', v_remaining));
  end if;
end;
$z$;

-- ---------------------------------------------------------------------------
-- Final result
-- ---------------------------------------------------------------------------

select case_id, status, detail from smoke_results order by case_id;
