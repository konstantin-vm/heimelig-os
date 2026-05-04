// Inventory-domain runtime constants + German labels (Story 3.4).
//
// The inventory page (`/articles/inventory`) is a read-only aggregate over
// `public.inventory_overview` — the bucket / warning enums are derived
// view columns; their wire values come from the SQL `case` expressions in
// migration 00053. Keep these enums in lock-step with the migration.

import {
  availabilityBucketValues,
  stockWarningValues,
} from "@/lib/validations/inventory";

// One inventory page renders 24 cards: 4 columns × 6 rows on the xl
// breakpoint, 3×8 on lg, 2×12 on sm, 1×24 on mobile. Pagination kicks in
// when total rentable articles exceed 24. Single page-size for now;
// a configurable size adds visual jitter without solving a real problem
// in Sprint 1's catalog scale (~30–50 rentable articles).
export const INVENTORY_LIST_PAGE_SIZE = 24;

// Cap on free-text search input. Mirror Stories 3.1 / 3.2 (`ARTICLE_SEARCH_MAX_LEN`,
// `DEVICE_SEARCH_MAX_LEN`). Search escape rules: see
// `lib/queries/inventory.ts` `escapeSearchTerm()` — escapes `%`, `_`, `,`,
// `(`, `)`, `\`, `*`, `:` (the latter two added in Story 3.4 to close the
// Story-3.2 review deferred-work line 249 in the same pass across
// `articles.ts` + `devices.ts` + `inventory.ts`).
export const INVENTORY_SEARCH_MAX_LEN = 100;

// German labels for the derived availability_bucket column. Source of
// truth for the SQL boundary lives in migration 00053 (red=0, yellow=1..5,
// green>5). The `<AvailabilityBadge>` arm of `<StatusBadge>` looks up by
// these enum keys.
export const availabilityBucketLabels: Record<
  (typeof availabilityBucketValues)[number],
  string
> = {
  green: "Verfügbar",
  yellow: "Knapp",
  red: "Vergriffen",
};

// German labels for the derived stock_warning column. `none` renders no
// badge (the `<StockWarningBadge>` arm returns null on `none`); `low`
// = orange "Mindestbestand unterschritten"; `critical` = red "Kritisch
// — sofort handeln". Critical wins over low (the SQL `case` orders the
// critical branch first).
export const stockWarningLabels: Record<
  (typeof stockWarningValues)[number],
  string
> = {
  none: "",
  low: "Mindestbestand unterschritten",
  critical: "Kritisch — sofort handeln",
};

// Inventory list sort options — the view does not carry `created_at` /
// `updated_at`, so sorts are limited to columns the view exposes.
export type InventoryListSortValue =
  | "name"
  | "available_asc"
  | "utilization_desc";

export const INVENTORY_LIST_DEFAULT_SORT: InventoryListSortValue = "name";

export const inventoryListSortLabels: Record<InventoryListSortValue, string> = {
  name: "Name (A → Z)",
  available_asc: "Vergriffene zuerst",
  utilization_desc: "Höchste Auslastung zuerst",
};
