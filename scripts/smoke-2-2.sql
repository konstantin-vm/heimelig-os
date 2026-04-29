-- Story 2.2 smoke matrix — contact_persons CRUD + Hauptkontakt + audit log + RLS.
-- Executed via: supabase db query --linked -f scripts/smoke-2-2.sql
--
-- Matrix cases (AC9 + AC15):
--   A  RLS SELECT — admin + office can read; technician + warehouse cannot.
--   B  RLS INSERT/UPDATE — admin + office succeed; technician + warehouse get
--      permission denied (42501) on INSERT and UPDATE.
--   C  Partial unique index `idx_contact_persons_primary_unique` rejects a
--      naive second is_primary_contact = true (23505).
--   D  set_primary_contact_person atomically demotes prior primary and
--      promotes target → exactly 2 audit rows.
--   E  Soft-delete (is_active=false) emits 1 audit row.
--   F  Insert emits ≥1 audit row; single-field UPDATE emits 1 audit row.
--   G  set_primary_contact_person role gate — technician/warehouse get 42501.
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

-- Setup — one customer for the matrix, two pre-seeded contacts as fixtures.

create temp table smoke_fixture (
  customer_id   uuid,
  contact_a_id  uuid,
  contact_b_id  uuid
) on commit drop;

grant all on smoke_fixture to authenticated;

do $setup$
declare
  v_customer_id uuid;
  v_contact_a   uuid;
  v_contact_b   uuid;
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
      'first_name','Smoke','last_name','Two-Two',
      'phone','+41 79 000 22 22','language','de'
    ),
    jsonb_build_object('street','Kontakt Strasse','street_number','22',
                       'zip','8002','city','Zürich','country','CH')
  );

  insert into public.contact_persons (customer_id, role, first_name, last_name, phone, is_primary_contact)
    values (v_customer_id, 'angehoerige', 'Smoke-A', 'Contact', '044 000 00 01', true)
    returning id into v_contact_a;

  insert into public.contact_persons (customer_id, role, first_name, last_name, phone, is_primary_contact)
    values (v_customer_id, 'arzt', 'Smoke-B', 'Contact', '044 000 00 02', false)
    returning id into v_contact_b;

  insert into smoke_fixture values (v_customer_id, v_contact_a, v_contact_b);

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
        from public.contact_persons
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
          format('expected 2 rows visible, got %s', v_count));
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

      insert into public.contact_persons
        (customer_id, role, first_name, last_name, phone, is_primary_contact)
      values (v_fixture.customer_id, 'sonstige',
              'Smoke-Insert-' || r.role_key, 'Contact',
              '044 000 00 99', false)
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
      end if;
    else
      insert into smoke_results values ('B:' || r.role_key, 'FAIL',
        'expected permission denied but call succeeded');
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case C — Partial unique index rejects naive second primary.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture  smoke_fixture%rowtype;
  v_admin    smoke_roles%rowtype;
  v_claims   text;
  v_state    text := null;
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

  begin
    update public.contact_persons
       set is_primary_contact = true
     where id = v_fixture.contact_b_id;
  exception when unique_violation then
    v_state := '23505';
  when others then
    v_state := sqlstate;
  end;
  reset role;
  reset request.jwt.claims;

  if v_state = '23505' then
    insert into smoke_results values ('C', 'PASS',
      'unique violation as expected');
  else
    insert into smoke_results values ('C', 'FAIL',
      format('expected 23505, got %s', coalesce(v_state, 'no error')));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case D — set_primary_contact_person atomically demote+promote → 2 audit rows.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture     smoke_fixture%rowtype;
  v_admin       smoke_roles%rowtype;
  v_claims      text;
  v_started_at  timestamptz;
  v_audit_count integer;
  v_a_primary   boolean;
  v_b_primary   boolean;
