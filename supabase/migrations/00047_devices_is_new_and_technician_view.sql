-- Migration 00047 — Story 3.2 (Device Tracking by Serial Number).
-- Three small additions on top of the Story 1.3 device baseline (00008):
--   1. `devices.is_new boolean not null default true` — was missing from
--      00008. Data-model-spec §5.4.1 line 571 lists `is_new` as a required
--      column (sourced from MTG-009, 2026-04-28: a single device can be
--      assigned to a Mietvertrag *or* a Verkauf depending on `is_new`).
--      Spec is the SSOT; 00008 was the lagging side. Production back-fill
--      rules ship in Story 9.1 Blue-Office migration; for the seed/cloud
--      database every existing row is treated as "new".
--   2. `public.technician_devices` view — column-redacted (no
--      `acquisition_price`) joined through `public.technician_articles`
--      (which already filters `articles.is_active = true` per 00043).
--      Closes the deferred-work follow-up from Story 3.1 review:
--      `_bmad-output/implementation-artifacts/deferred-work.md` line 229
--      ("`technician_articles` view soft-delete semantics — once Story 3.2
--      lands and devices reference articles by FK, a soft-deleted article
--      will produce dangling-FK rendering on the technician side"). The
--      join through `technician_articles` makes the soft-delete propagate:
--      a soft-deleted article disappears silently from the technician's
--      catalog instead of producing dangling references.
--   3. `devices` joins the `supabase_realtime` publication via the
--      idempotent membership check pattern from 00038 / 00043. Story 3.4
--      (Inventory page realtime) and the article-detail device card need
--      `postgres_changes` events on `public.devices`; without publication
--      membership the channel mounts cleanly but never fires.
--
-- Notes carried forward:
--   * Audit-trigger binding for `devices` is already wired in 00014 line
--     122 — every INSERT/UPDATE/DELETE writes an `audit_log` row via the
--     generic `audit_trigger_fn`. The new `is_new` column is picked up
--     automatically by the delta function (no re-binding needed).
--   * RLS policies on `devices` (admin ALL, office SELECT/INSERT/UPDATE,
--     warehouse SELECT/INSERT/UPDATE) stay as 00009 lines 309–336. No
--     direct technician SELECT policy exists on the table — RLS denies by
--     default. Technician access is via the new view only.
--   * Status transitions are deferred to Story 3.3 (`transition_device_status`
--     SECURITY DEFINER RPC). Story 3.2 only seeds the initial status
--     server-side via the existing default `'available'`.
--
-- Replay safety: every step uses `if exists` / `if not exists` /
-- `create or replace view` / idempotent membership check so a second
-- `supabase db push --linked` is a no-op.

-- =============================================================================
-- 1. Add `is_new boolean not null default true` to devices.
-- =============================================================================

alter table public.devices
  add column if not exists is_new boolean not null default true;

comment on column public.devices.is_new is
  'True when the device has never been rented or sold. Used by Epic 4 (order '
  'capture) to gate the rental-vs-sale path per article when both is_rentable '
  'AND is_sellable are true (MTG-009, 2026-04-28). Flips to false on first '
  'rental/sale completion in Epic 5 / Story 4.x. Manual override allowed via '
  'the device edit form (admin-editable). Data-model-spec §5.4.1 line 571.';

-- =============================================================================
-- 2. `public.technician_devices` view — column-redacted, soft-delete-safe.
-- =============================================================================
-- Joins through `public.technician_articles` (00043) so the article-level
-- `is_active = true` filter propagates: soft-deleted articles silently
-- disappear from the technician's device catalog instead of producing
-- dangling-FK rendering. Excludes `acquisition_price` (mirrors the
-- technician redaction pattern from 00043 for `articles.purchase_price`).
-- Created without `with (security_invoker = true)` so it runs as the view
-- owner and bypasses RLS on `devices`. Technicians have no direct SELECT
-- policy on `devices` (RLS denies by default — confirmed in 00009 lines
-- 309–336), so the view is the only path.

drop view if exists public.technician_devices;
create view public.technician_devices as
  select
    d.id,
    d.serial_number,
    d.article_id,
    d.qr_code,
    d.status,
    d.condition,
    d.is_new,
    d.current_warehouse_id,
    d.current_contract_id,
    d.supplier_id,
    d.inbound_date,
    d.outbound_date,
    d.acquired_at,
    -- acquisition_price intentionally excluded (Einkaufspreis redaction)
    d.reserved_for_customer_id,
    d.reserved_at,
    d.retired_at,
    d.notes,
    d.created_at,
    d.updated_at,
    d.created_by,
    d.updated_by
  from public.devices d
  -- INNER join through technician_articles so a soft-deleted article
  -- (is_active = false) cascades-hides every device that points at it.
  join public.technician_articles a on a.id = d.article_id;

comment on view public.technician_devices is
  'Column-redacted view of public.devices for the technician role. Excludes '
  'acquisition_price (Einkaufspreis redaction, mirrors technician_articles in '
  '00043). Joined through public.technician_articles so a soft-deleted article '
  '(is_active=false) silently hides every device pointing at it — closes the '
  'deferred-work follow-up from Story 3.1 review (deferred-work.md line 229). '
  'Created without security_invoker so it runs as owner and bypasses RLS on '
  'devices — technicians have no SELECT policy on the underlying table (RLS '
  'denies by default).';

revoke all on public.technician_devices from public, anon;
grant select on public.technician_devices to authenticated;

-- =============================================================================
-- 3. supabase_realtime publication membership for `devices`.
-- =============================================================================
-- Idempotent membership-check pattern from 00038 (re-used in 00043). The
-- article-detail device card and the inventory page (Story 3.4) subscribe
-- to postgres_changes on public.devices; without publication membership
-- channels mount but never fire row events.

do $$
declare
  t_name text;
  v_target_tables text[] := ARRAY[
    'devices'
  ];
begin
  foreach t_name in array v_target_tables
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname    = 'supabase_realtime'
         and schemaname = 'public'
         and tablename  = t_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        t_name
      );
    end if;
  end loop;
end;
$$;
