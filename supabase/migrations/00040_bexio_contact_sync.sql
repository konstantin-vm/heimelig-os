-- Migration 00040 — bexio Contact Synchronization (Story 2.6).
--
-- Provisions the database side of the `bexio-contact-sync` Edge Function:
--   * pg_net extension (cron → Edge Function HTTP POST)
--   * claim_pending_bexio_contact_syncs(p_limit int)
--       SECURITY DEFINER service_role-only batch claim with FOR UPDATE
--       SKIP LOCKED. Returns up to p_limit customer ids whose
--       bexio_sync_status='pending' AND is_active=true, ordered by
--       updated_at ASC (oldest pending first). Used by the sweep path of
--       the Edge Function. The UPDATE happens later, when the Edge
--       Function calls mark_*; the claim merely surfaces ids while
--       holding row-level locks for the duration of the surrounding
--       transaction.
--   * mark_bexio_contact_synced(p_customer_id uuid, p_bexio_contact_id int)
--       Sets bexio_contact_id, bexio_sync_status='synced', bexio_synced_at=now().
--       Idempotent: re-running with identical args is a semantic no-op.
--       Writes one audit_log entry via log_activity (actor_system='contact_sync').
--   * mark_bexio_contact_sync_failed(p_customer_id uuid, p_error_code text)
--       Sets bexio_sync_status='failed' and bumps updated_at. Does NOT touch
--       bexio_contact_id (preserved on transient + later 4xx — caller may
--       have a previously-linked contact). Writes one audit_log entry.
--   * cron schedule 'bexio-contact-sync-sweep' every 5 minutes, calling
--       net.http_post against the Edge Function URL with the
--       x-cron-secret header so the function can authenticate the cron
--       caller.
--
-- Bootstrap (set BEFORE pushing this migration on Cloud Zürich, exactly
-- like 00021 documents the Vault-secret bootstrap):
--
--     alter database postgres set app.bexio_contact_sync_url
--       = 'https://<project-ref>.supabase.co/functions/v1/bexio-contact-sync';
--     alter database postgres set app.bexio_cron_secret
--       = '<32-byte hex from `openssl rand -hex 32`>';
--
-- The same secret value MUST also be set as Edge Function env var
-- BEXIO_CRON_SECRET (`supabase secrets set BEXIO_CRON_SECRET=<value>`).
-- If either GUC is unset the migration RAISE NOTICE-skips the cron
-- schedule (RPCs still install). Operators can re-run the cron block
-- manually after bootstrap with:
--
--     do $$ ... end$$;  -- the trailing block at the bottom of this file
--
-- Rollback:
--   The functions are CREATE OR REPLACE; the cron schedule replays via
--   unschedule-then-schedule. Re-running this migration is safe.
--
-- Story 2.6 ACs covered: AC5, AC14, AC15.
-- Project nDSG residency: every code path here is Supabase Zürich;
-- pg_net.http_post hits the Edge Function URL which itself runs in
-- Zürich; no PII transits Vercel Frankfurt.

-- =============================================================================
-- pg_net extension — required for cron → Edge Function HTTP POST.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- =============================================================================
-- claim_pending_bexio_contact_syncs(p_limit) — sweep batch claim.
-- =============================================================================

create or replace function public.claim_pending_bexio_contact_syncs(
  p_limit int default 25
)
returns setof uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int;
begin
  if p_limit is null or p_limit <= 0 then
    v_limit := 25;
  elsif p_limit > 100 then
    v_limit := 100;
  else
    v_limit := p_limit;
  end if;

  return query
  select c.id
    from public.customers c
   where c.bexio_sync_status = 'pending'
     and c.is_active = true
   order by c.updated_at asc
   limit v_limit
   for update skip locked;
end;
$$;

revoke execute on function public.claim_pending_bexio_contact_syncs(int) from public, anon, authenticated;
grant  execute on function public.claim_pending_bexio_contact_syncs(int) to service_role;

comment on function public.claim_pending_bexio_contact_syncs(int) is
  'Story 2.6 AC5/AC10. SECURITY DEFINER service_role-only batch claim of customers.bexio_sync_status=''pending'' rows. Locks the rows with FOR UPDATE SKIP LOCKED to prevent concurrent sweeps (cron + manual) from racing on the same customer. Caller must run the per-customer sync inside the same transaction or accept that the lock releases on COMMIT/ROLLBACK before mark_* runs (acceptable: bexio''s api_reference Search-Before-POST covers any double-POST). p_limit clamped to [1, 100]; default 25.';

-- =============================================================================
-- mark_bexio_contact_synced — idempotent success write + audit row.
-- =============================================================================

