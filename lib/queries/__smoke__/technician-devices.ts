// Smoke contract for `public.technician_devices` view (migration 00047,
// Story 3.2 — partially resolves deferred-work line 247).
//
// Why this file exists:
//   * `technician_devices` was added in Story 3.2 (migration 00047) but
//     has no runtime consumer in Story 3.2. Column-list drift would go
//     undetected until Story 3.5 (technician mobile inventory) lands the
//     first runtime path.
//   * This file is the interim TS-pinned contract: a typed `select` of
//     every column the view exposes. A future migration that re-emits
//     the view with a changed column list (e.g. dropping a column the
//     consumer relies on) will TS-error at the assignment to
//     `TechnicianDeviceRow` in this file.
//
// Not a test; not run by CI. A one-shot reproduction recipe.
// Story 3.5 should replace this with the canonical
// `lib/queries/technician-devices.ts` runtime consumer.

import { createClient } from "@/lib/supabase/client";

// Hand-rolled row interface mirroring the view's column list. The view
// excludes `acquisition_price` (Einkaufspreis redaction for technician
// role) and inner-joins through `technician_articles` so soft-deleted
// articles silently hide their devices.
export interface TechnicianDeviceRow {
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

const TECHNICIAN_DEVICE_COLUMNS =
  "id, serial_number, article_id, qr_code, status, condition, is_new, " +
  "current_warehouse_id, current_contract_id, supplier_id, inbound_date, " +
  "outbound_date, acquired_at, reserved_for_customer_id, reserved_at, " +
  "retired_at, notes, created_at, updated_at, created_by, updated_by";

export async function smokeTechnicianDevices(): Promise<TechnicianDeviceRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("technician_devices")
    .select(TECHNICIAN_DEVICE_COLUMNS)
    .limit(1);
  if (error) throw error;
  return (data ?? []) as unknown as TechnicianDeviceRow[];
}

export const _technicianDeviceRowAssignableProbe: TechnicianDeviceRow | null =
  null;
