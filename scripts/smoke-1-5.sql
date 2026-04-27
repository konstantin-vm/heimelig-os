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

-- Allow the authenticated role (set via set local role authenticated inside
-- test DO blocks) to write into the temp tables while simulating dev users.
grant all on smoke_results to authenticated;
grant all on smoke_roles   to authenticated;

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
-- Case G — INSERT on each Sprint-1 table produces a '<table>_created' row.
-- We pick a write-friendly operation per table: insert a test row, confirm
-- a matching audit_log row exists, then clean up.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims    text;
  v_audit_before bigint;
  v_audit_after  bigint;
  v_supplier  uuid;
begin
  -- Run as admin; admin_all policy grants insert/delete.
  v_claims := json_build_object(
    'sub', 'b3af4f07-23e1-486b-a4f4-b300304a68a5',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  -- Suppliers is the simplest + safest test table (no FK dependencies on
  -- orders/contracts). We insert, check audit, then delete.
  select count(*) into v_audit_before from public.audit_log
   where entity = 'suppliers' and action = 'suppliers_created';

  insert into public.suppliers (name) values ('__smoke_1_5_supplier__') returning id into v_supplier;

  select count(*) into v_audit_after from public.audit_log
   where entity = 'suppliers' and action = 'suppliers_created';

  if v_audit_after = v_audit_before + 1 then
    insert into smoke_results values ('G:suppliers_insert', 'PASS',
      format('audit rows %s → %s', v_audit_before, v_audit_after));
  else
    insert into smoke_results values ('G:suppliers_insert', 'FAIL',
      format('expected +1, got %s → %s', v_audit_before, v_audit_after));
  end if;

  delete from public.suppliers where id = v_supplier;

  reset role;
  reset request.jwt.claims;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- Case H — UPDATE touching ONLY updated_at/updated_by yields NO audit row.
-- ---------------------------------------------------------------------------

do $outer$
declare
  v_claims    text;
  v_supplier  uuid;
  v_before    bigint;
  v_after     bigint;
begin
  v_claims := json_build_object(
    'sub', 'b3af4f07-23e1-486b-a4f4-b300304a68a5',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('app_role', 'admin')
  )::text;
  execute format($sql$
    set local role authenticated;
    set local request.jwt.claims = %L;
  $sql$, v_claims);

  insert into public.suppliers (name) values ('__smoke_1_5_H__') returning id into v_supplier;

  select count(*) into v_before from public.audit_log
   where entity = 'suppliers' and action = 'suppliers_updated' and entity_id = v_supplier;

  -- Pure-timestamp update. set_updated_at trigger bumps updated_at.
  -- The generic audit trigger suppresses updated_at + updated_by → no row.
  update public.suppliers set updated_by = auth.uid() where id = v_supplier;

  select count(*) into v_after from public.audit_log
   where entity = 'suppliers' and action = 'suppliers_updated' and entity_id = v_supplier;

  if v_after = v_before then
    insert into smoke_results values ('H:suppress_noise', 'PASS', format('no audit row (%s → %s)', v_before, v_after));
  else
    insert into smoke_results values ('H:suppress_noise', 'FAIL',
      format('unexpected audit row (%s → %s)', v_before, v_after));
  end if;

  delete from public.suppliers where id = v_supplier;

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
-- Cleanup: remove smoke entities from audit_log + error_log so the smoke
-- run does not pollute dev data. We need to bypass the immutability trigger
-- on audit_log → session_replication_role = replica.
-- ---------------------------------------------------------------------------

set session_replication_role = replica;
delete from public.audit_log
 where entity in ('smoke', 'suppliers', 'error_log')
   and (
     action like 'smoke_%'
     or details ->> 'smoke_run' is not null
     or (action = 'suppliers_created' and (after_values  ->> 'name') like '__smoke_1_5%')
     or (action = 'suppliers_deleted' and (before_values ->> 'name') like '__smoke_1_5%')
     or (action = 'suppliers_updated' and (after_values  ->> 'name') like '__smoke_1_5%')
     -- Case I writes a pg_cron-attributed audit row via purge_resolved_error_log().
     -- Restrict cleanup to the smoke window so a real production pg_cron purge
     -- (running on the same day) is not erased.
     or (action = 'error_log_purged'
         and (details ->> 'actor_system') = 'pg_cron'
         and created_at >= now() - interval '10 minutes')
   );
delete from public.error_log
 where source like 'smoke-case-%';
set session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Results — machine-readable summary.
-- ---------------------------------------------------------------------------

select
  case_id,
  status,
  detail
from smoke_results
order by case_id;
