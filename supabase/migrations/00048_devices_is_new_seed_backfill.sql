-- Migration 00048 — Story 3.2 review fix-up.
--
-- Two corrections on top of 00047:
--
-- 1. **`devices.is_new` seed back-fill.** 00047 added the column with
--    `default true`, which seeded EVERY existing row as "new". Per
--    data-model-spec §5.4.1 + MTG-009 (2026-04-28), `is_new` flips to false
--    on first rental or sale completion. Seed devices that were already in
--    `status IN ('rented', 'sold')` therefore landed with the wrong value.
--    This back-fill runs once; idempotent (subsequent runs match zero rows).
--
-- 2. **`public.technician_devices` view re-emitted via `create or replace`.**
--    00047 used `drop view + create view`, which preserves correctness on
--    first apply but would fail with `2BP01 dependent objects` once
--    Story 3.4 (Inventory) joins through this view. Re-emitting here with
--    the exact same column list switches the view's lifecycle to the
--    `create or replace` form for forward-compat. No semantic change.
--
-- Production back-fill rules for Blue-Office migration ship in Story 9.1;
-- this migration only corrects the seed/dev path + tightens the view's
-- replay shape.

-- =============================================================================
-- 1. Back-fill is_new for already-rented/-sold seed devices.
-- =============================================================================

update public.devices
   set is_new = false
 where is_new = true
   and status in ('rented', 'sold');

comment on column public.devices.is_new is
  'True when the device has never been rented or sold. Used by Epic 4 (order '
  'capture) to gate the rental-vs-sale path per article when both is_rentable '
  'AND is_sellable are true (MTG-009, 2026-04-28). Flips to false on first '
  'rental/sale completion in Epic 5 / Story 4.x. Manual override allowed via '
  'the device edit form (admin-editable). Seed back-fill applied 2026-05-04 '
  'via 00048 (rented/sold rows from 00047 seeding). Data-model-spec §5.4.1.';

-- =============================================================================
-- 2. Re-emit `public.technician_devices` via `create or replace view`.
-- =============================================================================
-- Same column list + same join shape as 00047. The only purpose is to
-- transition the view from `drop view + create view` (00047) to the
-- `create or replace view` form so future migrations can re-emit it without
-- tripping `2BP01 dependent objects` once Story 3.4 / 3.5 add views or
-- materialized views that depend on it.

create or replace view public.technician_devices as
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

-- Grants are unchanged from 00047 but re-emitted here for clarity (idempotent).
revoke all on public.technician_devices from public, anon;
grant select on public.technician_devices to authenticated;
