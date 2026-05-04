-- Migration 00053 — Story 3.4 (Article Overview with Availability & Stock Warnings).
--
-- Slot bumped from the 00049 the story originally reserved: parallel WIP
-- on Stories 3.3 (`transition_device_status` → 00049), 3.7 (`qr_label_runs`
-- → 00050), an unresolved cloud-only 00051, and 3.6 (`batch_register_devices`
-- → 00052) all consumed slots ahead of doc state. Story 3.4 takes the next
-- free slot 00053 per the migrations README "next free in your story's
-- reserved range" rule.
--
-- Two read-only views + one publication addition:
--
--   1. `public.inventory_overview` — one row per `articles.is_rentable = true`
--      article with per-status device counts, derived `availability_bucket`
--      (`green | yellow | red`) and derived `stock_warning`
--      (`none | low | critical`). Replaces N+1 device-count fan-out at the
--      consumer; centralises bucket / warning logic in the view so future
--      consumers (Story 3.5 mobile inventory, Story 1.4.x dashboard widget)
--      get the same contract for free. SECURITY INVOKER — admin / office /
--      warehouse already hold SELECT on both `articles` (00009) and
--      `devices` (00009 lines 309–336) so RLS propagates without surprises.
--      Technicians DO see rows under SECURITY INVOKER (the
--      `articles_technician_select` policy on 00009:271 grants SELECT on
--      `articles where is_rentable = true`); under the LEFT JOIN, all
--      device-count columns evaluate to 0 (devices RLS denies → NULL →
--      COUNT = 0) and `availability_bucket = 'red'` for every row. No
--      PII is exposed (article master data is technician-readable
--      elsewhere already). The actual technician-block lives at the
--      route layer: `app/(auth)/articles/layout.tsx` (Story 3.1)
--      redirects technicians away from `/articles/*` before this query
--      is ever issued. Treat this view as route-guarded, not
--      RLS-enforced at the view layer.
--
--   2. `public.warehouse_devices` — column-redacted clone of `public.devices`
--      that drops `acquisition_price` (Einkaufspreis redaction). Pays back
--      the deferred-work follow-up from Story 3.2 review
--      (`_bmad-output/implementation-artifacts/deferred-work.md` line 244):
--      warehouse role's React Query cache currently still receives
--      `acquisition_price` even though the UI hides the row. Story 3.4
--      itself does NOT consume this view at runtime — the consumer will be
--      Story 3.5 mobile warehouse inventory + a future warehouse-side
--      device-list page. Landing the view here keeps the migration density
--      even and makes the Story 3.2 deferred item resolvable. A
--      TS-checked smoke contract at
--      `lib/queries/__smoke__/warehouse-devices.ts` prevents column-list
--      drift in the meantime.
--
--   3. NO publication step. An earlier draft tried to add
--      `public.inventory_overview` to the `supabase_realtime` publication
--      via the idempotent membership-check pattern from 00038 / 00043 /
--      00047, but Postgres rejects `ALTER PUBLICATION ... ADD TABLE` on a
--      view (raises `0A000 feature_not_supported` — `pg_publication_rel`
--      requires `pg_class.relkind = 'r'`). The client-side
--      `useInventoryRealtime()` hook subscribes directly to
--      `public.articles` AND `public.devices` (both already in the
--      publication per 00043 + 00047) and invalidates `inventoryKeys.all`
--      on any postgres_changes event from either table. Same observable
--      contract as a view publication, no migration work required. See
--      the dedicated step §3 below for the full reasoning.
--
-- Replay safety: every step uses `create or replace view` + `revoke + grant`
-- (idempotent) + the membership-check `do $$ ... if not exists ... end $$`
-- pattern. A second `supabase db push --linked` is a no-op.
--
-- Notes:
--   * No new tables, no new RLS policies, no new mutations. Story 3.4 is
--     read-only by design; threshold edits route through the existing
--     `<ArticleEditForm>` (Story 3.1) which writes to `articles.min_stock`
--     / `articles.critical_stock` directly.
--   * `articles.min_stock` (00007) + `articles.critical_stock` (00043) are
--     the per-article thresholds. Per-category fallback is out of scope
--     for Sprint 1 (Story 3.4.1 once admin-settings page lands).
--   * Bucket boundaries hard-coded in the view per AC3:
--       - red    when available_devices  = 0
--       - yellow when available_devices  BETWEEN 1 AND 5
--       - green  when available_devices  > 5
--   * Warning precedence per AC4: critical wins over low; both omitted when
--     min_stock and critical_stock are NULL.
--   * `count(*) filter (where d.status = 'X' and d.retired_at is null)` is
--     intentional per status. Postgres evaluates each filter independently;
--     do NOT factor out via a HAVING clause (HAVING filters the entire
--     group, not individual aggregates).

-- =============================================================================
-- 1. public.inventory_overview view
-- =============================================================================

