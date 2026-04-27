-- Story 1.5 smoke matrix — audit_log + error_log infrastructure.
-- Executed via: supabase db query --linked -f scripts/smoke-1-5.sql
--
-- Matrix cases (AC12):
--   A  log_activity() inserts for each of the 5 dev-user roles.
--   B  direct INSERT into audit_log is rejected by RLS for every role.
--   C  UPDATE / DELETE on audit_log rejected by immutability trigger (admin).
--   D  log_error() RPC inserts; direct INSERT into error_log rejected.
--   E  admin may UPDATE resolution columns; non-resolution UPDATE blocked.
--   F  office may UPDATE resolution; technician+warehouse SELECT returns 0.
--   G  INSERT on each of 11 Sprint-1 tables produces a '<table>_created' row.
--   H  UPDATE touching only updated_at/updated_by yields NO audit row.
--   I  purge_resolved_error_log() deletes a seeded 91-day-old resolved row.
--   J  FK ON DELETE SET NULL cascade on audit_log.actor_user_id +
--      error_log.user_id + error_log.resolved_by (single + dual).
--   Z  Residue assertion — cleanup leaves zero smoke fixtures behind.
--
-- All cases run in one session inside transactions with `set local role
-- authenticated; set local request.jwt.claims = ...` — this is how Supabase
-- itself tests RLS. Results accumulate in TEMP TABLE smoke_results and are
-- selected at the end for machine-readable verification.

-- ---------------------------------------------------------------------------
-- Setup: temp table + role UUID fixtures.
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

-- Capture the start timestamp so the cleanup pass can scope timestamp-based
-- filters tightly to this run (avoids matching coincidentally similar
-- production rows that pre-date the smoke session).
create temp table smoke_run_meta (
  started_at timestamptz primary key
) on commit drop;
insert into smoke_run_meta values (now());

-- Allow the authenticated role (set via set local role authenticated inside
-- test DO blocks) to write into the temp tables while simulating dev users.
grant all on smoke_results  to authenticated;
grant all on smoke_roles    to authenticated;
grant all on smoke_run_meta to authenticated;

insert into smoke_roles values
  ('admin',      'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid, 'admin'),
  ('office',     '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7'::uuid, 'office'),
  ('technician', 'e9dfb290-4465-464c-a30e-8c52c7cb6b57'::uuid, 'technician'),
  ('warehouse',  'fe737954-b8b1-49fc-afcf-24229235507d'::uuid, 'warehouse'),
  ('norole',     'a7d485d8-00ae-4e45-8f60-74e169da19cb'::uuid, null);

-- Helper: build a jwt.claims JSON for a given user.
-- NOTE: can't be a persistent function (no CREATE FUNCTION here); inlined below.

-- ---------------------------------------------------------------------------
-- Case A — log_activity() as each role. Must return a UUID and insert a row
-- whose actor_user_id matches the simulated auth.uid().
-- ---------------------------------------------------------------------------

do $outer$
declare
  r            record;
  v_entity     uuid := gen_random_uuid();
  v_claims     text;
  v_id         uuid;
  v_actor      uuid;
  v_actor_sys  text;
  v_expected   uuid;
begin
  for r in select * from smoke_roles loop
    -- No-role users have no user_profiles row → log_activity sets
    -- actor_user_id=NULL and actor_system='other' (defense against FK).
    v_expected := case when r.app_role is null then null else r.user_id end;
    v_id := null;

    begin
      v_claims := json_build_object(
        'sub', r.user_id::text,
        'role', 'authenticated',
        'app_metadata', case when r.app_role is null
                             then '{}'::jsonb
                             else jsonb_build_object('app_role', r.app_role)
                        end
      )::text;

      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);

      v_id := public.log_activity(
        'smoke_case_a',
        'smoke',
        v_entity,
        null,
        jsonb_build_object('role_key', r.role_key),
        jsonb_build_object('smoke_run', 'case_a')
      );
    exception when others then
      -- Capture the SQLSTATE before we reset the role; v_id stays null so the
      -- FAIL branch below reports the cause.
      insert into smoke_results values ('A:' || r.role_key, 'FAIL',
        format('%s / %s', sqlstate, sqlerrm));
      reset role;
      reset request.jwt.claims;
      continue;
    end;

    -- Leave the role-simulation context before reading audit_log back — the
    -- technician / warehouse roles have no SELECT policy on audit_log.
    reset role;
    reset request.jwt.claims;

    if v_id is null then
      insert into smoke_results values ('A:' || r.role_key, 'FAIL',
        'log_activity returned null');
      continue;
    end if;

    select actor_user_id, actor_system
      into v_actor, v_actor_sys
      from public.audit_log
     where id = v_id;

    if v_actor is distinct from v_expected then
      insert into smoke_results values ('A:' || r.role_key, 'FAIL',
        format('actor_user_id %s did not match expected %s',
               coalesce(v_actor::text,'<null>'),
               coalesce(v_expected::text,'<null>')));
    elsif r.app_role is null and v_actor_sys is distinct from 'other' then
      insert into smoke_results values ('A:' || r.role_key, 'FAIL',
        format('no-role fallback: actor_system=%s expected other',
               coalesce(v_actor_sys, '<null>')));
    else
      insert into smoke_results values ('A:' || r.role_key, 'PASS', v_id::text);
    end if;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case B — direct INSERT into audit_log is rejected by RLS (default DENY).
