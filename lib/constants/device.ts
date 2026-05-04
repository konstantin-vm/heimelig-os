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
