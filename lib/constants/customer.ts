// Customer-domain runtime constants (Story 2.5 — page size, default sort).

export const CUSTOMER_LIST_PAGE_SIZE = 25;

export type CustomerListSortColumn =
  | "last_name"
  | "phone"
  | "created_at"
  | "bexio_sync_status";

export type CustomerListSortDir = "asc" | "desc";

export const CUSTOMER_LIST_DEFAULT_SORT: {
  col: CustomerListSortColumn;
  dir: CustomerListSortDir;
} = {
  col: "last_name",
  dir: "asc",
};

// The set of columns that actually accept server-side sort in Sprint 1.
// Resolved decision 1 — sorting by a joined column (Adresse / Versicherung /
// Geräte) is deferred to a follow-up story (a `customer_list_view`
// materialised view would be the right vehicle).
export const SORTABLE_CUSTOMER_LIST_COLUMNS: ReadonlySet<CustomerListSortColumn> =
  new Set(["last_name", "phone", "created_at", "bexio_sync_status"]);