create or replace function public.mark_bexio_contact_synced(
  p_customer_id        uuid,
  p_bexio_contact_id   int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before  jsonb;
  v_existed boolean;
begin
  if p_customer_id is null then
    raise exception 'mark_bexio_contact_synced: p_customer_id is null'
      using errcode = '22023';
  end if;
  if p_bexio_contact_id is null or p_bexio_contact_id <= 0 then
    raise exception 'mark_bexio_contact_synced: p_bexio_contact_id must be positive int (got %)', p_bexio_contact_id
      using errcode = '22023';
  end if;

  select jsonb_build_object(
           'bexio_contact_id',   c.bexio_contact_id,
           'bexio_sync_status',  c.bexio_sync_status,
           'bexio_synced_at',    c.bexio_synced_at
         ),
         true
    into v_before, v_existed
    from public.customers c
   where c.id = p_customer_id
   for update;

  if not coalesce(v_existed, false) then
    raise exception 'mark_bexio_contact_synced: customer % not found', p_customer_id
      using errcode = '23503';
  end if;

  update public.customers
     set bexio_contact_id  = p_bexio_contact_id,
         bexio_sync_status = 'synced',
         bexio_synced_at   = now()
   where id = p_customer_id;

  perform public.log_activity(
    'bexio_contact_synced',
    'customers',
    p_customer_id,
    v_before,
    jsonb_build_object(
      'bexio_contact_id',  p_bexio_contact_id,
      'bexio_sync_status', 'synced'
    ),
    jsonb_build_object(
      'actor_system',     'contact_sync',
      'bexio_contact_id', p_bexio_contact_id
    )
  );
end;
$$;

revoke execute on function public.mark_bexio_contact_synced(uuid, int) from public, anon, authenticated;
grant  execute on function public.mark_bexio_contact_synced(uuid, int) to service_role;

comment on function public.mark_bexio_contact_synced(uuid, int) is
  'Story 2.6 AC5/AC14. SECURITY DEFINER service_role-only success write path for the bexio-contact-sync Edge Function. Sets customers.bexio_contact_id, bexio_sync_status=''synced'', bexio_synced_at=now() and emits one audit_log row (action ''bexio_contact_synced'', actor_system=''contact_sync''). Idempotent: re-running with identical args writes the same row state and a fresh audit row capturing the unchanged delta (the AFTER block holds the new sync timestamp). Raises 22023 on null/non-positive args, 23503 if the customer does not exist.';

-- =============================================================================
-- mark_bexio_contact_sync_failed — sticky-failure write + audit row.
-- =============================================================================

create or replace function public.mark_bexio_contact_sync_failed(
  p_customer_id uuid,
  p_error_code  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before  jsonb;
  v_existed boolean;
  v_code    text;
begin
  if p_customer_id is null then
    raise exception 'mark_bexio_contact_sync_failed: p_customer_id is null'
      using errcode = '22023';
  end if;

  -- Defensive cap on error_code shape (the column is not stored on
  -- customers — only audit_log + error_log carry it — but we still cap
  -- before persisting into audit_log.details.error_code).
  v_code := nullif(btrim(coalesce(p_error_code, '')), '');
  if v_code is not null and length(v_code) > 80 then
    v_code := substr(v_code, 1, 80);
  end if;

  select jsonb_build_object(
           'bexio_sync_status', c.bexio_sync_status
         ),
         true
    into v_before, v_existed
    from public.customers c
   where c.id = p_customer_id
   for update;

  if not coalesce(v_existed, false) then
    raise exception 'mark_bexio_contact_sync_failed: customer % not found', p_customer_id
      using errcode = '23503';
  end if;

  update public.customers
     set bexio_sync_status = 'failed',
         updated_at        = now()
   where id = p_customer_id;

  perform public.log_activity(
    'bexio_contact_sync_failed',
    'customers',
    p_customer_id,
    v_before,
    jsonb_build_object(
      'bexio_sync_status', 'failed'
    ),
    jsonb_build_object(
      'actor_system', 'contact_sync',
      'error_code',   coalesce(v_code, 'unknown')
    )
  );
end;
$$;

revoke execute on function public.mark_bexio_contact_sync_failed(uuid, text) from public, anon, authenticated;
grant  execute on function public.mark_bexio_contact_sync_failed(uuid, text) to service_role;

comment on function public.mark_bexio_contact_sync_failed(uuid, text) is
  'Story 2.6 AC5/AC14. SECURITY DEFINER service_role-only sticky-failure write path. Sets customers.bexio_sync_status=''failed'' and bumps updated_at. Does NOT touch bexio_contact_id — a previously-linked contact stays linked even if the latest sync failed. Emits one audit_log row (action ''bexio_contact_sync_failed'', actor_system=''contact_sync'', details.error_code). The error message itself is stored in error_log by the Edge Function via logEdgeError; only the structured code is in audit_log.details.';

-- =============================================================================
-- Cron schedule 'bexio-contact-sync-sweep' — every 5 minutes.
--
-- Reads two GUCs set via `alter database postgres set app.X = '...';`
-- (see header). When unset the schedule is skipped with a NOTICE so the
-- migration applies cleanly on environments where the operator has not
-- yet bootstrapped (e.g. fresh CI database).
-- =============================================================================

create extension if not exists pg_cron;

do $$
declare
  v_url    text := nullif(current_setting('app.bexio_contact_sync_url', true), '');
  v_secret text := nullif(current_setting('app.bexio_cron_secret',     true), '');
begin
  -- Idempotent unschedule first (separate inner block so a missing job
  -- doesn't abort the outer block).
  begin
    perform cron.unschedule('bexio-contact-sync-sweep');
  exception when others then
    null;
  end;

  if v_url is null or v_secret is null then
    raise notice 'Story 2.6 — skipping bexio-contact-sync-sweep cron schedule: app.bexio_contact_sync_url and/or app.bexio_cron_secret unset. Bootstrap with:%  alter database postgres set app.bexio_contact_sync_url = ''https://<project-ref>.supabase.co/functions/v1/bexio-contact-sync'';%  alter database postgres set app.bexio_cron_secret = ''<32-byte hex>'';%then re-run the cron block at the bottom of migration 00040.', chr(10), chr(10), chr(10);
    return;
  end if;

  perform cron.schedule(
    'bexio-contact-sync-sweep',
    '*/5 * * * *',
    format(
      $cron$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb);$cron$,
      v_url,
      v_secret
    )
  );
end$$;

-- End of migration 00040.
