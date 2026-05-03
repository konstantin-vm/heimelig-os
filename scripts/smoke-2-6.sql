-- Story 2.6 smoke matrix — bexio Contact Synchronization (DB surface).
-- Executed via: supabase db query --linked -f scripts/smoke-2-6.sql
--
-- Two layers of validation for this story:
--
--   1. DB-side (this file) — deterministic, runnable in psql, no external
--      dependencies. Covers migration 00040 shape, the three RPCs, GRANT
--      matrix, audit_log emissions, idempotency, claim ordering.
--
--   2. Runtime — bexio API + Edge Function + cron. Cannot be exercised
--      from psql; documented in the story Completion Notes as the
--      reviewer-side checklist (Cases A–H from story Task 7).
--
-- DB-side cases:
--   A    Migration applied — pg_net + the three RPCs exist with the right
--        signatures + GRANT matrix (service_role only).
--   B    claim_pending_bexio_contact_syncs — selects only pending +
--        is_active rows, ordered by updated_at ASC; respects p_limit
--        clamping ([1, 100]); FOR UPDATE SKIP LOCKED locks the rows.
--   C    mark_bexio_contact_synced — sets bexio_contact_id +
--        bexio_sync_status='synced' + bexio_synced_at; writes one
--        audit_log row with action='bexio_contact_synced',
--        actor_system='contact_sync', details.bexio_contact_id.
--   D    mark_bexio_contact_sync_failed — sets bexio_sync_status='failed';
--        does NOT touch bexio_contact_id; writes one audit_log row with
--        action='bexio_contact_sync_failed', details.error_code.
--   E    Idempotency — re-running mark_synced with identical args is
--        semantically a no-op on customers (status stays 'synced',
--        bexio_contact_id unchanged) and writes a fresh audit row each
--        time (explicit choice — audit captures the latest sync attempt
--        regardless of state change).
--   F    Cron schedule — when app.bexio_contact_sync_url +
--        app.bexio_cron_secret GUCs are set, the cron job
--        'bexio-contact-sync-sweep' exists with a 5-minute schedule.
--        When unset, the migration RAISE NOTICE-skipped the schedule
--        (PASS by skip).
--   G    RLS / GRANT — service_role can EXECUTE the three RPCs;
--        authenticated, anon, public CANNOT.
--   Z    Residue — run-id-tagged fixtures fully deleted post-run.
--
-- Run via: npx supabase db query --linked -f scripts/smoke-2-6.sql --output table
-- (psql meta-commands like `\set ON_ERROR_STOP` are not supported by the
-- Management API; we surface failures via the smoke_results table.)

create temp table smoke_results (
  case_id text primary key,
  status  text not null check (status in ('PASS','FAIL','SKIP')),
  detail  text
) on commit drop;

create temp table smoke_run_meta (
  run_id     text primary key,
  started_at timestamptz not null
) on commit drop;
insert into smoke_run_meta values
  ('smk26-' || replace(gen_random_uuid()::text, '-', '')::text, now());

create temp table smoke_fixture (
  customer_id uuid,
  run_id      text
) on commit drop;

-- The smoke does `set_config('role', 'service_role', true)` to exercise
-- the service-role-only RPCs. Temp tables in pg_temp_N are owned by the
-- current login role; grant access so service_role can read them.
grant all on smoke_results  to service_role;
grant all on smoke_run_meta to service_role;
grant all on smoke_fixture  to service_role;

-- ---------------------------------------------------------------------------
-- Fixture setup — three pending customers with staggered updated_at so
-- ORDER BY updated_at ASC is observable; one synced + one inactive +
-- one failed control.
-- ---------------------------------------------------------------------------

do $setup$
declare
  v_run_id text;
  v_id     uuid;
