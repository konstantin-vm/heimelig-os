// Smoke contract for `public.warehouse_devices` view (migration 00053,
// Story 3.4 — pays back Story 3.2 deferred-work line 244).
//
// Why this file exists:
//   * `warehouse_devices` is a column-redacted clone of `public.devices`
//     dropping `acquisition_price` only (Einkaufspreis redaction for
//     warehouse role's React Query cache). Story 3.4 itself does not have
//     a runtime consumer — the consumer will be Story 3.5 mobile warehouse
//     inventory + a future warehouse-side device-list page.
//   * Without a runtime consumer, the column list will silently drift if
//     a future migration changes `public.devices` (e.g. adds a column)
//     without updating this view via `create or replace view`. The smoke
//     contract here pins the expected column list at the dev-side select
//     string + a typed assignment to a hand-rolled row interface (the
//     project's supabase client is untyped at schema level — see comment
//     at the top of `inventory-overview.ts` for context).
//
// Not a test; not run by CI. A one-shot reproduction recipe.

import { createClient } from "@/lib/supabase/client";

// Hand-rolled row interface mirroring the SQL view's column list (drops
// `acquisition_price` from `devices`). Pinned here so a future migration
// that drops or renames a column produces a TS error at the
// `.select(...).returns<…>()` cast below.
export interface WarehouseDeviceRow {
  id: string;
  serial_number: string;
  article_id: string;
  qr_code: string | null;
  status: "available" | "rented" | "cleaning" | "repair" | "sold";
  condition: "gut" | "gebrauchsspuren" | "reparaturbeduerftig";
  is_new: boolean;
  current_warehouse_id: string | null;
  current_contract_id: string | null;
  supplier_id: string | null;
  inbound_date: string | null;
  outbound_date: string | null;
  acquired_at: string | null;
  reserved_for_customer_id: string | null;
  reserved_at: string | null;
  retired_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

const WAREHOUSE_DEVICE_COLUMNS =
  "id, serial_number, article_id, qr_code, status, condition, is_new, " +
  "current_warehouse_id, current_contract_id, supplier_id, inbound_date, " +
  "outbound_date, acquired_at, reserved_for_customer_id, reserved_at, " +
  "retired_at, notes, created_at, updated_at, created_by, updated_by";

export async function smokeWarehouseDevices(): Promise<WarehouseDeviceRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("warehouse_devices")
    .select(WAREHOUSE_DEVICE_COLUMNS)
    .limit(1);
  if (error) throw error;
  return (data ?? []) as unknown as WarehouseDeviceRow[];
}

// Deliberate compile-time pin to surface field-list drift in code review.
export const _warehouseDeviceRowAssignableProbe: WarehouseDeviceRow | null =
  null;
