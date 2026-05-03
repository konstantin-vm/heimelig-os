-- Migration 00042 — Story 2.6 review round 1, follow-up to 00041.
--
-- 00041 unscheduled the cron job 'bexio-contact-sync-sweep' (preparing to
-- re-register with current_setting() at fire-time per D3) but the
-- conditional reschedule was skipped on Cloud Zürich because the
-- `app.bexio_contact_sync_url` + `app.bexio_cron_secret` GUCs are NOT
-- set. The Supabase Cloud Management API role lacks `ALTER DATABASE`
-- privilege, so the operator cannot bootstrap the GUC path from the
-- repo-level migration mechanism (documented in Story 2.6 Completion
-- Notes step 4 + the round-1 Decisions vs spec addendum).
--
-- Net effect of 00041 alone: cron job removed, sweep stopped working,
-- pending rows only drained via the manual "In bexio anlegen" /
-- "Erneut synchronisieren" buttons.
--
-- This migration restores the cron schedule **unconditionally**. The
-- command body still reads from `current_setting('app.bexio_*', true)`
-- at fire-time, so:
--
--   * If the GUCs ARE set → secret is fetched at fire-time, never
--     persisted in `cron.job.command` (D3 happy path).
--   * If the GUCs are NOT set → `current_setting(..., true)` returns
--     NULL, `net.http_post` is called with `x-cron-secret: null`, the
--     Edge Function rejects with 401 — **the schedule itself is
--     registered**, the operator can set the GUCs at any time and the
--     next tick (≤5 min) will work without re-running migrations.
--
-- This is the operationally-safest version of the D3 fix: the security
-- improvement is preserved (no plaintext in cron.job.command WHEN GUCs
-- are set), the schedule survives un-bootstrapped environments, and the
-- "missing GUC" failure mode is observable via the existing error_log
-- sentinel + Edge Function 401 logs.
--
-- Story 2.6 ACs covered: AC10 (sweep semantics), AC15 (idempotent on replay).

create extension if not exists pg_cron;

do $$
begin
  begin
    perform cron.unschedule('bexio-contact-sync-sweep');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'bexio-contact-sync-sweep',
    '*/5 * * * *',
    $cron$select net.http_post(url := current_setting('app.bexio_contact_sync_url', true), headers := jsonb_build_object('x-cron-secret', current_setting('app.bexio_cron_secret', true), 'Content-Type', 'application/json'), body := '{}'::jsonb);$cron$
  );
end$$;

-- End of migration 00042.