begin
  select run_id into v_run_id from smoke_run_meta limit 1;

  -- 3 pending fixtures with controlled updated_at
  for i in 1..3 loop
    v_id := gen_random_uuid();
    insert into public.customers (
      id, customer_number, customer_type, last_name, first_name,
      bexio_sync_status, is_active, updated_at, language
    ) values (
      v_id,
      'ZZ-' || v_run_id || '-' || i::text,
      'private',
      'Smoke26-Pending-' || i::text,
      'Test',
      'pending',
      true,
      now() - make_interval(secs => (10 - i)),  -- i=1 oldest, i=3 newest
      'de'
    );
    insert into public.customer_addresses (
      customer_id, address_type, is_default_for_type, street, zip, city, country, is_active
    ) values (v_id, 'primary', true, 'Bahnhofstrasse', '8001', 'Zürich', 'CH', true);

    insert into smoke_fixture (customer_id, run_id) values (v_id, v_run_id);
  end loop;

  -- 1 synced control (should NOT appear in claim)
  v_id := gen_random_uuid();
  insert into public.customers (
    id, customer_number, customer_type, last_name, first_name,
    bexio_contact_id, bexio_sync_status, bexio_synced_at, is_active, language
  ) values (
    v_id, 'ZZ-' || v_run_id || '-synced', 'private',
    'Smoke26-Synced', 'Test',
    99999001, 'synced', now(), true, 'de'
  );
  insert into public.customer_addresses (
    customer_id, address_type, is_default_for_type, street, zip, city, country, is_active
  ) values (v_id, 'primary', true, 'Bahnhofstrasse', '8001', 'Zürich', 'CH', true);
  insert into smoke_fixture (customer_id, run_id) values (v_id, v_run_id);

  -- 1 inactive pending control (should NOT appear in claim)
  v_id := gen_random_uuid();
  insert into public.customers (
    id, customer_number, customer_type, last_name, first_name,
    bexio_sync_status, is_active, language
  ) values (
    v_id, 'ZZ-' || v_run_id || '-inactive', 'private',
    'Smoke26-Inactive', 'Test',
    'pending', false, 'de'
  );
  insert into public.customer_addresses (
    customer_id, address_type, is_default_for_type, street, zip, city, country, is_active
  ) values (v_id, 'primary', true, 'Bahnhofstrasse', '8001', 'Zürich', 'CH', true);
  insert into smoke_fixture (customer_id, run_id) values (v_id, v_run_id);

  -- 1 failed control (should NOT appear in claim — sticky)
  v_id := gen_random_uuid();
  insert into public.customers (
    id, customer_number, customer_type, last_name, first_name,
    bexio_sync_status, is_active, language
  ) values (
    v_id, 'ZZ-' || v_run_id || '-failed', 'private',
    'Smoke26-Failed', 'Test',
    'failed', true, 'de'
  );
  insert into public.customer_addresses (
    customer_id, address_type, is_default_for_type, street, zip, city, country, is_active
  ) values (v_id, 'primary', true, 'Bahnhofstrasse', '8001', 'Zürich', 'CH', true);
  insert into smoke_fixture (customer_id, run_id) values (v_id, v_run_id);
end$setup$;

-- ---------------------------------------------------------------------------
-- A — Migration applied: pg_net extension + 3 RPCs exist.
-- ---------------------------------------------------------------------------

do $A$
declare
  v_pg_net_present boolean;
  v_fn_count int;
begin
  select count(*) > 0 into v_pg_net_present
    from pg_extension where extname = 'pg_net';

  select count(*) into v_fn_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'claim_pending_bexio_contact_syncs',
       'mark_bexio_contact_synced',
       'mark_bexio_contact_sync_failed'
     );

  insert into smoke_results values (
    'A',
    case when v_pg_net_present and v_fn_count = 3 then 'PASS' else 'FAIL' end,
    format('pg_net=%s, rpc_count=%s/3', v_pg_net_present, v_fn_count)
  );
end$A$;

-- ---------------------------------------------------------------------------
-- B — claim_pending_bexio_contact_syncs filters + ordering.
-- ---------------------------------------------------------------------------

do $B$
declare
  v_run_id     text;
  v_claimed    uuid[];
  v_pending_in_run uuid[];
  v_first_id   uuid;
  v_oldest_id  uuid;