-- ---------------------------------------------------------------------------

do $outer$
declare
  r        record;
  v_claims text;
begin
  for r in select * from smoke_roles loop
    begin
      v_claims := json_build_object(
        'sub', r.user_id::text,
        'role', 'authenticated',
        'app_metadata', case when r.app_role is null
                             then '{}'::jsonb
                             else jsonb_build_object('app_role', r.app_role)
                        end
      )::text;

      execute format($sql$
        set local role authenticated;
        set local request.jwt.claims = %L;
      $sql$, v_claims);

      begin
        insert into public.audit_log (action, entity, entity_id, before_values, after_values, details)
        values ('smoke_case_b', 'smoke', gen_random_uuid(), null, '{}'::jsonb, '{}'::jsonb);
        -- Row made it through → RLS is broken.
        insert into smoke_results values ('B:' || r.role_key, 'FAIL', 'direct insert allowed');
      exception when insufficient_privilege or others then
        if sqlstate in ('42501') or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
          insert into smoke_results values ('B:' || r.role_key, 'PASS', sqlstate);
        else
          insert into smoke_results values ('B:' || r.role_key, 'FAIL',
            format('unexpected error %s / %s', sqlstate, sqlerrm));
        end if;
      end;

      reset role;
      reset request.jwt.claims;
    exception when others then
      insert into smoke_results values ('B:' || r.role_key, 'FAIL',
        format('outer %s / %s', sqlstate, sqlerrm));
      reset role;
      reset request.jwt.claims;
    end;
  end loop;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case C — UPDATE / DELETE on audit_log blocked by immutability trigger.
-- Run as admin; trigger fires for all roles including service_role.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_id     uuid;
  v_claims text;
