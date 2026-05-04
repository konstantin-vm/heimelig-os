// Device-domain runtime constants + German labels (Story 3.2).

import {
  deviceConditionValues,
  deviceStatusValues,
} from "@/lib/validations/device";

export const DEVICE_LIST_PAGE_SIZE = 25;
export const DEVICE_AUDIT_TRAIL_PAGE_SIZE = 50;

// Cap on free-text search input (mirrors Story 3.1 article-list pattern).
// Search escape rules: `%`, `_`, `\`, `(`, `)` are escaped; the resulting
// string is then passed to PostgREST `.or(... ilike '*q*' ...)`. Capping
// the input length keeps URL state bounded.
export const DEVICE_SEARCH_MAX_LEN = 100;

export type DeviceListSortColumn =
  | "serial_number"
  | "status"
  | "condition"
  | "created_at";

export type DeviceListSortDir = "asc" | "desc";

export const DEVICE_LIST_DEFAULT_SORT: {
  col: DeviceListSortColumn;
  dir: DeviceListSortDir;
} = {
  col: "serial_number",
  dir: "asc",
};

export const SORTABLE_DEVICE_LIST_COLUMNS: ReadonlySet<DeviceListSortColumn> =
  new Set(["serial_number", "status", "condition", "created_at"]);

// German labels for the device status enum (data-model-spec §5.4.1).
export const deviceStatusLabels: Record<
  (typeof deviceStatusValues)[number],
  string
> = {
  available: "Verfügbar",
  rented: "Vermietet",
  cleaning: "Reinigung",
  repair: "Reparatur",
  sold: "Verkauft",
};

export const deviceConditionLabels: Record<
  (typeof deviceConditionValues)[number],
  string
> = {
  gut: "Gut",
  gebrauchsspuren: "Gebrauchsspuren",
  reparaturbeduerftig: "Reparatur nötig",
};

// is_new is a boolean; expose stable string keys for filter chips + badges.
export const deviceIsNewLabels: Record<"true" | "false", string> = {
  true: "Neu",
  false: "Gebraucht",
};

// Story 3.3 — directed state-machine matrix mirrored from migration 00049.
// Single source of truth for the UI; the database has its own copy hard-coded
// inside `transition_device_status()`. Intentional duplication — the UI reads
// optimistically (so we don't round-trip just to render the next-status
// buttons), the RPC re-validates as the authoritative gate. Both copies
// MUST stay in sync; the `Record<DeviceStatus, …>` type forces exhaustive
// coverage at compile time so a new status added to `deviceStatusValues`
// fails to type-check until this map gets a row for it.
export const deviceStatusTransitions: Record<
  (typeof deviceStatusValues)[number],
  ReadonlyArray<(typeof deviceStatusValues)[number]>
> = {
  available: ["rented", "repair", "sold"],
  rented: ["cleaning"],
  cleaning: ["available", "repair"],
  repair: ["available", "sold"],
  sold: [],
};

export function isTerminalDeviceStatus(
  status: (typeof deviceStatusValues)[number],
): boolean {
  return deviceStatusTransitions[status].length === 0;
}