create or replace view public.inventory_overview
  with (security_invoker = true)
  as
  select
    a.id              as article_id,
    a.article_number,
    a.name,
    a.category::text  as category,
    a.variant_label,
    a.manufacturer,
    a.min_stock,
    a.critical_stock,
    a.is_active,
    count(d.*) filter (where d.retired_at is null) as total_devices,
    count(d.*) filter (where d.status = 'available' and d.retired_at is null) as available_devices,
    count(d.*) filter (where d.status = 'rented'    and d.retired_at is null) as rented_devices,
    count(d.*) filter (where d.status = 'cleaning'  and d.retired_at is null) as cleaning_devices,
    count(d.*) filter (where d.status = 'repair'    and d.retired_at is null) as repair_devices,
    count(d.*) filter (where d.status = 'sold'      and d.retired_at is null) as sold_devices,
    count(d.*) filter (where d.retired_at is not null) as retired_devices,
    case
      when count(d.*) filter (where d.status = 'available' and d.retired_at is null) = 0 then 'red'
      when count(d.*) filter (where d.status = 'available' and d.retired_at is null) <= 5 then 'yellow'
      else 'green'
    end as availability_bucket,
    case
      when a.critical_stock is not null
        and count(d.*) filter (where d.status = 'available' and d.retired_at is null) < a.critical_stock
        then 'critical'
      when a.min_stock is not null
        and count(d.*) filter (where d.status = 'available' and d.retired_at is null) < a.min_stock
        then 'low'
      else 'none'
    end as stock_warning
  from public.articles a
  left join public.devices d
    on d.article_id = a.id
  where a.is_rentable = true
  group by
    a.id,
    a.article_number,
    a.name,
    a.category,
    a.variant_label,
    a.manufacturer,
    a.min_stock,
    a.critical_stock,
    a.is_active;

comment on view public.inventory_overview is
  'Per-article inventory rollup for the /articles/inventory grid (Story 3.4). '
  'One row per articles.is_rentable=true (regardless of is_active — consumer '
  'filters). Columns: per-status device counts (excluding retired), '
  'retired_devices, derived availability_bucket (red=0, yellow=1..5, green>5) '
  'and derived stock_warning (critical when available<critical_stock, low '
  'when available<min_stock, none otherwise; critical wins over low). '
  'SECURITY INVOKER — admin/office/warehouse already hold SELECT on articles '
  '+ devices (00009/00043). Technicians see rows via the rentable-articles '
  'SELECT policy (00009:271) but with all device-count columns = 0 '
  '(devices RLS denies → LEFT JOIN nulls → COUNT = 0); they are blocked '
  'at the route layer (Story 3.1 articles layout) before reaching this view.';

revoke all on public.inventory_overview from public, anon;
grant select on public.inventory_overview to authenticated;

-- =============================================================================
-- 2. public.warehouse_devices view (Story 3.2 deferred-work line 244)
-- =============================================================================
-- Column-redacted clone of public.devices excluding `acquisition_price`
-- (Einkaufspreis redaction for warehouse role's React Query cache). Story
-- 3.4 itself does not consume this view at runtime; the consumer will be
-- Story 3.5 mobile warehouse inventory + a future warehouse-side device-list
-- page. Landing the view here pays back the Story 3.2 deferred item with
-- no extra round-trip. SECURITY INVOKER — warehouse already holds SELECT
-- on `devices` per 00009 lines 309–336; the view simply hides one column
-- in the consumer-visible projection.

create or replace view public.warehouse_devices
  with (security_invoker = true)
  as
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
  from public.devices d;

comment on view public.warehouse_devices is
  'Column-redacted view of public.devices for the warehouse role (Story 3.4 '
  'pays back Story 3.2 deferred-work line 244). Drops acquisition_price only '
  '(Einkaufspreis redaction); every other column kept. SECURITY INVOKER — '
  'warehouse already holds SELECT on the underlying devices table per '
  '00009 lines 309–336. Story 3.4 itself does not consume this view at '
  'runtime; the runtime consumer will be Story 3.5 mobile warehouse '
  'inventory. Smoke contract: lib/queries/__smoke__/warehouse-devices.ts.';

revoke all on public.warehouse_devices from public, anon;
grant select on public.warehouse_devices to authenticated;

-- =============================================================================
-- 3. Realtime: client-side dual-table subscription (NO publication on view)
-- =============================================================================
-- Postgres `ALTER PUBLICATION ... ADD TABLE` rejects views (the publication
-- model is row-level on physical tables — `pg_publication_rel.prrelid`
-- references `pg_class` rows of relkind = 'r'). An earlier draft of this
-- migration tried to add `public.inventory_overview` to the
-- `supabase_realtime` publication via the idempotent membership check
-- pattern from 00038 / 00043 / 00047; the ALTER raises 0A000
-- `feature_not_supported` ("public.inventory_overview is not a table or
-- partitioned table"). Documented in `docs/internal/manual-qa-backlog.md`
-- under "Migration-history sync".
--
-- Resolution: drop the publication step entirely. The view's underlying
-- tables (`public.articles`, `public.devices`) are already in the
-- `supabase_realtime` publication per migrations 00043 + 00047, and the
-- client-side `useInventoryRealtime()` hook subscribes to BOTH tables
-- directly. On any postgres_changes event for either table, the hook
-- invalidates `inventoryKeys.all` — same observable behaviour as
-- publishing the view, with no migration work required. AC-RT documents
-- this fallback as the intended path; the publication-on-view path is
-- out of scope for the Sprint 1 implementation.