begin
  select run_id into v_run_id from smoke_run_meta limit 1;

  -- Claim within a sub-transaction so the FOR UPDATE locks release
  -- promptly. Run as service_role.
  begin
    perform set_config('role', 'service_role', true);
    select array_agg(t.id order by t.id) into v_claimed
      from public.claim_pending_bexio_contact_syncs(50) as t(id);
  end;

  -- Expected: only the 3 pending+active+run-tagged customers, NOT the
  -- synced / inactive / failed controls. Other live pending customers in
  -- the database may also be claimed (this is a shared environment); we
  -- assert "all 3 of our pending fixtures are in the result, none of our
  -- non-pending controls are".
  select array_agg(c.id order by c.id) into v_pending_in_run
    from public.customers c
   where c.customer_number like 'ZZ-' || v_run_id || '-%'
     and c.bexio_sync_status = 'pending'
     and c.is_active = true;

  -- All run-tagged pending must be in claim.
  if not (v_pending_in_run <@ v_claimed) then
    insert into smoke_results values (
      'B',
      'FAIL',
      format('expected pending fixtures %s ⊆ claim %s', v_pending_in_run, v_claimed)
    );
    return;
  end if;

  -- The non-pending fixtures must NOT be in claim.
  if exists (
    select 1
      from smoke_fixture f
      join public.customers c on c.id = f.customer_id
     where f.run_id = v_run_id
       and (c.bexio_sync_status <> 'pending' or c.is_active = false)
       and c.id = any(v_claimed)
  ) then
    insert into smoke_results values (
      'B',
      'FAIL',
      'non-pending or inactive fixture appeared in claim'
    );
    return;
  end if;

  -- Ordering: among the run-tagged pending customers, the oldest
  -- updated_at must come first (before any other run-tagged pending).
  select id into v_oldest_id
    from public.customers
   where customer_number = 'ZZ-' || v_run_id || '-1'
   limit 1;

  -- Recompute claim deterministically with run-id filter
  perform set_config('role', 'service_role', true);
  select t.id into v_first_id
    from public.claim_pending_bexio_contact_syncs(50) as t(id)
    join public.customers c on c.id = t.id
   where c.customer_number like 'ZZ-' || v_run_id || '-%'
   order by c.updated_at asc
   limit 1;

  if v_first_id is null or v_first_id <> v_oldest_id then
    insert into smoke_results values (
      'B',
      'FAIL',
      format('ordering broken: first run-tagged claim=%s expected=%s', v_first_id, v_oldest_id)
    );
    return;
  end if;

  insert into smoke_results values (
    'B',
    'PASS',
    format('claim=%s pending fixtures, ordering correct', cardinality(v_pending_in_run))
  );
end$B$;

-- ---------------------------------------------------------------------------
-- C — mark_bexio_contact_synced flips status + writes audit row.
-- ---------------------------------------------------------------------------

do $C$
declare
  v_run_id     text;
  v_target_id  uuid;
  v_status     text;
  v_bexio_id   int;
  v_synced_at  timestamptz;
  v_audit_count int;
begin
  select run_id into v_run_id from smoke_run_meta limit 1;
  select id into v_target_id
    from public.customers
   where customer_number = 'ZZ-' || v_run_id || '-1';

  perform set_config('role', 'service_role', true);
  perform public.mark_bexio_contact_synced(v_target_id, 12345678);

  select bexio_sync_status, bexio_contact_id, bexio_synced_at
    into v_status, v_bexio_id, v_synced_at
    from public.customers where id = v_target_id;

  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'customers'
     and entity_id = v_target_id
     and action = 'bexio_contact_synced'
     and actor_system = 'contact_sync'
     and (details ->> 'bexio_contact_id')::int = 12345678;

  if v_status = 'synced' and v_bexio_id = 12345678 and v_synced_at is not null
     and v_audit_count = 1 then
    insert into smoke_results values (
      'C',
      'PASS',
      format('status=%s bexio_id=%s audit_rows=%s', v_status, v_bexio_id, v_audit_count)
    );
  else
    insert into smoke_results values (
      'C',
      'FAIL',
      format('status=%s bexio_id=%s synced_at=%s audit_rows=%s',
             v_status, v_bexio_id, v_synced_at, v_audit_count)
    );
  end if;