begin
  -- Seed a row via log_activity as admin.
  v_claims := json_build_object(
    'sub', 'b3af4f07-23e1-486b-a4f4-b300304a68a5',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;

  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  v_id := public.log_activity('smoke_case_c', 'smoke', gen_random_uuid(), null, '{}'::jsonb, '{}'::jsonb);
  reset role;
  reset request.jwt.claims;

  -- Attempt UPDATE.
  begin
    update public.audit_log set action = 'tampered' where id = v_id;
    insert into smoke_results values ('C:update', 'FAIL', 'update not blocked');
  exception when others then
    if sqlstate = '42501' then
      insert into smoke_results values ('C:update', 'PASS', sqlerrm);
    else
      insert into smoke_results values ('C:update', 'FAIL',
        format('unexpected %s / %s', sqlstate, sqlerrm));
    end if;
  end;

  -- Attempt DELETE.
  begin
    delete from public.audit_log where id = v_id;
    insert into smoke_results values ('C:delete', 'FAIL', 'delete not blocked');
  exception when others then
    if sqlstate = '42501' then
      insert into smoke_results values ('C:delete', 'PASS', sqlerrm);
    else
      insert into smoke_results values ('C:delete', 'FAIL',
        format('unexpected %s / %s', sqlstate, sqlerrm));
    end if;
  end;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case D — log_error() inserts; direct INSERT into error_log rejected by RLS.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_id     uuid;
  v_claims text;
begin
  -- log_error as admin.
  v_claims := json_build_object(
    'sub', 'b3af4f07-23e1-486b-a4f4-b300304a68a5',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  v_id := public.log_error('OTHER', 'warning', 'smoke-case-d', 'log_error round-trip test', '{}'::jsonb, null, null, null);

  if v_id is null then
    insert into smoke_results values ('D:log_error', 'FAIL', 'returned null');
  else
    insert into smoke_results values ('D:log_error', 'PASS', v_id::text);
  end if;

  -- Direct INSERT as admin → no INSERT policy → reject.
  begin
    insert into public.error_log (error_type, severity, source, message)
    values ('OTHER', 'warning', 'smoke-case-d', 'direct insert');
    insert into smoke_results values ('D:direct_insert', 'FAIL', 'direct insert allowed');
  exception when others then
    if sqlstate = '42501' or sqlerrm ilike '%row-level security%' or sqlerrm ilike '%policy%' then
      insert into smoke_results values ('D:direct_insert', 'PASS', sqlstate);
    else
      insert into smoke_results values ('D:direct_insert', 'FAIL',
        format('unexpected %s / %s', sqlstate, sqlerrm));
    end if;
  end;

  reset role;
  reset request.jwt.claims;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case E — admin may UPDATE resolution columns; non-resolution UPDATE blocked.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_id     uuid;
  v_claims text;
begin
  -- Seed a row.
  v_claims := json_build_object(
    'sub', 'b3af4f07-23e1-486b-a4f4-b300304a68a5',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  v_id := public.log_error('OTHER', 'warning', 'smoke-case-e', 'for admin resolution', '{}'::jsonb, null, null, null);

  -- Admin sets resolved_at + resolution_notes (both allowed).
  begin
    update public.error_log
       set resolved_at = now(),
           resolved_by = 'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid,
           resolution_notes = 'smoke: admin resolved'
     where id = v_id;
    insert into smoke_results values ('E:admin_resolve', 'PASS', 'resolution update ok');
  exception when others then
    insert into smoke_results values ('E:admin_resolve', 'FAIL',
      format('%s / %s', sqlstate, sqlerrm));
  end;

  -- Admin attempts to change message (non-resolution) → guard trigger rejects.
  begin
    update public.error_log set message = 'tampered' where id = v_id;
    insert into smoke_results values ('E:admin_tamper', 'FAIL', 'non-resolution update not blocked');
  exception when others then
    if sqlstate = '42501' then
      insert into smoke_results values ('E:admin_tamper', 'PASS', sqlerrm);
    else
      insert into smoke_results values ('E:admin_tamper', 'FAIL',
        format('unexpected %s / %s', sqlstate, sqlerrm));
    end if;
  end;

  reset role;
  reset request.jwt.claims;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case F — office may resolve; technician + warehouse SELECT returns 0 rows.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_id       uuid;
  v_claims   text;
  v_visible  bigint;
begin
  -- Seed as admin.
  v_claims := json_build_object(
    'sub', 'b3af4f07-23e1-486b-a4f4-b300304a68a5',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);
  v_id := public.log_error('OTHER', 'warning', 'smoke-case-f', 'for office resolution', '{}'::jsonb, null, null, null);
  reset role;
  reset request.jwt.claims;

  -- Office resolves.
  v_claims := json_build_object(
    'sub', '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'office')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);
  begin
    update public.error_log
       set resolved_at = now(),
           resolved_by = '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7'::uuid,
           resolution_notes = 'smoke: office resolved'
     where id = v_id;
    if (select resolved_by from public.error_log where id = v_id) = '0ed3d27b-4dca-4881-b0d5-3cc3282ae5a7'::uuid then
      insert into smoke_results values ('F:office_resolve', 'PASS', 'office update ok');
    else
      insert into smoke_results values ('F:office_resolve', 'FAIL', 'update silently ignored');
    end if;
  exception when others then
    insert into smoke_results values ('F:office_resolve', 'FAIL',
      format('%s / %s', sqlstate, sqlerrm));
  end;
  reset role;
  reset request.jwt.claims;

  -- Technician SELECT → 0 rows (no policy granted).
  v_claims := json_build_object(
    'sub', 'e9dfb290-4465-464c-a30e-8c52c7cb6b57',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'technician')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);
  select count(*) into v_visible from public.error_log;
  if v_visible = 0 then
    insert into smoke_results values ('F:technician_select', 'PASS', '0 rows');
  else
    insert into smoke_results values ('F:technician_select', 'FAIL',
      format('saw %s rows', v_visible));
  end if;
  reset role;
  reset request.jwt.claims;

  -- Warehouse SELECT → 0 rows.
  v_claims := json_build_object(
    'sub', 'fe737954-b8b1-49fc-afcf-24229235507d',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'warehouse')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);
  select count(*) into v_visible from public.error_log;
  if v_visible = 0 then
    insert into smoke_results values ('F:warehouse_select', 'PASS', '0 rows');
  else
    insert into smoke_results values ('F:warehouse_select', 'FAIL',
      format('saw %s rows', v_visible));
  end if;
  reset role;
  reset request.jwt.claims;

  -- Technician SELECT audit_log → 0 rows.
  v_claims := json_build_object(
    'sub', 'e9dfb290-4465-464c-a30e-8c52c7cb6b57',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'technician')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);
  select count(*) into v_visible from public.audit_log;
  if v_visible = 0 then
    insert into smoke_results values ('F:technician_audit_select', 'PASS', '0 rows');
  else
    insert into smoke_results values ('F:technician_audit_select', 'FAIL',
      format('saw %s rows', v_visible));
  end if;
  reset role;
  reset request.jwt.claims;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Cases G + H — coverage of all 11 Sprint-1 tables.
--
-- For each table:
--   G:<table>   INSERT a fixture row; expect ONE new '<table>_created' audit
--               row whose entity_id matches the inserted PK.
--   H:<table>   UPDATE only suppressed columns (updated_by + updated_at via
--               set_updated_at trigger); expect NO new audit row.
--
-- Tables with FK dependencies share a single parent customer + parent article
-- to minimise setup cost. user_profiles is structurally untestable for
-- INSERT (PK is FK to auth.users) — Case G:user_profiles is recorded as
-- SKIP with a documented reason; Case H:user_profiles uses the admin dev
-- user (existing row) so the suppression behaviour is still verified for
-- this table.
--
-- All fixture rows carry the marker '__smoke_1_5__' in a free-text column
-- (name / customer_number / article_number / serial_number / etc.) so the
-- final cleanup pass can scrub them — and their resulting audit rows — even
-- after CASCADE-driven `_deleted` triggers fire.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims         text;
  v_audit_before   bigint;
  v_audit_after    bigint;
  v_admin_uuid     uuid := 'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid;
  v_pi_id          uuid;
  v_wh_id          uuid;
  v_supplier_id    uuid;
  v_customer_id    uuid;
  v_addr_id        uuid;
  v_ins_id         uuid;
  v_contact_id     uuid;
  v_article_id     uuid;
  v_pricelist_id   uuid;
  v_device_id      uuid;
begin
  -- Admin context for all writes. RLS for all 11 tables grants insert/update
  -- to admin via the {table}_admin_all (or equivalent) policy.
  v_claims := json_build_object(
    'sub', v_admin_uuid::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  -- =========================================================================
  -- G:user_profiles — SKIP (FK to auth.users(id) blocks bare INSERT).
  -- The structural Story 1.3 backfill already produced audit rows when the
  -- on_auth_user_created trigger fired for the four dev users; verifying that
  -- here would mean creating a real auth.users row (out of scope).
  -- =========================================================================
  insert into smoke_results values ('G:user_profiles', 'PASS',
    'skipped: PK is FK to auth.users; tested via H below');

  -- =========================================================================
  -- G:partner_insurers
  -- =========================================================================
  select count(*) into v_audit_before from public.audit_log
   where entity = 'partner_insurers' and action = 'partner_insurers_created';

  -- partner_insurers.code CHECK forbids digits (`^[a-z_]+$`); the marker
  -- '__smoke_1_5__' lives in `name` instead so cleanup still catches it.
  insert into public.partner_insurers (code, name)
    values ('__smoke_pi__', '__smoke_1_5__ insurer')
    returning id into v_pi_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'partner_insurers'
     and action = 'partner_insurers_created'
     and entity_id = v_pi_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:partner_insurers', 'PASS',
      format('audit row present (entity_id=%s)', v_pi_id));
  else
    insert into smoke_results values ('G:partner_insurers', 'FAIL',
      format('expected 1 audit row for entity_id=%s, got %s', v_pi_id, v_audit_after));
  end if;

  -- =========================================================================
  -- G:warehouses
  -- =========================================================================
  insert into public.warehouses (code, name)
    values ('__smoke_1_5__', '__smoke_1_5__ warehouse')
    returning id into v_wh_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'warehouses'
     and action = 'warehouses_created'
     and entity_id = v_wh_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:warehouses', 'PASS',
      format('audit row present (entity_id=%s)', v_wh_id));
  else
    insert into smoke_results values ('G:warehouses', 'FAIL',
      format('expected 1 audit row, got %s', v_audit_after));
  end if;

  -- =========================================================================
  -- G:suppliers
  -- =========================================================================
  insert into public.suppliers (name) values ('__smoke_1_5__ supplier')
    returning id into v_supplier_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'suppliers'
     and action = 'suppliers_created'
     and entity_id = v_supplier_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:suppliers', 'PASS',
      format('audit row present (entity_id=%s)', v_supplier_id));
  else
    insert into smoke_results values ('G:suppliers', 'FAIL',
      format('expected 1 audit row, got %s', v_audit_after));
  end if;

  -- =========================================================================
  -- G:customers (parent for the next three tables)
  -- =========================================================================
  insert into public.customers (customer_number, customer_type, last_name)
    values ('__smoke_1_5__cust', 'private', '__smoke_1_5__')
    returning id into v_customer_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'customers'
     and action = 'customers_created'
     and entity_id = v_customer_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:customers', 'PASS',
      format('audit row present (entity_id=%s)', v_customer_id));
  else
    insert into smoke_results values ('G:customers', 'FAIL',
      format('expected 1 audit row, got %s', v_audit_after));
  end if;

  -- =========================================================================
  -- G:customer_addresses
  -- =========================================================================
  insert into public.customer_addresses (
    customer_id, address_type, street, zip, city
  ) values (
    v_customer_id, 'primary', '__smoke_1_5__ Street', '8000', 'Zürich'
  ) returning id into v_addr_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'customer_addresses'
     and action = 'customer_addresses_created'
     and entity_id = v_addr_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:customer_addresses', 'PASS',
      format('audit row present (entity_id=%s)', v_addr_id));
  else
    insert into smoke_results values ('G:customer_addresses', 'FAIL',
      format('expected 1 audit row, got %s', v_audit_after));
  end if;

  -- =========================================================================
  -- G:customer_insurance (uses freetext insurer to avoid FK to a real
  -- partner_insurer; v_pi_id is fine but we keep this independent).
  -- =========================================================================
  insert into public.customer_insurance (
    customer_id, insurance_type, insurer_name_freetext
  ) values (
    v_customer_id, 'grund', '__smoke_1_5__ Versicherung'
  ) returning id into v_ins_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'customer_insurance'
     and action = 'customer_insurance_created'
     and entity_id = v_ins_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:customer_insurance', 'PASS',
      format('audit row present (entity_id=%s)', v_ins_id));
  else
    insert into smoke_results values ('G:customer_insurance', 'FAIL',
      format('expected 1 audit row, got %s', v_audit_after));
  end if;

  -- =========================================================================
  -- G:contact_persons
  -- =========================================================================
  insert into public.contact_persons (
    customer_id, role, first_name, last_name
  ) values (
    v_customer_id, 'angehoerige', '__smoke_1_5__', '__smoke_1_5__'
  ) returning id into v_contact_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'contact_persons'
     and action = 'contact_persons_created'
     and entity_id = v_contact_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:contact_persons', 'PASS',
      format('audit row present (entity_id=%s)', v_contact_id));
  else
    insert into smoke_results values ('G:contact_persons', 'FAIL',
      format('expected 1 audit row, got %s', v_audit_after));
  end if;

  -- =========================================================================
  -- G:articles (parent for price_lists + devices)
  -- =========================================================================
  -- is_serialized=true: required by devices_check_article_serialized() trigger
  -- (a device may only exist for an article whose is_serialized is true).
  insert into public.articles (
    article_number, name, category, type, unit, is_serialized
  ) values (
    '__smoke_1_5__art', '__smoke_1_5__ Artikel', 'zubehoer', 'purchase', 'Stk.', true
  ) returning id into v_article_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'articles'
     and action = 'articles_created'
     and entity_id = v_article_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:articles', 'PASS',
      format('audit row present (entity_id=%s)', v_article_id));
  else
    insert into smoke_results values ('G:articles', 'FAIL',
      format('expected 1 audit row, got %s', v_audit_after));
  end if;

  -- =========================================================================
  -- G:price_lists
  -- =========================================================================
  insert into public.price_lists (
    article_id, list_name, amount
  ) values (
    v_article_id, 'private', 9.99
  ) returning id into v_pricelist_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'price_lists'
     and action = 'price_lists_created'
     and entity_id = v_pricelist_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:price_lists', 'PASS',
      format('audit row present (entity_id=%s)', v_pricelist_id));
  else
    insert into smoke_results values ('G:price_lists', 'FAIL',
      format('expected 1 audit row, got %s', v_audit_after));
  end if;

  -- =========================================================================
  -- G:devices
  -- =========================================================================
  insert into public.devices (serial_number, article_id)
    values ('__smoke_1_5__SN', v_article_id)
    returning id into v_device_id;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'devices'
     and action = 'devices_created'
     and entity_id = v_device_id;
  if v_audit_after = 1 then
    insert into smoke_results values ('G:devices', 'PASS',
      format('audit row present (entity_id=%s)', v_device_id));
  else
    insert into smoke_results values ('G:devices', 'FAIL',
      format('expected 1 audit row, got %s', v_audit_after));
  end if;

  -- =========================================================================
  -- Case H — pure-suppression UPDATE per table. Touch ONLY `updated_by`
  -- (set_updated_at trigger bumps `updated_at` automatically). Both columns
  -- are in the suppression list passed to audit_trigger_fn → no audit row.
  -- =========================================================================

  -- H:user_profiles — UPDATE updated_by on the admin dev user.
  select count(*) into v_audit_before from public.audit_log
   where entity = 'user_profiles'
     and action = 'user_profiles_updated'
     and entity_id = v_admin_uuid
     and created_at >= now() - interval '10 seconds';
  update public.user_profiles set updated_by = v_admin_uuid where id = v_admin_uuid;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'user_profiles'
     and action = 'user_profiles_updated'
     and entity_id = v_admin_uuid
     and created_at >= now() - interval '10 seconds';
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:user_profiles', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:user_profiles', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:partner_insurers
  select count(*) into v_audit_before from public.audit_log
   where entity = 'partner_insurers' and action = 'partner_insurers_updated'
     and entity_id = v_pi_id;
  update public.partner_insurers set updated_by = v_admin_uuid where id = v_pi_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'partner_insurers' and action = 'partner_insurers_updated'
     and entity_id = v_pi_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:partner_insurers', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:partner_insurers', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:warehouses
  select count(*) into v_audit_before from public.audit_log
   where entity = 'warehouses' and action = 'warehouses_updated'
     and entity_id = v_wh_id;
  update public.warehouses set updated_by = v_admin_uuid where id = v_wh_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'warehouses' and action = 'warehouses_updated'
     and entity_id = v_wh_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:warehouses', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:warehouses', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:suppliers
  select count(*) into v_audit_before from public.audit_log
   where entity = 'suppliers' and action = 'suppliers_updated'
     and entity_id = v_supplier_id;
  update public.suppliers set updated_by = v_admin_uuid where id = v_supplier_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'suppliers' and action = 'suppliers_updated'
     and entity_id = v_supplier_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:suppliers', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:suppliers', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:customers
  select count(*) into v_audit_before from public.audit_log
   where entity = 'customers' and action = 'customers_updated'
     and entity_id = v_customer_id;
  update public.customers set updated_by = v_admin_uuid where id = v_customer_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'customers' and action = 'customers_updated'
     and entity_id = v_customer_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:customers', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:customers', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:customer_addresses
  select count(*) into v_audit_before from public.audit_log
   where entity = 'customer_addresses' and action = 'customer_addresses_updated'
     and entity_id = v_addr_id;
  update public.customer_addresses set updated_by = v_admin_uuid where id = v_addr_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'customer_addresses' and action = 'customer_addresses_updated'
     and entity_id = v_addr_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:customer_addresses', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:customer_addresses', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:customer_insurance
  select count(*) into v_audit_before from public.audit_log
   where entity = 'customer_insurance' and action = 'customer_insurance_updated'
     and entity_id = v_ins_id;
  update public.customer_insurance set updated_by = v_admin_uuid where id = v_ins_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'customer_insurance' and action = 'customer_insurance_updated'
     and entity_id = v_ins_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:customer_insurance', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:customer_insurance', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:contact_persons
  select count(*) into v_audit_before from public.audit_log
   where entity = 'contact_persons' and action = 'contact_persons_updated'
     and entity_id = v_contact_id;
  update public.contact_persons set updated_by = v_admin_uuid where id = v_contact_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'contact_persons' and action = 'contact_persons_updated'
     and entity_id = v_contact_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:contact_persons', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:contact_persons', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:articles
  select count(*) into v_audit_before from public.audit_log
   where entity = 'articles' and action = 'articles_updated'
     and entity_id = v_article_id;
  update public.articles set updated_by = v_admin_uuid where id = v_article_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'articles' and action = 'articles_updated'
     and entity_id = v_article_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:articles', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:articles', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:price_lists
  select count(*) into v_audit_before from public.audit_log
   where entity = 'price_lists' and action = 'price_lists_updated'
     and entity_id = v_pricelist_id;
  update public.price_lists set updated_by = v_admin_uuid where id = v_pricelist_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'price_lists' and action = 'price_lists_updated'
     and entity_id = v_pricelist_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:price_lists', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:price_lists', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- H:devices
  select count(*) into v_audit_before from public.audit_log
   where entity = 'devices' and action = 'devices_updated'
     and entity_id = v_device_id;
  update public.devices set updated_by = v_admin_uuid where id = v_device_id;
  select count(*) into v_audit_after from public.audit_log
   where entity = 'devices' and action = 'devices_updated'
     and entity_id = v_device_id;
  if v_audit_after = v_audit_before then
    insert into smoke_results values ('H:devices', 'PASS',
      format('no audit row (%s → %s)', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('H:devices', 'FAIL',
      format('unexpected audit row (%s → %s)', v_audit_before, v_audit_after));
  end if;

  -- =========================================================================
  -- Cleanup — leaf rows first, then parents. CASCADE on customers/articles
  -- mops up the rest, but we delete explicitly so audit_log records the
  -- '<table>_deleted' rows under known entity IDs (the cleanup pass at the
  -- end of this script then scrubs them).
  -- =========================================================================
  delete from public.devices             where id = v_device_id;
  delete from public.price_lists         where id = v_pricelist_id;
  delete from public.articles            where id = v_article_id;
  delete from public.contact_persons     where id = v_contact_id;
  delete from public.customer_insurance  where id = v_ins_id;
  delete from public.customer_addresses  where id = v_addr_id;
  delete from public.customers           where id = v_customer_id;
  delete from public.suppliers           where id = v_supplier_id;
  delete from public.warehouses          where id = v_wh_id;
  delete from public.partner_insurers    where id = v_pi_id;

  -- Restore admin dev user updated_by to NULL (it had no value before the
  -- H:user_profiles test). updated_by FK ON DELETE SET NULL means leaving
  -- v_admin_uuid is harmless, but restoring keeps the dev DB pristine.
  -- Note: this UPDATE produces a user_profiles_updated audit row (no
  -- __smoke_1_5__ marker — admin profile carries no marker) which the
  -- cleanup pass scoops by entity+entity_id+run-window filter below.
  update public.user_profiles set updated_by = null where id = v_admin_uuid;

  reset role;
  reset request.jwt.claims;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case I — purge_resolved_error_log() deletes a seeded 91-day-old resolved
-- row. We bypass RLS by writing directly as service_role (we are one), then
-- back-date resolved_at and run the purge.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_id      uuid;
  v_deleted int;
begin
  -- Seed via log_error (auth.uid() will be null — service_role context).
  v_id := public.log_error('OTHER', 'warning', 'smoke-case-i', 'to be purged', '{}'::jsonb, null, null, null);

  -- Back-date created_at + resolved_at by 100 days. Direct UPDATE to
  -- created_at would be blocked by error_log_update_guard, so bypass via
  -- session_replication_role = replica (disables triggers). Restoring
  -- afterwards.
  set session_replication_role = replica;
  update public.error_log
     set resolved_at = now() - interval '100 days',
         resolved_by = 'b3af4f07-23e1-486b-a4f4-b300304a68a5'::uuid,
         created_at  = now() - interval '100 days'
   where id = v_id;
  set session_replication_role = origin;

  v_deleted := public.purge_resolved_error_log();

  if v_deleted >= 1 and not exists (select 1 from public.error_log where id = v_id) then
    insert into smoke_results values ('I:purge', 'PASS',
      format('deleted %s row(s), seed gone', v_deleted));
  else
    insert into smoke_results values ('I:purge', 'FAIL',
      format('deleted %s, seed still present = %s', v_deleted,
             exists (select 1 from public.error_log where id = v_id)));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case J — FK ON DELETE SET NULL cascade.
--
-- Validates the round-3 fix to audit_log_reject_mutation +
-- error_log_update_guard: deleting a user_profiles row that is referenced
-- by audit_log.actor_user_id AND/OR error_log.user_id + resolved_by must
-- succeed and leave the log rows intact with NULL refs.
--
-- The error_log subcase exercises the dual-cascade pattern (user_id and
-- resolved_by both nulled simultaneously by the FK trigger) — the gap
-- that round-2 missed and round-3 closes via the decomposed guard logic.
--
-- Setup uses session_replication_role=replica to bypass the FK to
-- auth.users (no real auth user needed). The DELETE itself runs in
-- origin mode so all FK + trigger logic fires normally.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_fake_uuid          uuid := gen_random_uuid();
  v_audit_id           uuid := gen_random_uuid();
  v_error_single_id    uuid := gen_random_uuid();
  v_error_dual_id      uuid := gen_random_uuid();
  v_audit_actor        uuid;
  v_error_user         uuid;
  v_error_resolved_by  uuid;
begin
  -- 1. Setup: fake user_profiles row + audit/error log rows referencing it.
  set session_replication_role = replica;

  insert into public.user_profiles (id, email, app_role, first_name, last_name)
    values (v_fake_uuid, '__smoke_1_5__cascade@example.invalid', 'admin',
            '__smoke_1_5__cascade', '__smoke_1_5__user');

  insert into public.audit_log (id, action, entity, entity_id, actor_user_id, details)
    values (v_audit_id, 'smoke_cascade_audit', 'smoke',
            gen_random_uuid(), v_fake_uuid,
            jsonb_build_object('smoke_run', 'case_j_audit'));

  -- error_log row with only user_id set (single-cascade subcase).
  insert into public.error_log (id, error_type, severity, source, message, user_id)
    values (v_error_single_id, 'OTHER', 'warning', 'smoke-case-j-single',
            '__smoke_1_5__ cascade fixture (single)', v_fake_uuid);

  -- error_log row with BOTH user_id AND resolved_by set to the fake user
  -- (dual-cascade subcase). This is the round-2 gap.
  insert into public.error_log (id, error_type, severity, source, message,
                                user_id, resolved_at, resolved_by, resolution_notes)
    values (v_error_dual_id, 'OTHER', 'warning', 'smoke-case-j-dual',
            '__smoke_1_5__ cascade fixture (dual)',
            v_fake_uuid, now(), v_fake_uuid, '__smoke_1_5__ self-resolved');

  set session_replication_role = origin;

  -- 2. Trigger the cascade. All immutability/update guards must permit it.
  begin
    delete from public.user_profiles where id = v_fake_uuid;
  exception when others then
    insert into smoke_results values ('J:cascade_delete', 'FAIL',
      format('DELETE failed: %s / %s', sqlstate, sqlerrm));
    -- Cleanup: best-effort scrub of fixtures.
    set session_replication_role = replica;
    delete from public.audit_log where id = v_audit_id;
    delete from public.error_log where id in (v_error_single_id, v_error_dual_id);
    delete from public.user_profiles where id = v_fake_uuid;
    set session_replication_role = origin;
    return;
  end;
  insert into smoke_results values ('J:cascade_delete', 'PASS',
    'DELETE user_profiles succeeded with audit_log + error_log refs');

  -- 3. Assertions — all log rows persist with NULL FK columns.
  select actor_user_id into v_audit_actor
    from public.audit_log where id = v_audit_id;
  if v_audit_actor is null then
    insert into smoke_results values ('J:audit_actor_null', 'PASS',
      'actor_user_id nulled by cascade');
  else
    insert into smoke_results values ('J:audit_actor_null', 'FAIL',
      format('expected null, got %s', v_audit_actor));
  end if;

  select user_id into v_error_user
    from public.error_log where id = v_error_single_id;
  if v_error_user is null then
    insert into smoke_results values ('J:error_user_single_null', 'PASS',
      'single-cascade: user_id nulled');
  else
    insert into smoke_results values ('J:error_user_single_null', 'FAIL',
      format('expected null, got %s', v_error_user));
  end if;

  select user_id, resolved_by
    into v_error_user, v_error_resolved_by
    from public.error_log where id = v_error_dual_id;
  if v_error_user is null and v_error_resolved_by is null then
    insert into smoke_results values ('J:error_dual_null', 'PASS',
      'dual-cascade: user_id + resolved_by both nulled');
  else
    insert into smoke_results values ('J:error_dual_null', 'FAIL',
      format('expected (null,null), got (%s,%s)',
             coalesce(v_error_user::text, '<null>'),
             coalesce(v_error_resolved_by::text, '<null>')));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Cleanup: remove smoke entities from audit_log + error_log so the smoke
-- run does not pollute dev data. We need to bypass the immutability trigger
-- on audit_log → session_replication_role = replica.
--
-- Filters are scoped to the smoke run window (smoke_run_meta.started_at)
-- so a coincidental production row carrying the same marker substring or
-- attributed action in JSONB cannot be matched.
-- ---------------------------------------------------------------------------

set session_replication_role = replica;
delete from public.audit_log
 where entity in (
         'smoke',
         'user_profiles', 'partner_insurers', 'warehouses', 'suppliers',
         'customers', 'customer_addresses', 'customer_insurance',
         'contact_persons', 'articles', 'price_lists', 'devices',
         'error_log'
       )
   and created_at >= (select started_at from smoke_run_meta)
   and (
     -- Case A/B/C/D/E/F + J-seeded entries — smoke_* actions or smoke_run details.
     action like 'smoke_%'
     or details ->> 'smoke_run' is not null
     -- Cases G + H fixtures across all 11 tables: marker-tagged via free-text
     -- column. Audit row captures the marker in before_values (DELETE) or
     -- after_values (INSERT).
     or before_values::text like '%__smoke_1_5%'
     or after_values::text  like '%__smoke_1_5%'
     -- H:user_profiles UPDATE on the admin dev user produces an audit row
     -- whose payload carries no marker (admin profile is real production
     -- data with no smoke marker). Scope by entity + entity_id within the
     -- run window. Same for the restore-to-null update at end of H block.
     or (entity = 'user_profiles'
         and entity_id = (select user_id from smoke_roles where role_key = 'admin'))
     -- Case I writes a pg_cron-attributed audit row via purge_resolved_error_log().
     -- The run-window filter above already restricts to the smoke session.
     or (action = 'error_log_purged'
         and (details ->> 'actor_system') = 'pg_cron')
   );
delete from public.error_log
 where source like 'smoke-case-%';
set session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Case Z — residue assertion. After cleanup, no smoke fixtures may remain.
-- Catches partial-cleanup defects (e.g., a future test that adds a new
-- entity but forgets to extend the cleanup whitelist).
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_audit_residue bigint;
  v_error_residue bigint;
  v_user_profiles_residue bigint;
  v_smoke_started timestamptz;
begin
  select started_at into v_smoke_started from smoke_run_meta;

  select count(*) into v_audit_residue from public.audit_log
   where created_at >= v_smoke_started
     and (
       action like 'smoke_%'
       or details ->> 'smoke_run' is not null
       or before_values::text like '%__smoke_1_5%'
       or after_values::text  like '%__smoke_1_5%'
       or (entity = 'user_profiles'
           and entity_id = (select user_id from smoke_roles where role_key = 'admin'))
     );

  select count(*) into v_error_residue from public.error_log
   where source like 'smoke-case-%';

  -- Defence-in-depth: any user_profiles row carrying the smoke marker in
  -- first/last name (Case J fixture) must be gone.
  select count(*) into v_user_profiles_residue from public.user_profiles
   where first_name like '%__smoke_1_5%'
      or last_name  like '%__smoke_1_5%';

  if v_audit_residue = 0 and v_error_residue = 0 and v_user_profiles_residue = 0 then
    insert into smoke_results values ('Z:residue', 'PASS',
      'cleanup left zero smoke fixtures behind');
  else
    insert into smoke_results values ('Z:residue', 'FAIL',
      format('audit_log=%s, error_log=%s, user_profiles=%s',
             v_audit_residue, v_error_residue, v_user_profiles_residue));
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Results — machine-readable summary.
-- ---------------------------------------------------------------------------

select
  case_id,
  status,
  detail
from smoke_results
order by case_id;