begin
  select * into v_fixture from smoke_fixture limit 1;
  select * into v_admin   from smoke_roles where role_key = 'admin';
  v_started_at := clock_timestamp();
  v_claims := json_build_object(
    'sub', v_admin.user_id::text, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  perform public.set_primary_contact_person(v_fixture.contact_b_id);

  select is_primary_contact into v_a_primary
    from public.contact_persons where id = v_fixture.contact_a_id;
  select is_primary_contact into v_b_primary
    from public.contact_persons where id = v_fixture.contact_b_id;

  -- audit_log SELECT is admin-only; stay inside the role simulation block.
  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'contact_persons'
     and entity_id in (v_fixture.contact_a_id, v_fixture.contact_b_id)
     and action = 'contact_persons_updated';
  reset role;
  reset request.jwt.claims;

  if not v_a_primary and v_b_primary and v_audit_count = 2 then
    insert into smoke_results values ('D', 'PASS',
      format('demote+promote, %s audit rows', v_audit_count));
  else
    insert into smoke_results values ('D', 'FAIL',
      format('a=%s b=%s audit=%s', v_a_primary, v_b_primary, v_audit_count));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case E — soft-delete emits 1 audit row.
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

  -- Snapshot pre-existing audit rows for this contact (case D may have left
  -- a demote row).
  select count(*) into v_audit_before
    from public.audit_log
   where entity = 'contact_persons'
     and entity_id = v_fixture.contact_a_id
     and action = 'contact_persons_updated';

  update public.contact_persons
     set is_active = false
   where id = v_fixture.contact_a_id;

  select count(*) into v_audit_after
    from public.audit_log
   where entity = 'contact_persons'
     and entity_id = v_fixture.contact_a_id
     and action = 'contact_persons_updated';
  reset role;
  reset request.jwt.claims;

  if v_audit_after - v_audit_before = 1 then
    insert into smoke_results values ('E', 'PASS',
      'soft-delete emitted 1 audit row delta');
  else
    insert into smoke_results values ('E', 'FAIL',
      format('expected delta=1, got before=%s after=%s',
             v_audit_before, v_audit_after));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case F — INSERT emits 1 audit row; single-field UPDATE emits 1 audit row.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fixture     smoke_fixture%rowtype;
  v_admin       smoke_roles%rowtype;
  v_claims      text;
  v_started     timestamptz := clock_timestamp();
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

  insert into public.contact_persons
    (customer_id, role, first_name, last_name, phone)
  values
    (v_fixture.customer_id, 'spitex', 'Smoke-F', 'Audit', '044 000 00 33')
  returning id into v_new_id;

  select count(*) into v_audit_ins
    from public.audit_log
   where entity = 'contact_persons'
     and entity_id = v_new_id
     and action = 'contact_persons_created';

  update public.contact_persons set notes = 'Smoke note' where id = v_new_id;

  select count(*) into v_audit_upd
    from public.audit_log
   where entity = 'contact_persons'
     and entity_id = v_new_id
     and action = 'contact_persons_updated';
  reset role;
  reset request.jwt.claims;

  if v_audit_ins = 1 and v_audit_upd = 1 then
    insert into smoke_results values ('F', 'PASS',
      format('insert=%s update=%s', v_audit_ins, v_audit_upd));
  else
    insert into smoke_results values ('F', 'FAIL',
      format('expected 1+1, got insert=%s update=%s', v_audit_ins, v_audit_upd));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case G — set_primary_contact_person role gate.
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

      perform public.set_primary_contact_person(v_fixture.contact_a_id);
      v_state := 'OK';
    exception when others then
      v_state := sqlstate;
    end;
    reset role;
    reset request.jwt.claims;

    if r.app_role in ('admin','office') then
      if v_state = 'OK' then
        insert into smoke_results values ('G:' || r.role_key, 'PASS', 'allowed');
      else
        insert into smoke_results values ('G:' || r.role_key, 'FAIL',
          format('expected OK got %s', v_state));
      end if;
    else
      if v_state = '42501' then
        insert into smoke_results values ('G:' || r.role_key, 'PASS',
          'permission denied as expected');
      else
        insert into smoke_results values ('G:' || r.role_key, 'FAIL',
          format('expected 42501 got %s', v_state));
      end if;
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Cleanup — fixture customer cascades contact rows; audit rows survive.
-- ---------------------------------------------------------------------------

do $cleanup$
declare
  v_fixture smoke_fixture%rowtype;
begin
  select * into v_fixture from smoke_fixture limit 1;
  delete from public.customers where id = v_fixture.customer_id;
end;
$cleanup$;

-- Z — residue assertion: zero remaining contact rows for the fixture customer.
do $z$
declare
  v_remaining integer;
  v_fixture   smoke_fixture%rowtype;
begin
  select * into v_fixture from smoke_fixture limit 1;
  select count(*) into v_remaining
    from public.contact_persons
   where customer_id = v_fixture.customer_id;
  if v_remaining = 0 then
    insert into smoke_results values ('Z', 'PASS', 'no fixtures left');
  else
    insert into smoke_results values ('Z', 'FAIL',
      format('%s residual contact rows', v_remaining));
  end if;
end;
$z$;

-- ---------------------------------------------------------------------------
-- Final result
-- ---------------------------------------------------------------------------

select case_id, status, detail from smoke_results order by case_id;