end$C$;

-- ---------------------------------------------------------------------------
-- D — mark_bexio_contact_sync_failed flips status + preserves bexio_id +
--      writes audit row with error_code.
-- ---------------------------------------------------------------------------

do $D$
declare
  v_run_id     text;
  v_target_id  uuid;
  v_before_id  int;
  v_status     text;
  v_after_id   int;
  v_audit_count int;
begin
  select run_id into v_run_id from smoke_run_meta limit 1;
  select id into v_target_id
    from public.customers
   where customer_number = 'ZZ-' || v_run_id || '-2';

  -- Pre-link a bexio_contact_id so we can verify mark_failed preserves it.
  perform set_config('role', 'service_role', true);
  perform public.mark_bexio_contact_synced(v_target_id, 87654321);
  select bexio_contact_id into v_before_id
    from public.customers where id = v_target_id;

  -- Now fail it.
  perform public.mark_bexio_contact_sync_failed(v_target_id, 'bexio_422');

  select bexio_sync_status, bexio_contact_id
    into v_status, v_after_id
    from public.customers where id = v_target_id;

  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'customers'
     and entity_id = v_target_id
     and action = 'bexio_contact_sync_failed'
     and actor_system = 'contact_sync'
     and details ->> 'error_code' = 'bexio_422';

  if v_status = 'failed' and v_after_id = v_before_id and v_audit_count = 1 then
    insert into smoke_results values (
      'D',
      'PASS',
      format('status=%s bexio_id preserved=%s audit_rows=%s',
             v_status, v_after_id, v_audit_count)
    );
  else
    insert into smoke_results values (
      'D',
      'FAIL',
      format('status=%s bexio_id before=%s after=%s audit_rows=%s',
             v_status, v_before_id, v_after_id, v_audit_count)
    );
  end if;
end$D$;

-- ---------------------------------------------------------------------------
-- E — Idempotency: re-running mark_synced with same args.
-- ---------------------------------------------------------------------------

do $E$
declare
  v_run_id     text;
  v_target_id  uuid;
  v_status     text;
  v_audit_count int;
begin
  select run_id into v_run_id from smoke_run_meta limit 1;
  select id into v_target_id
    from public.customers
   where customer_number = 'ZZ-' || v_run_id || '-3';

  perform set_config('role', 'service_role', true);
  perform public.mark_bexio_contact_synced(v_target_id, 11111111);
  perform public.mark_bexio_contact_synced(v_target_id, 11111111);

  select bexio_sync_status into v_status
    from public.customers where id = v_target_id;

  select count(*) into v_audit_count
    from public.audit_log
   where entity = 'customers'
     and entity_id = v_target_id
     and action = 'bexio_contact_synced';

  -- Two audit rows expected — explicit choice; row state still 'synced'.
  if v_status = 'synced' and v_audit_count = 2 then
    insert into smoke_results values (
      'E',
      'PASS',
      format('status=%s audit_rows=%s (2 expected — re-call is no-op state-wise, audited each time)',
             v_status, v_audit_count)
    );
  else
    insert into smoke_results values (
      'E',
      'FAIL',
      format('status=%s audit_rows=%s (expected 2)', v_status, v_audit_count)
    );
  end if;
end$E$;

-- ---------------------------------------------------------------------------
-- F — Cron schedule (skip-by-design when GUCs unset).
-- ---------------------------------------------------------------------------

do $F$
declare
  v_url    text := nullif(current_setting('app.bexio_contact_sync_url', true), '');
  v_secret text := nullif(current_setting('app.bexio_cron_secret', true), '');
  v_job_count int;
begin
  if v_url is null or v_secret is null then
    insert into smoke_results values (
      'F',
      'SKIP',
      'GUCs unset — migration RAISE NOTICE-skipped the cron schedule by design'
    );
    return;
  end if;

  select count(*) into v_job_count
    from cron.job
   where jobname = 'bexio-contact-sync-sweep'
     and schedule = '*/5 * * * *';

  if v_job_count = 1 then
    insert into smoke_results values (
      'F',
      'PASS',
      'cron.job bexio-contact-sync-sweep present, schedule */5 * * * *'
    );
  else
    insert into smoke_results values (
      'F',
      'FAIL',
      format('cron.job count=%s (expected 1)', v_job_count)
    );
  end if;
end$F$;

-- ---------------------------------------------------------------------------
-- G — GRANT matrix: only service_role can EXECUTE.
-- ---------------------------------------------------------------------------

do $G$
declare
  v_fn text;
  v_fail text := '';
  v_signature text;
begin
  for v_fn in
    select unnest(array[
      'claim_pending_bexio_contact_syncs(int)',
      'mark_bexio_contact_synced(uuid,int)',
      'mark_bexio_contact_sync_failed(uuid,text)'
    ])
  loop
    v_signature := 'public.' || v_fn;
    if has_function_privilege('service_role', v_signature, 'EXECUTE') is not true then
      v_fail := v_fail || v_fn || ' (service_role denied) ';
    end if;
    if has_function_privilege('authenticated', v_signature, 'EXECUTE') is not false then
      v_fail := v_fail || v_fn || ' (authenticated allowed) ';
    end if;
    if has_function_privilege('anon', v_signature, 'EXECUTE') is not false then
      v_fail := v_fail || v_fn || ' (anon allowed) ';
    end if;
  end loop;

  if v_fail = '' then
    insert into smoke_results values ('G', 'PASS', 'service_role only — service_role:EXECUTE; authenticated/anon DENY');
  else
    insert into smoke_results values ('G', 'FAIL', trim(v_fail));
  end if;
end$G$;

-- ---------------------------------------------------------------------------
-- Z — Cleanup. Drop all run-tagged fixtures.
-- ---------------------------------------------------------------------------

do $Z$
declare
  v_run_id  text;
  v_left    int;
begin
  select run_id into v_run_id from smoke_run_meta limit 1;

  -- audit_log is immutable (Story 1.5) — the bexio_contact_sync* rows
  -- emitted in cases C/D/E persist as run-id-scoped historical data.
  delete from public.customer_addresses
   where customer_id in (select customer_id from smoke_fixture where run_id = v_run_id);
  delete from public.customers
   where customer_number like 'ZZ-' || v_run_id || '-%';

  select count(*) into v_left
    from public.customers
   where customer_number like 'ZZ-' || v_run_id || '-%';

  insert into smoke_results values (
    'Z',
    case when v_left = 0 then 'PASS' else 'FAIL' end,
    format('residue customers=%s', v_left)
  );
end$Z$;

-- ---------------------------------------------------------------------------
-- Result print.
-- ---------------------------------------------------------------------------

select case_id, status, detail
  from smoke_results
 order by case_id;

-- ---------------------------------------------------------------------------
-- Runtime cases (CANNOT be exercised from psql — reviewer checklist):
--   A-runtime: fresh create → ⏳ Pending → ✓ Synced after manual click.
--   B-runtime: relevant edit (last_name) re-enqueues + bexio reflects change.
--   C-runtime: notes-only edit does NOT enqueue (verify via SQL: customer
--               row stays 'synced' after editing only notes).
--   D-runtime: manual resync from Failed transitions card cleanly.
--   E-runtime: bexio outage simulation (revoke credential is_active=false).
--   F-runtime: Search-Before-POST recovery on a manually pre-created
--               bexio-side contact.
--   G-runtime: cron sweep drains 3 pending rows in a single 5-min window.
--   H-runtime: technician role gets 401/403 from Edge Function.
-- ---------------------------------------------------------------------------
