import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { cantonFromZip } from "@/lib/utils/canton";
import {
  CUSTOMER_LIST_DEFAULT_SORT,
  CUSTOMER_LIST_PAGE_SIZE,
  type CustomerListSortColumn,
  type CustomerListSortDir,
} from "@/lib/constants/customer";
import type { SwissCantonCode } from "@/lib/constants/swiss-cantons";
import { logError } from "@/lib/utils/error-log";
import type {
  ContactPerson,
  ContactPersonCreate,
  ContactPersonUpdate,
  Customer,
  CustomerAddress,
  CustomerAddressCreate,
  CustomerAddressUpdate,
  CustomerCreate,
  CustomerInsurance,
  CustomerInsuranceCreate,
  CustomerInsuranceUpdate,
} from "@/lib/validations/customer";
import type { PartnerInsurer } from "@/lib/validations/partner-insurer";

// ---------------------------------------------------------------------------
// customerKeys — TanStack Query key factory (per CLAUDE.md "TanStack Query"
// section + customer-list.md design-context shape).
// ---------------------------------------------------------------------------

/**
 * Insurer filter values surfaced by the S-003 Versicherung select.
 * - Partner codes (`helsana`/`sanitas`/`kpt`/`visana`) → server-side filter
 *   via `customer_insurance!inner.partner_insurers.code`.
 * - `other` → freetext insurer (partner_insurer_id null + freetext set).
 * - `none` → no active grund row; Sprint-1 carve-out (Resolved decision)
 *   filters client-side after the page fetch.
 */
export type CustomerInsurerFilter =
  | "helsana"
  | "sanitas"
  | "kpt"
  | "visana"
  | "other"
  | "none";

export type CustomerTimeframeFilter = "30d" | "6m" | "1y" | "older";

export type CustomerStatusFilter = "active" | "inactive";

export type CustomerListFilters = {
  search?: string;
  region?: SwissCantonCode | null;
  insurer?: CustomerInsurerFilter | null;
  timeframe?: CustomerTimeframeFilter | null;
  status?: CustomerStatusFilter | null;
  sort?: CustomerListSortColumn;
  dir?: CustomerListSortDir;
  page?: number;
  pageSize?: number;
};

export const customerKeys = {
  all: ["customers"] as const,
  totalCount: () => [...customerKeys.all, "total-count"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (filters: CustomerListFilters) =>
    [...customerKeys.lists(), filters] as const,
  detail: (id: string) => [...customerKeys.all, "detail", id] as const,
  contacts: (id: string) =>
    [...customerKeys.all, "detail", id, "contacts"] as const,
  insurance: (id: string) =>
    [...customerKeys.all, "detail", id, "insurance"] as const,
  addresses: (id: string) =>
    [...customerKeys.all, "detail", id, "addresses"] as const,
  bexio: (id: string) =>
    [...customerKeys.all, "detail", id, "bexio"] as const,
  recentOrders: (id: string) =>
    [...customerKeys.all, "detail", id, "recent-orders"] as const,
  activeDevices: (id: string) =>
    [...customerKeys.all, "detail", id, "active-devices"] as const,
};

export const partnerInsurerKeys = {
  all: ["partner_insurers"] as const,
  activeList: () => [...partnerInsurerKeys.all, "active"] as const,
};

// ---------------------------------------------------------------------------
// Row shape returned by useCustomersList — joins primary address + primary
// grund insurance (latest active row, is_primary=true) for the badge column.
// ---------------------------------------------------------------------------

export type CustomerListPrimaryInsurer = {
  /** Partner-KK code when linked to a seeded partner_insurers row. */
  partner_code: string | null;
  /** Freetext insurer name when not a partner-KK ("Andere"). */
  freetext_name: string | null;
};

export type CustomerListRow = Pick<
  Customer,
  | "id"
  | "customer_number"
  | "customer_type"
  | "first_name"
  | "last_name"
  | "company_name"
  | "phone"
  | "email"
  | "is_active"
  | "created_at"
  | "bexio_sync_status"
> & {
  primary_address: Pick<
    CustomerAddress,
    "id" | "street" | "street_number" | "zip" | "city" | "country"
  > | null;
  primary_insurer: CustomerListPrimaryInsurer | null;
};

export type CustomerListResult = {
  rows: CustomerListRow[];
  total: number;
};

export type CustomerDetail = Customer & {
  primary_address: CustomerAddress | null;
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const TIMEFRAME_TO_FROM: Record<CustomerTimeframeFilter, () => Date | null> = {
  "30d": () => new Date(Date.now() - 30 * 24 * 3600 * 1000),
  "6m": () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d;
  },
  "1y": () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d;
  },
  // "older" is open-ended at the lower bound and bounded at the upper end —
  // older than 1 year. We model it as "< now() - 1y" via .lt().
  older: () => null,
};

function applySortOrder<
  Q extends {
    order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => Q;
  },
>(query: Q, sort: CustomerListSortColumn, dir: CustomerListSortDir): Q {
  const ascending = dir === "asc";
  switch (sort) {
    case "last_name":
      // Default tri-key: last_name → company_name → id. Institution rows fall
      // through to company_name when last_name is null.
      return query
        .order("last_name", { ascending, nullsFirst: false })
        .order("company_name", { ascending, nullsFirst: false })
        .order("id", { ascending });
    case "phone":
      return query
        .order("phone", { ascending, nullsFirst: false })
        .order("id", { ascending });
    case "created_at":
      return query
        .order("created_at", { ascending })
        .order("id", { ascending });
    case "bexio_sync_status":
      return query
        .order("bexio_sync_status", { ascending, nullsFirst: false })
        .order("id", { ascending });
    default:
      return query.order("last_name", { ascending: true, nullsFirst: false });
  }
}

/**
 * Story 2.5 — full customer list with server-side filtering, sorting, and
 * pagination. Returns `{ rows, total }` so the page header count badge stays
 * in sync with the actual filter outcome.
 *
 * Filter strategy:
 *   - search → PostgREST `.or(...ilike)` across customer + address columns
 *     (accelerated by the trigram indexes from migration 00035).
 *   - status → server-side `.eq('is_active', …)`.
 *   - timeframe → server-side `.gte/.lt` on `customers.created_at`.
 *   - insurer → server-side via embedded `customer_insurance!inner` +
 *     `partner_insurers!inner` filter; "other" maps to
 *     `partner_insurer_id IS NULL AND insurer_name_freetext IS NOT NULL`;
 *     "none" is a Sprint-1 carve-out (resolved decision) — filtered
 *     client-side on the fetched page (total may overshoot — documented).
 *   - region → client-side post-filter (PLZ→canton derivation is JS only;
 *     same Sprint-1 carve-out as the spec explicitly documents).
 *
 * keepPreviousData prevents flash-of-empty between filter changes (TanStack
 * v5 idiom — replaces the deprecated `keepPreviousData: true` boolean).
 */
export function useCustomersList(filters: CustomerListFilters = {}) {
  return useQuery({
    queryKey: customerKeys.list(filters),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<CustomerListResult> => {
      const supabase = createClient();
      const sort = filters.sort ?? CUSTOMER_LIST_DEFAULT_SORT.col;
      const dir = filters.dir ?? CUSTOMER_LIST_DEFAULT_SORT.dir;
      const pageSize = filters.pageSize ?? CUSTOMER_LIST_PAGE_SIZE;
      const page = filters.page && filters.page > 0 ? filters.page : 1;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const search = filters.search?.trim() ?? "";
      const insurer = filters.insurer ?? null;
      const timeframe = filters.timeframe ?? null;
      const status = filters.status ?? null;

      // Embed shape — !inner switches in when an insurer filter is set so
      // customers without a matching active grund row drop out at the DB.
      // Otherwise !left preserves "Keine"-state customers in the result.
      const isPartnerInsurer =
        insurer === "helsana" ||
        insurer === "sanitas" ||
        insurer === "kpt" ||
        insurer === "visana";
      const isOtherInsurer = insurer === "other";
      // "none" stays !left + client-side filter (no active row exists).
      const insuranceJoin = isPartnerInsurer || isOtherInsurer ? "!inner" : "!left";

      const selectShape = `
        id,
        customer_number,
        customer_type,
        first_name,
        last_name,
        company_name,
        phone,
        email,
        is_active,
        created_at,
        bexio_sync_status,
        customer_addresses (
          id,
          address_type,
          is_default_for_type,
          is_active,
          street,
          street_number,
          zip,
          city,
          country
        ),
        customer_insurance${insuranceJoin} (
          id,
          insurance_type,
          is_primary,
          is_active,
          partner_insurer_id,
          insurer_name_freetext,
          partner_insurers (
            id,
            code,
            name
          )
        )
      `;

      let query = supabase
        .from("customers")
        .select(selectShape, { count: "exact" });

      // Status filter — Aktiv (true), Inaktiv (false), Alle (no clause).
      if (status === "active") query = query.eq("is_active", true);
      else if (status === "inactive") query = query.eq("is_active", false);

      // Timeframe filter — bucket by created_at.
      if (timeframe) {
        const fromBoundary = TIMEFRAME_TO_FROM[timeframe]();
        if (timeframe === "older") {
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
          query = query.lt("created_at", oneYearAgo.toISOString());
        } else if (fromBoundary) {
          query = query.gte("created_at", fromBoundary.toISOString());
        }
      }

      // Search filter — substring ILIKE across customer + embedded
      // customer_addresses.{street,city,zip} per AC2. Routes through the
      // `public.search_customer_ids(q)` SQL function (migration 00039) so the
      // OR-across-to-many-embed pattern works without forcing `!inner` on
      // the address embed (which would drop customers with no address row).
      // Trigram indexes (00035) cover all nine columns the function reads.
      if (search.length > 0) {
        const { data: searchedIds, error: searchErr } = await supabase.rpc(
          "search_customer_ids",
          { q: search },
        );
        if (searchErr) {
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-list",
              message: searchErr.message,
              details: {
                code: searchErr.code ?? null,
                operation: "search_customer_ids",
              },
            },
            supabase,
          );
          throw searchErr;
        }
        const ids = searchedIds ?? [];
        if (ids.length === 0) {
          return { rows: [], total: 0 };
        }
        query = query.in("id", ids);
      }

      // Insurer filter — partner_codes route through embedded inner-join.
      if (isPartnerInsurer && insurer) {
        query = query
          .eq("customer_insurance.is_primary", true)
          .eq("customer_insurance.is_active", true)
          .eq("customer_insurance.insurance_type", "grund")
          .eq("customer_insurance.partner_insurers.code", insurer);
      } else if (isOtherInsurer) {
        query = query
          .eq("customer_insurance.is_primary", true)
          .eq("customer_insurance.is_active", true)
          .eq("customer_insurance.insurance_type", "grund")
          .is("customer_insurance.partner_insurer_id", null);
      }

      query = applySortOrder(query, sort, dir);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-list",
            message: error.message,
            details: {
              code: error.code ?? null,
              operation: "list",
              // PII-safe — never log search string itself; record presence only
              // (Story 1.5 AC14 — search strings can carry customer names).
              filterCount: [
                search ? "search" : null,
                filters.region ?? null,
                filters.insurer ?? null,
                filters.timeframe ?? null,
                filters.status ?? null,
              ].filter(Boolean).length,
            },
          },
          supabase,
        );
        throw error;
      }

      type EmbeddedAddressRow = {
        id: string;
        address_type: string;
        is_default_for_type: boolean;
        is_active: boolean;
        street: string | null;
        street_number: string | null;
        zip: string | null;
        city: string | null;
        country: string | null;
      };
      type EmbeddedInsuranceRow = {
        insurance_type: string;
        is_primary: boolean;
        is_active: boolean;
        partner_insurer_id: string | null;
        insurer_name_freetext: string | null;
        partner_insurers: { code: string | null; name: string | null } | null;
      };
      type RawListRow = Pick<
        Customer,
        | "id"
        | "customer_number"
        | "customer_type"
        | "first_name"
        | "last_name"
        | "company_name"
        | "phone"
        | "email"
        | "is_active"
        | "created_at"
        | "bexio_sync_status"
      > & {
        customer_addresses: EmbeddedAddressRow[] | EmbeddedAddressRow | null;
        customer_insurance: EmbeddedInsuranceRow[] | EmbeddedInsuranceRow | null;
      };

      const rawRows = ((data ?? []) as unknown as RawListRow[]).map((row) => {
        const {
          customer_addresses,
          customer_insurance,
          ...customer
        } = row;

        const addressRows: EmbeddedAddressRow[] = Array.isArray(customer_addresses)
          ? customer_addresses
          : customer_addresses
            ? [customer_addresses]
            : [];
        const primary = addressRows.find(
          (a) =>
            a.address_type === "primary" &&
            a.is_default_for_type &&
            a.is_active,
        );

        const insuranceRows: EmbeddedInsuranceRow[] = Array.isArray(
          customer_insurance,
        )
          ? customer_insurance
          : customer_insurance
            ? [customer_insurance]
            : [];
        const primaryGrund = insuranceRows.find(
          (i) => i.is_active && i.is_primary && i.insurance_type === "grund",
        );

        return {
          ...customer,
          primary_address: primary
            ? {
                id: primary.id,
                street: primary.street,
                street_number: primary.street_number,
                zip: primary.zip,
                city: primary.city,
                country: primary.country,
              }
            : null,
          primary_insurer: primaryGrund
            ? {
                partner_code: primaryGrund.partner_insurers?.code ?? null,
                freetext_name: primaryGrund.insurer_name_freetext,
              }
            : null,
        } as CustomerListRow;
      });

      // "none" insurer Sprint-1 carve-out — filter rows where no primary
      // grund insurer exists. The total reported back will include all rows
      // before this filter (documented Sprint-1 limitation).
      let filteredRows = rawRows;
      if (insurer === "none") {
        filteredRows = filteredRows.filter((r) => r.primary_insurer === null);
      }

      // Region filter — PLZ→canton derivation is JS only; client-side post-
      // filter on the fetched page (Sprint-1 documented carve-out).
      const region = filters.region ?? null;
      if (region) {
        filteredRows = filteredRows.filter((r) => {
          const z = r.primary_address?.zip ?? null;
          return cantonFromZip(z) === region;
        });
      }

      return {
        rows: filteredRows,
        total: count ?? filteredRows.length,
      };
    },
  });
}

/**
 * Story 2.5 — separate hook for the page-header count badge so it stays
 * in sync with the unfiltered total customer count (the badge shows total
 * customers, not filtered results). 5-minute staleTime keeps office users
 * from refetching on every filter tick.
 */
export function useCustomersTotalCount() {
  return useQuery({
    queryKey: customerKeys.totalCount(),
    queryFn: async (): Promise<number> => {
      const supabase = createClient();
      const { count, error } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-list",
            message: error.message,
            details: {
              code: error.code ?? null,
              operation: "total-count",
            },
          },
          supabase,
        );
        throw error;
      }
      return count ?? 0;
    },
    staleTime: 1000 * 60 * 5, // 5 min
  });
}

/**
 * Story 2.5 — Epic-4 stub. Returns an empty list so the
 * `<CustomerOrdersCard>` exercises its empty state. Epic 4 Story 4.6 swaps
 * the body to actually query `orders` filtered by `customer_id`.
 */
export function useRecentOrders(customerId: string | null) {
  const enabled = customerId !== null && customerId.length > 0;
  return useQuery({
    queryKey: customerKeys.recentOrders(customerId ?? "__none__"),
    queryFn: enabled
      ? async (): Promise<unknown[]> => Promise.resolve([])
      : skipToken,
  });
}

/**
 * Story 2.5 — Epic-5 stub. Returns an empty list so the
 * `<CustomerDevicesCard>` exercises its empty state. Epic 5 Story 5.2 swaps
 * the body to actually query `rental_contracts` joined with `devices` filtered
 * by `customer_id`.
 */
export function useActiveDevices(customerId: string | null) {
  const enabled = customerId !== null && customerId.length > 0;
  return useQuery({
    queryKey: customerKeys.activeDevices(customerId ?? "__none__"),
    queryFn: enabled
      ? async (): Promise<unknown[]> => Promise.resolve([])
      : skipToken,
  });
}

export function useCustomer(id: string | null) {
  // P29 — TanStack v5 `skipToken` keeps the disabled state per-id without
  // polluting the cache with a "__none__" placeholder entry.
  const enabled = id !== null && id.length > 0;
  return useQuery({
    queryKey: enabled ? customerKeys.detail(id) : customerKeys.detail("none"),
    queryFn: enabled
      ? async (): Promise<CustomerDetail | null> => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("customers")
            .select(
              `
              *,
              customer_addresses (
                *
              )
              `,
            )
            .eq("id", id)
            .maybeSingle();

          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "error",
                source: "customer-detail",
                message: error.message,
                details: {
                  customer_id: id,
                  operation: "read",
                  code: error.code ?? null,
                },
                entity: "customers",
                entityId: id,
              },
              supabase,
            );
            throw error;
          }
          if (!data) return null;

          // P30 — destructure instead of mutating-then-casting.
          const { customer_addresses, ...rest } = data;
          const addresses = (customer_addresses ?? []) as CustomerAddress[];
          const primary =
            addresses.find(
              (a) => a.address_type === "primary" && a.is_default_for_type,
            ) ?? null;
          return {
            ...(rest as unknown as Customer),
            primary_address: primary,
          };
        }
      : skipToken,
  });
}

// ---------------- create ----------------

export type CustomerAddressPayload = Omit<CustomerAddressCreate, "customer_id">;

export type CreateCustomerInput = {
  customer: CustomerCreate;
  address: CustomerAddressPayload;
};

export function useCreateCustomer(
  options?: UseMutationOptions<string, Error, CreateCustomerInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ customer, address }: CreateCustomerInput) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc(
        "create_customer_with_primary_address",
        {
          p_customer: customer as unknown as Record<string, unknown>,
          p_address: address as unknown as Record<string, unknown>,
        },
      );

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-form",
            message: error.message,
            details: { operation: "create", code: error.code ?? null },
            entity: "customers",
          },
          supabase,
        );
        // P16 (Round 3) — friendly German mapping for known error codes so
        // the user sees a meaningful message instead of the raw Postgres
        // error in the toast description.
        if (error.code === "23505") {
          throw new Error(
            "Kundennummer bereits vergeben — bitte erneut versuchen.",
          );
        }
        throw error;
      }
      if (typeof data !== "string") {
        throw new Error("create_customer_with_primary_address did not return an id");
      }
      return data;
    },
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      queryClient.invalidateQueries({ queryKey: customerKeys.totalCount() });
      return options?.onSuccess?.(...args);
    },
  });
}

// ---------------- update ----------------

// P3 — atomic update via the `update_customer_with_primary_address` RPC
// (migration 00025). Replaces the previous two-call (customers UPDATE +
// customer_addresses UPDATE-or-INSERT) flow that could half-commit on
// partial failure. The RPC also handles the primary-address upsert with
// `on conflict` against the partial unique index, so legacy customers
// without a primary row are safe (P9).

export type UpdateCustomerInput = {
  id: string;
  /**
   * Partial customer payload — caller is expected to include only the keys
   * whose form fields the user actually changed. Migration 00029's
   * `case when p_customer ? 'key'` guard then preserves columns whose keys
   * are absent.
   */
  customer: Partial<CustomerCreate>;
  address: CustomerAddressPayload;
  /**
   * Whether any of the bexio-sync-relevant fields changed (per AC12). When
   * true the RPC payload includes `bexio_sync_status: 'pending'` AND
   * `bexio_synced_at: null` so the next pg_cron pass picks the row up; when
   * false both fields are OMITTED so a healthy `synced` row keeps its
   * status + last-success timestamp.
   */
  bexioRetrigger: boolean;
};

export function useUpdateCustomer(
  options?: UseMutationOptions<string, Error, UpdateCustomerInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      customer,
      address,
      bexioRetrigger,
    }: UpdateCustomerInput) => {
      const supabase = createClient();

      // P3+P5 (Round 3) — defensive strips. The form already filters by
      // dirtyFields so these keys should not be present, but a future
      // caller could send them; we guarantee the RPC never sees them on
      // the update path.
      const customerForRpc: Record<string, unknown> = { ...customer };
      delete customerForRpc.bexio_sync_status;
      delete customerForRpc.bexio_synced_at;
      delete customerForRpc.bexio_contact_id;
      delete customerForRpc.customer_number;
      delete customerForRpc.is_active;
      if (bexioRetrigger) {
        customerForRpc.bexio_sync_status = "pending";
        // P10 (Round 3) — null the success timestamp so downstream sync
        // filters that read both columns see a consistent "queued" state.
        customerForRpc.bexio_synced_at = null;
      }
      const customerPayload = customerForRpc;

      const { data, error } = await supabase.rpc(
        "update_customer_with_primary_address",
        {
          p_id: id,
          p_customer: customerPayload,
          p_address: address as unknown as Record<string, unknown>,
        },
      );

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-form",
            message: error.message,
            details: {
              customer_id: id,
              operation: "update",
              code: error.code ?? null,
            },
            entity: "customers",
            entityId: id,
          },
          supabase,
        );
        throw error;
      }
      if (typeof data !== "string") {
        throw new Error(
          "update_customer_with_primary_address did not return an id",
        );
      }
      return data;
    },
    ...options,
    onSuccess: (id, ...rest) => {
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: customerKeys.totalCount() });
      return options?.onSuccess?.(id, ...rest);
    },
  });
}

// ===========================================================================
// Contact persons (Story 2.2)
// ---------------------------------------------------------------------------
// Schema lives in lib/validations/customer.ts (contactPersonSchema). RLS
// policies (00009_rls_policies.sql) gate admin/office. Audit trigger
// (00014) auto-emits audit_log rows — never call log_activity() manually
// for this table. Hauptkontakt promote+demote is atomic via the
// public.set_primary_contact_person RPC (00024).
// ===========================================================================

export type ContactPersonCreatePayload = Omit<ContactPersonCreate, "customer_id">;

export function useContactPersons(customerId: string | null) {
  const enabled = customerId !== null && customerId.length > 0;
  return useQuery({
    queryKey: enabled ? customerKeys.contacts(customerId!) : ["customers", "contacts", "__disabled__"],
    queryFn: enabled
      ? async (): Promise<ContactPerson[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contact_persons")
        .select("*")
        .eq("customer_id", customerId!)
        .eq("is_active", true)
        .order("is_primary_contact", { ascending: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-contacts",
            message: error.message,
            details: {
              customer_id: customerId,
              operation: "list",
              code: error.code ?? null,
            },
            entity: "contact_persons",
          },
          supabase,
        );
        throw error;
      }
      return (data ?? []) as ContactPerson[];
    }
      : skipToken,
  });
}

type CreateContactInput = {
  customerId: string;
  values: ContactPersonCreatePayload;
  /** When true, promote this contact to Hauptkontakt after insert. */
  setPrimary?: boolean;
};

export function useCreateContactPerson(
  options?: UseMutationOptions<ContactPerson, Error, CreateContactInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ customerId, values, setPrimary }: CreateContactInput) => {
      const supabase = createClient();

      // Insert with is_primary_contact = false; promote via RPC after to avoid
      // the partial-unique-index race when another primary already exists.
      const insertPayload = {
        ...values,
        customer_id: customerId,
        is_primary_contact: false,
      };

      const { data, error } = await supabase
        .from("contact_persons")
        .insert(insertPayload as never)
        .select("*")
        .single();

      if (error || !data) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-contacts",
            message: error?.message ?? "insert returned no row",
            details: {
              customer_id: customerId,
              operation: "create",
              code: error?.code ?? null,
            },
            entity: "contact_persons",
          },
          supabase,
        );
        throw error ?? new Error("contact_persons insert returned no row");
      }

      const inserted = data as ContactPerson;

      if (setPrimary) {
        const { error: rpcError } = await supabase.rpc(
          "set_primary_contact_person",
          { p_contact_id: inserted.id },
        );
        if (rpcError) {
          // Compensating delete — the row was inserted as non-primary, but the
          // user requested primary. Without rollback we'd leave an orphan
          // non-primary row that the user did not intend. Audit row from the
          // insert is retained (history of the attempt); the delete emits its
          // own audit row.
          await supabase.from("contact_persons").delete().eq("id", inserted.id);
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-contacts",
              message: rpcError.message,
              details: {
                customer_id: customerId,
                contact_id: inserted.id,
                operation: "set_primary",
                code: rpcError.code ?? null,
                constraint:
                  rpcError.code === "23505"
                    ? "idx_contact_persons_primary_unique"
                    : null,
                rolled_back: true,
              },
              entity: "contact_persons",
              entityId: inserted.id,
            },
            supabase,
          );
          throw rpcError;
        }
        return { ...inserted, is_primary_contact: true };
      }

      return inserted;
    },
    ...options,
    onSuccess: (contact, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.contacts(variables.customerId),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      return options?.onSuccess?.(contact, variables, ...rest);
    },
  });
}

type UpdateContactInput = {
  customerId: string;
  contactId: string;
  values: ContactPersonUpdate;
  /** Whether the form requested promoting this contact to Hauptkontakt. */
  setPrimary?: boolean;
};

export function useUpdateContactPerson(
  options?: UseMutationOptions<ContactPerson, Error, UpdateContactInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerId,
      contactId,
      values,
      setPrimary,
    }: UpdateContactInput) => {
      const supabase = createClient();

      // Strip is_primary_contact from the patch — promote needs the RPC to
      // sidestep idx_contact_persons_primary_unique. Demote (false) is safe
      // to fold back into the single UPDATE below.
      const cleanedPatch: Record<string, unknown> = { ...values };
      delete cleanedPatch.is_primary_contact;
      delete cleanedPatch.customer_id;
      if (setPrimary === false) {
        cleanedPatch.is_primary_contact = false;
      }

      if (Object.keys(cleanedPatch).length > 0) {
        const { data: updated, error } = await supabase
          .from("contact_persons")
          .update(cleanedPatch as never)
          .eq("id", contactId)
          .select("id");

        if (error) {
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-contacts",
              message: error.message,
              details: {
                customer_id: customerId,
                contact_id: contactId,
                operation: "update",
                code: error.code ?? null,
              },
              entity: "contact_persons",
              entityId: contactId,
            },
            supabase,
          );
          throw error;
        }

        if (!updated || updated.length === 0) {
          // 0-row update means RLS denied or the row no longer exists —
          // surface as an error so the success toast does not fire.
          const message =
            "Aktualisierung nicht möglich. Datensatz wurde gelöscht oder ist nicht mehr zugänglich.";
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "warning",
              source: "customer-contacts",
              message,
              details: {
                customer_id: customerId,
                contact_id: contactId,
                operation: "update",
                code: "PGRST_ZERO_ROWS",
              },
              entity: "contact_persons",
              entityId: contactId,
            },
            supabase,
          );
          throw new Error(message);
        }
      }

      if (setPrimary === true) {
        const { error: rpcError } = await supabase.rpc(
          "set_primary_contact_person",
          { p_contact_id: contactId },
        );
        if (rpcError) {
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-contacts",
              message: rpcError.message,
              details: {
                customer_id: customerId,
                contact_id: contactId,
                operation: "set_primary",
                code: rpcError.code ?? null,
                constraint:
                  rpcError.code === "23505"
                    ? "idx_contact_persons_primary_unique"
                    : null,
              },
              entity: "contact_persons",
              entityId: contactId,
            },
            supabase,
          );
          throw rpcError;
        }
      }

      const { data: refreshed, error: refreshError } = await supabase
        .from("contact_persons")
        .select("*")
        .eq("id", contactId)
        .single();
      if (refreshError || !refreshed) {
        throw refreshError ?? new Error("contact_persons refresh failed");
      }
      return refreshed as ContactPerson;
    },
    ...options,
    onSuccess: (contact, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.contacts(variables.customerId),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      return options?.onSuccess?.(contact, variables, ...rest);
    },
  });
}

type SoftDeleteContactInput = {
  customerId: string;
  contactId: string;
  /** Restores the contact (is_active = true) when true — used by Undo toast. */
  restore?: boolean;
};

export function useSoftDeleteContactPerson(
  options?: UseMutationOptions<void, Error, SoftDeleteContactInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ customerId, contactId, restore }: SoftDeleteContactInput) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("contact_persons")
        .update({ is_active: !!restore } as never)
        .eq("id", contactId);

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-contacts",
            message: error.message,
            details: {
              customer_id: customerId,
              contact_id: contactId,
              operation: restore ? "restore" : "soft_delete",
              code: error.code ?? null,
            },
            entity: "contact_persons",
            entityId: contactId,
          },
          supabase,
        );
        throw error;
      }
    },
    ...options,
    onSuccess: (data, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.contacts(variables.customerId),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      return options?.onSuccess?.(data, variables, ...rest);
    },
  });
}

// ===========================================================================
// Customer insurance (Story 2.3)
// ---------------------------------------------------------------------------
// Schema lives in lib/validations/customer.ts (customerInsuranceSchema). RLS
// (00009_rls_policies.sql:128-148) gates admin/office. Audit trigger (00014
// :120-122) auto-emits audit_log rows — never call log_activity() manually.
// Hauptversicherung promote+demote is atomic via the
// public.set_primary_customer_insurance RPC (migration 00027). The partial
// unique index `idx_customer_insurance_primary_unique` on
// (customer_id, insurance_type) WHERE is_primary enforces the "one primary
// per type per customer" rule at the DB level.
// ===========================================================================

export type CustomerInsuranceCreatePayload = Omit<
  CustomerInsuranceCreate,
  "customer_id"
>;

export type CustomerInsuranceWithPartner = CustomerInsurance & {
  partner_insurers: PartnerInsurer | null;
};

export function useActivePartnerInsurers() {
  return useQuery({
    queryKey: partnerInsurerKeys.activeList(),
    queryFn: async (): Promise<PartnerInsurer[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("partner_insurers")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "partner-insurers",
            message: error.message,
            details: { operation: "list", code: error.code ?? null },
          },
          supabase,
        );
        throw error;
      }
      return (data ?? []) as PartnerInsurer[];
    },
    staleTime: 1000 * 60 * 60, // 1h — partner-KK list rarely changes
  });
}

export function useCustomerInsurances(customerId: string | null) {
  const enabled = customerId !== null && customerId.length > 0;
  return useQuery({
    queryKey: enabled
      ? customerKeys.insurance(customerId!)
      : ["customers", "insurance", "__disabled__"],
    queryFn: enabled
      ? async (): Promise<CustomerInsuranceWithPartner[]> => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("customer_insurance")
            .select("*, partner_insurers(*)")
            .eq("customer_id", customerId!)
            .eq("is_active", true)
            .order("is_primary", { ascending: false })
            .order("insurance_type", { ascending: true })
            .order("created_at", { ascending: true })
            .order("id", { ascending: true });

          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "error",
                source: "customer-insurance",
                message: error.message,
                details: {
                  customer_id: customerId,
                  operation: "list",
                  code: error.code ?? null,
                },
                entity: "customer_insurance",
              },
              supabase,
            );
            throw error;
          }
          return (data ?? []) as CustomerInsuranceWithPartner[];
        }
      : skipToken,
  });
}

type CreateInsuranceInput = {
  customerId: string;
  values: CustomerInsuranceCreatePayload;
  setPrimary?: boolean;
};

export function useCreateCustomerInsurance(
  options?: UseMutationOptions<CustomerInsurance, Error, CreateInsuranceInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerId,
      values,
      setPrimary,
    }: CreateInsuranceInput) => {
      const supabase = createClient();

      // Insert with is_primary = false; promote via RPC after insert to
      // sidestep the partial-unique race when another primary of the same
      // insurance_type exists.
      const insertPayload = {
        ...values,
        customer_id: customerId,
        is_primary: false,
      };

      const { data, error } = await supabase
        .from("customer_insurance")
        .insert(insertPayload as never)
        .select("*")
        .single();

      if (error || !data) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-insurance",
            message: error?.message ?? "insert returned no row",
            details: {
              customer_id: customerId,
              operation: "create",
              code: error?.code ?? null,
              constraint:
                error?.code === "23514"
                  ? "customer_insurance_insurer_xor"
                  : null,
            },
            entity: "customer_insurance",
          },
          supabase,
        );
        throw error ?? new Error("customer_insurance insert returned no row");
      }

      const inserted = data as CustomerInsurance;

      if (setPrimary) {
        const { error: rpcError } = await supabase.rpc(
          "set_primary_customer_insurance",
          { p_insurance_id: inserted.id },
        );
        if (rpcError) {
          await supabase
            .from("customer_insurance")
            .delete()
            .eq("id", inserted.id);
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-insurance",
              message: rpcError.message,
              details: {
                customer_id: customerId,
                insurance_id: inserted.id,
                operation: "set_primary",
                code: rpcError.code ?? null,
                constraint:
                  rpcError.code === "23505"
                    ? "idx_customer_insurance_primary_unique"
                    : null,
                rolled_back: true,
              },
              entity: "customer_insurance",
              entityId: inserted.id,
            },
            supabase,
          );
          throw rpcError;
        }
        return { ...inserted, is_primary: true };
      }

      return inserted;
    },
    ...options,
    onSuccess: (insurance, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.insurance(variables.customerId),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      return options?.onSuccess?.(insurance, variables, ...rest);
    },
  });
}

type UpdateInsuranceInput = {
  customerId: string;
  insuranceId: string;
  values: CustomerInsuranceUpdate;
  setPrimary?: boolean;
};

export function useUpdateCustomerInsurance(
  options?: UseMutationOptions<CustomerInsurance, Error, UpdateInsuranceInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerId,
      insuranceId,
      values,
      setPrimary,
    }: UpdateInsuranceInput) => {
      const supabase = createClient();

      // Strip is_primary from the patch — promote needs the RPC to
      // sidestep idx_customer_insurance_primary_unique. Demote (false) is
      // safe to fold back into the single UPDATE below.
      const cleanedPatch: Record<string, unknown> = { ...values };
      delete cleanedPatch.is_primary;
      delete cleanedPatch.customer_id;
      if (setPrimary === false) {
        cleanedPatch.is_primary = false;
      }

      if (Object.keys(cleanedPatch).length > 0) {
        const { data: updated, error } = await supabase
          .from("customer_insurance")
          .update(cleanedPatch as never)
          .eq("id", insuranceId)
          .select("id");

        if (error) {
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-insurance",
              message: error.message,
              details: {
                customer_id: customerId,
                insurance_id: insuranceId,
                operation: "update",
                code: error.code ?? null,
                constraint:
                  error.code === "23514"
                    ? "customer_insurance_insurer_xor"
                    : null,
              },
              entity: "customer_insurance",
              entityId: insuranceId,
            },
            supabase,
          );
          throw error;
        }

        if (!updated || updated.length === 0) {
          const message =
            "Aktualisierung nicht möglich. Datensatz wurde gelöscht oder ist nicht mehr zugänglich.";
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "warning",
              source: "customer-insurance",
              message,
              details: {
                customer_id: customerId,
                insurance_id: insuranceId,
                operation: "update",
                code: "PGRST_ZERO_ROWS",
              },
              entity: "customer_insurance",
              entityId: insuranceId,
            },
            supabase,
          );
          throw new Error(message);
        }
      }

      if (setPrimary === true) {
        const { error: rpcError } = await supabase.rpc(
          "set_primary_customer_insurance",
          { p_insurance_id: insuranceId },
        );
        if (rpcError) {
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-insurance",
              message: rpcError.message,
              details: {
                customer_id: customerId,
                insurance_id: insuranceId,
                operation: "set_primary",
                code: rpcError.code ?? null,
                constraint:
                  rpcError.code === "23505"
                    ? "idx_customer_insurance_primary_unique"
                    : null,
              },
              entity: "customer_insurance",
              entityId: insuranceId,
            },
            supabase,
          );
          throw rpcError;
        }
      }

      const { data: refreshed, error: refreshError } = await supabase
        .from("customer_insurance")
        .select("*")
        .eq("id", insuranceId)
        .single();
      if (refreshError || !refreshed) {
        throw refreshError ?? new Error("customer_insurance refresh failed");
      }
      return refreshed as CustomerInsurance;
    },
    ...options,
    onSuccess: (insurance, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.insurance(variables.customerId),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      return options?.onSuccess?.(insurance, variables, ...rest);
    },
  });
}

type SoftDeleteInsuranceInput = {
  customerId: string;
  insuranceId: string;
  /** Restores the insurance (is_active = true) when true — used by Undo toast. */
  restore?: boolean;
};

export function useSoftDeleteCustomerInsurance(
  options?: UseMutationOptions<void, Error, SoftDeleteInsuranceInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerId,
      insuranceId,
      restore,
    }: SoftDeleteInsuranceInput) => {
      const supabase = createClient();
      // Soft-delete: also clear is_primary so the (customer_id, insurance_type)
      // partial-unique slot is released — otherwise a soft-deleted primary
      // permanently blocks any future primary of the same type.
      // Restore: leave is_primary as-is (false after soft-delete) — the user
      // can re-toggle primary explicitly if they want it.
      const patch = restore
        ? { is_active: true }
        : { is_active: false, is_primary: false };
      const { data: updated, error } = await supabase
        .from("customer_insurance")
        .update(patch as never)
        .eq("id", insuranceId)
        .select("id");

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-insurance",
            message: error.message,
            details: {
              customer_id: customerId,
              insurance_id: insuranceId,
              operation: restore ? "restore" : "soft_delete",
              code: error.code ?? null,
            },
            entity: "customer_insurance",
            entityId: insuranceId,
          },
          supabase,
        );
        throw error;
      }

      // RLS-deny silently returns success with zero rows — surface as failure.
      if (!updated || updated.length === 0) {
        const message = restore
          ? "Wiederherstellung nicht möglich. Datensatz wurde gelöscht oder ist nicht mehr zugänglich."
          : "Löschen nicht möglich. Datensatz wurde bereits gelöscht oder ist nicht mehr zugänglich.";
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "warning",
            source: "customer-insurance",
            message,
            details: {
              customer_id: customerId,
              insurance_id: insuranceId,
              operation: restore ? "restore" : "soft_delete",
              code: "PGRST_ZERO_ROWS",
            },
            entity: "customer_insurance",
            entityId: insuranceId,
          },
          supabase,
        );
        throw new Error(message);
      }
    },
    ...options,
    onSuccess: (data, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.insurance(variables.customerId),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      return options?.onSuccess?.(data, variables, ...rest);
    },
  });
}

// ===========================================================================
// Customer addresses (Story 2.4)
// ---------------------------------------------------------------------------
// Schema lives in lib/validations/customer.ts (customerAddressSchema). RLS
// (00009_rls_policies.sql:108-127) gates admin/office (admin: full CRUD;
// office: SELECT/INSERT/UPDATE — no DELETE — soft-delete via is_active=false).
// Audit trigger (00014:121) auto-emits audit_log rows — never call
// log_activity() manually for this table.
// Hauptadresse-pro-Typ promote+demote is atomic via the
// public.set_default_customer_address RPC (migration 00034). The partial
// unique index `idx_customer_addresses_default_per_type_unique` on
// (customer_id, address_type) WHERE is_default_for_type enforces the
// "one default per type per customer" rule at the DB level.
//
// Primary addresses (address_type='primary') are owned exclusively by Story
// 2.1's `create_customer_with_primary_address` /
// `update_customer_with_primary_address` RPCs — never INSERT, UPDATE or
// soft-delete a primary row through the hooks below. The
// set_default_customer_address RPC also rejects address_type='primary'
// targets.
// ===========================================================================

export type CustomerAddressCreatePayload = Omit<
  CustomerAddressCreate,
  "customer_id"
>;

// Pull the actual constraint name out of a PostgrestError. Supabase surfaces
// it inside `message` and/or `details` (e.g. `duplicate key value violates
// unique constraint "idx_customer_addresses_default_per_type_unique"`).
// Returns null when no constraint name can be parsed — operators triaging
// error_log can then distinguish "unparsed" from a real constraint name
// (round-2 review: previously fell back to literal "unknown_unique" which
// silently bucketed unparseable 23505s into a phantom constraint and made
// `details->>'constraint' = '<expected>'` queries miss the bucket).
function extractConstraintName(
  err: { message?: string | null; details?: string | null } | null | undefined,
): string | null {
  if (!err) return null;
  const candidates = [err.message, err.details];
  for (const source of candidates) {
    if (typeof source !== "string") continue;
    const match = source.match(/constraint "([^"]+)"/);
    if (match && match[1]) return match[1];
  }
  return null;
}

// Whitelist of columns that may flow through `useUpdateCustomerAddress`
// patches. Anything outside this list is stripped before the UPDATE — keeps
// id, created_*, updated_*, customer_id, address_type (read-only post-create),
// and is_active (owned by the soft-delete hook) from leaking through stale
// forms. Typed as `keyof CustomerAddressUpdate` so a future column rename
// in the Zod schema fails the build instead of silently dropping the strip
// (round-2 review: previously stringly-typed via `Record<string, unknown>`
// and `as never`, defeating Supabase's generated types).
const MUTABLE_ADDRESS_COLUMNS = [
  "recipient_name",
  "street",
  "street_number",
  "zip",
  "city",
  "country",
  "floor",
  "has_elevator",
  "access_notes",
  "lat",
  "lng",
  "geocoded_at",
] as const satisfies ReadonlyArray<keyof CustomerAddressUpdate>;

type MutableAddressColumn = (typeof MUTABLE_ADDRESS_COLUMNS)[number];
type CustomerAddressMutablePatch = Partial<
  Pick<CustomerAddressUpdate, MutableAddressColumn>
> & {
  is_default_for_type?: boolean;
};

function buildAddressPatch(
  values: CustomerAddressUpdate,
): CustomerAddressMutablePatch {
  const out: CustomerAddressMutablePatch = {};
  for (const key of MUTABLE_ADDRESS_COLUMNS) {
    if (key in values) {
      // Type is preserved via the keyof-driven allowlist — no `as never` needed.
      (out as Record<string, unknown>)[key] = values[key];
    }
  }
  return out;
}

const ADDRESS_TYPE_ORDER: Record<string, number> = {
  primary: 0,
  delivery: 1,
  billing: 2,
  other: 3,
};

function sortAddressesForDisplay<
  T extends Pick<CustomerAddress, "address_type" | "is_default_for_type" | "created_at" | "id">,
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = ADDRESS_TYPE_ORDER[a.address_type] ?? 99;
    const tb = ADDRESS_TYPE_ORDER[b.address_type] ?? 99;
    if (ta !== tb) return ta - tb;
    if (a.is_default_for_type !== b.is_default_for_type) {
      return a.is_default_for_type ? -1 : 1;
    }
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? -1 : 1;
    }
    return a.id < b.id ? -1 : 1;
  });
}

export function useCustomerAddresses(customerId: string | null) {
  const enabled = customerId !== null && customerId.length > 0;
  // Use the customerKeys factory shape regardless of enabled state so cache
  // invalidations on `customerKeys.lists()` / `customerKeys.detail(id)` match
  // even while the query is disabled. The skipToken queryFn keeps the disabled
  // state from fetching. Round-2 review: previously used a hand-crafted
  // `["customers", "addresses", "__disabled__"]` literal which broke the
  // factory invariant documented in CLAUDE.md ("Manual TanStack Query keys").
  return useQuery({
    queryKey: customerKeys.addresses(customerId ?? "__none__"),
    queryFn: enabled
      ? async (): Promise<CustomerAddress[]> => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("customer_addresses")
            .select("*")
            .eq("customer_id", customerId)
            .eq("is_active", true)
            .order("address_type", { ascending: true })
            .order("is_default_for_type", { ascending: false })
            .order("created_at", { ascending: true })
            .order("id", { ascending: true });

          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "error",
                source: "customer-address",
                message: error.message,
                details: {
                  customer_id: customerId,
                  operation: "list",
                  code: error.code ?? null,
                },
                entity: "customer_addresses",
              },
              supabase,
            );
            throw error;
          }
          // Postgres orders 'billing' < 'delivery' < 'other' < 'primary'
          // alphabetically — but the UI wants primary first. Re-sort
          // client-side using the explicit ADDRESS_TYPE_ORDER. The DB
          // ordering is kept as a defensive secondary sort for stability.
          return sortAddressesForDisplay(
            (data ?? []) as CustomerAddress[],
          );
        }
      : skipToken,
  });
}

type CreateAddressInput = {
  customerId: string;
  values: CustomerAddressCreatePayload;
  /** When true, promote this address to default-for-type after insert. */
  setDefault?: boolean;
};

export function useCreateCustomerAddress(
  options?: UseMutationOptions<CustomerAddress, Error, CreateAddressInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerId,
      values,
      setDefault,
    }: CreateAddressInput) => {
      const supabase = createClient();

      // Insert with is_default_for_type = false; promote via RPC after to
      // sidestep the partial-unique race when another default of the same
      // address_type already exists. Mirrors Story 2.3's create flow.
      // Whitelist every column explicitly so a stale form (or future
      // regression) cannot smuggle id, created_*, updated_*, or
      // is_active=false through the create path (review fix).
      const insertPayload = {
        customer_id: customerId,
        address_type: values.address_type,
        recipient_name: values.recipient_name,
        street: values.street,
        street_number: values.street_number,
        zip: values.zip,
        city: values.city,
        country: values.country,
        floor: values.floor,
        has_elevator: values.has_elevator,
        access_notes: values.access_notes,
        lat: values.lat,
        lng: values.lng,
        geocoded_at: values.geocoded_at,
        is_active: true,
        is_default_for_type: false,
      };

      const { data, error } = await supabase
        .from("customer_addresses")
        .insert(insertPayload as never)
        .select("*")
        .single();

      if (error || !data) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-address",
            message: error?.message ?? "insert returned no row",
            details: {
              customer_id: customerId,
              address_type: values.address_type,
              operation: "create",
              code: error?.code ?? null,
              constraint:
                error?.code === "23505"
                  ? extractConstraintName(error)
                  : null,
            },
            entity: "customer_addresses",
          },
          supabase,
        );
        throw error ?? new Error("customer_addresses insert returned no row");
      }

      const inserted = data as CustomerAddress;

      if (setDefault) {
        const { error: rpcError } = await supabase.rpc(
          "set_default_customer_address",
          { p_address_id: inserted.id },
        );
        if (rpcError) {
          // Compensating soft-delete — the row was inserted as non-default;
          // the user requested default. Office RLS (00009:108-127) does NOT
          // grant DELETE — a hard `.delete()` here silently returns 0 rows
          // for office and leaves an orphan non-default row while we'd log
          // `rolled_back: true` (review fix). UPDATE is allowed for office,
          // and clearing both flags releases the partial-unique slot.
          const { data: rolled, error: rollbackError } = await supabase
            .from("customer_addresses")
            .update({ is_active: false, is_default_for_type: false } as never)
            .eq("id", inserted.id)
            .select("id");
          const wasRolledBack =
            !rollbackError &&
            Array.isArray(rolled) &&
            rolled.length > 0;
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-address",
              message: rpcError.message,
              details: {
                customer_id: customerId,
                address_id: inserted.id,
                address_type: values.address_type,
                operation: "set_default",
                code: rpcError.code ?? null,
                constraint:
                  rpcError.code === "23505"
                    ? extractConstraintName(rpcError)
                    : null,
                rolled_back: wasRolledBack,
                rollback_code: rollbackError?.code ?? null,
              },
              entity: "customer_addresses",
              entityId: inserted.id,
            },
            supabase,
          );
          throw rpcError;
        }
        return { ...inserted, is_default_for_type: true };
      }

      return inserted;
    },
    ...options,
    onSuccess: (address, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.addresses(variables.customerId),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      return options?.onSuccess?.(address, variables, ...rest);
    },
  });
}

type UpdateAddressInput = {
  customerId: string;
  addressId: string;
  values: CustomerAddressUpdate;
  /** Whether to promote the row to default-for-type via RPC after the patch. */
  setDefault?: boolean;
  /**
   * Optional set of dirty column names from the form's `formState.dirtyFields`.
   * When provided, only listed columns flow through the UPDATE — pristine
   * fields stay untouched, preventing phantom audit_log rows on no-op saves
   * (round-2 review; mirrors Story 2.1 round-3 dirtyFields-scoped patch).
   * When omitted, every mutable column from `values` is sent (legacy callers).
   */
  dirtyFields?: ReadonlySet<MutableAddressColumn>;
};

export function useUpdateCustomerAddress(
  options?: UseMutationOptions<CustomerAddress, Error, UpdateAddressInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerId,
      addressId,
      values,
      setDefault,
      dirtyFields,
    }: UpdateAddressInput) => {
      const supabase = createClient();

      // Build the patch via the typed allowlist (strips id, created_*,
      // updated_*, customer_id, address_type, is_active automatically).
      // Promote to default-for-type goes through the RPC below — we strip
      // is_default_for_type from the field-UPDATE; demote (false) is folded
      // in. When `dirtyFields` is provided, intersect with the allowlist so
      // pristine columns stay untouched (no phantom audit on no-op save).
      let cleanedPatch: CustomerAddressMutablePatch =
        buildAddressPatch(values);
      if (dirtyFields) {
        const filtered: CustomerAddressMutablePatch = {};
        for (const key of MUTABLE_ADDRESS_COLUMNS) {
          if (dirtyFields.has(key) && key in cleanedPatch) {
            (filtered as Record<string, unknown>)[key] = cleanedPatch[key];
          }
        }
        cleanedPatch = filtered;
      }
      if (setDefault === false) {
        cleanedPatch.is_default_for_type = false;
      }

      if (Object.keys(cleanedPatch).length > 0) {
        const { data: updated, error } = await supabase
          .from("customer_addresses")
          .update(cleanedPatch as never)
          .eq("id", addressId)
          .select("id");

        if (error) {
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-address",
              message: error.message,
              details: {
                customer_id: customerId,
                address_id: addressId,
                operation: "update",
                code: error.code ?? null,
                constraint:
                  error.code === "23514"
                    ? "customer_addresses_check"
                    : null,
              },
              entity: "customer_addresses",
              entityId: addressId,
            },
            supabase,
          );
          throw error;
        }

        if (!updated || updated.length === 0) {
          // 0-row update means RLS denied or the row no longer exists.
          // Story 2.2 review pattern.
          const message =
            "Aktualisierung nicht möglich. Datensatz wurde gelöscht oder ist nicht mehr zugänglich.";
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "warning",
              source: "customer-address",
              message,
              details: {
                customer_id: customerId,
                address_id: addressId,
                operation: "update",
                code: "PGRST_ZERO_ROWS",
              },
              entity: "customer_addresses",
              entityId: addressId,
            },
            supabase,
          );
          throw new Error(message);
        }
      }

      if (setDefault === true) {
        const { error: rpcError } = await supabase.rpc(
          "set_default_customer_address",
          { p_address_id: addressId },
        );
        if (rpcError) {
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "customer-address",
              message: rpcError.message,
              details: {
                customer_id: customerId,
                address_id: addressId,
                operation: "set_default",
                code: rpcError.code ?? null,
                constraint:
                  rpcError.code === "23505"
                    ? extractConstraintName(rpcError)
                    : null,
              },
              entity: "customer_addresses",
              entityId: addressId,
            },
            supabase,
          );
          throw rpcError;
        }
      }

      const { data: refreshed, error: refreshError } = await supabase
        .from("customer_addresses")
        .select("*")
        .eq("id", addressId)
        .single();
      if (refreshError || !refreshed) {
        throw refreshError ?? new Error("customer_addresses refresh failed");
      }
      return refreshed as CustomerAddress;
    },
    ...options,
    onSuccess: (address, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.addresses(variables.customerId),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      return options?.onSuccess?.(address, variables, ...rest);
    },
  });
}

type SoftDeleteAddressInput = {
  customerId: string;
  addressId: string;
  /** Restores the address (is_active = true) when true — used by Undo toast. */
  restore?: boolean;
};

export function useSoftDeleteCustomerAddress(
  options?: UseMutationOptions<void, Error, SoftDeleteAddressInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerId,
      addressId,
      restore,
    }: SoftDeleteAddressInput) => {
      const supabase = createClient();
      // Soft-delete: also clear is_default_for_type so the
      // (customer_id, address_type) partial-unique slot is released —
      // otherwise a soft-deleted default permanently blocks any future
      // default of the same type. Story 2.3 review trap, applied
      // preemptively.
      // Restore: leave is_default_for_type as-is (false after soft-delete) —
      // the user can re-toggle Hauptadresse explicitly if they want it.
      const patch = restore
        ? { is_active: true }
        : { is_active: false, is_default_for_type: false };
      // Filter on the OPPOSITE current state so already-deleted (or
      // already-restored) UPDATEs return zero rows and surface as a clear
      // "row not in expected state" failure instead of an idempotent-success
      // that masks a concurrency issue. Round-2 review fix.
      const { data: updated, error } = await supabase
        .from("customer_addresses")
        .update(patch as never)
        .eq("id", addressId)
        .eq("is_active", restore ? false : true)
        .select("id");

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-address",
            message: error.message,
            details: {
              customer_id: customerId,
              address_id: addressId,
              operation: restore ? "restore" : "soft_delete",
              code: error.code ?? null,
            },
            entity: "customer_addresses",
            entityId: addressId,
          },
          supabase,
        );
        throw error;
      }

      // RLS-deny silently returns success with zero rows — surface as failure.
      if (!updated || updated.length === 0) {
        const message = restore
          ? "Wiederherstellung nicht möglich. Datensatz wurde gelöscht oder ist nicht mehr zugänglich."
          : "Löschen nicht möglich. Datensatz wurde bereits gelöscht oder ist nicht mehr zugänglich.";
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "warning",
            source: "customer-address",
            message,
            details: {
              customer_id: customerId,
              address_id: addressId,
              operation: restore ? "restore" : "soft_delete",
              code: "PGRST_ZERO_ROWS",
            },
            entity: "customer_addresses",
            entityId: addressId,
          },
          supabase,
        );
        throw new Error(message);
      }
    },
    ...options,
    onSuccess: (data, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.addresses(variables.customerId),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables.customerId),
      });
      return options?.onSuccess?.(data, variables, ...rest);
    },
  });
}

// ---------------------------------------------------------------------------
// Story 2.6 — bexio Contact Synchronization mutation + read.
// ---------------------------------------------------------------------------

/**
 * Shape returned by the `bexio-contact-sync` Edge Function on the
 * single-customer path (POST body `{ customer_id }`).
 */
export type BexioSyncResult =
  | {
      ok: true;
      customer_id: string;
      bexio_contact_id: number;
      status: "synced";
      mode: "create" | "update" | "recovery";
    }
  | {
      ok: false;
      customer_id: string;
      code: string;
      message: string;
    };

/**
 * Triggers a single-customer bexio contact sync via the Edge Function.
 * Used by <BexioContactCard> for the "In bexio anlegen" / "Erneut
 * synchronisieren" / "Status prüfen" buttons (Story 2.6 AC11 / AC12).
 *
 * Toast UX:
 *   * On success → toast.success "Mit bexio synchronisiert".
 *   * On Edge Function returning `{ ok: false }` → toast.error with the
 *     German message from the function response.
 *   * On network/permission failure → throw so the caller's onError fires
 *     (consumed by the card to render the standard fallback toast).
 *
 * Invalidations: `customerKeys.detail(id)` (drives the card re-render via
 * useCustomer) AND `customerKeys.bexio(id)` (any sub-readers) AND
 * `["error_log","contact-sync", id]` so a fresh failed sync surfaces in the
 * <BexioContactCard> Failed-state error message.
 */
export function useSyncCustomerToBexio(
  options?: UseMutationOptions<BexioSyncResult, Error, string>,
) {
  const queryClient = useQueryClient();
  // Review round 1 M14 — explicit pick of safe overrides. The previous
  // `...options` spread allowed a caller to inject a `mutationFn` (or
  // override `onSuccess` AFTER the wrapper installed it) and silently
  // break the sync. Pull only the lifecycle hooks we want callers to
  // wire — never the function body.
  const onMutate = options?.onMutate;
  const onError = options?.onError;
  const onSettled = options?.onSettled;
  const userOnSuccess = options?.onSuccess;
  return useMutation<BexioSyncResult, Error, string>({
    mutationFn: async (customerId) => {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke(
        "bexio-contact-sync",
        { body: { customer_id: customerId } },
      );
      if (error) {
        // Network / 4xx / 5xx from the Edge Function itself (not a logical
        // bexio failure — those land in `data.ok === false`).
        await logError(
          {
            errorType: "EDGE_FUNCTION",
            severity: "error",
            source: "bexio-contact-sync",
            message: error.message,
            details: {
              customer_id: customerId,
              operation: "invoke",
              code: "edge_function_invoke_failed",
            },
            entity: "customers",
            entityId: customerId,
          },
          supabase,
        );
        throw error;
      }
      return data as BexioSyncResult;
    },
    onMutate,
    onError,
    onSettled,
    onSuccess: (data, variables, ...rest) => {
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(variables),
      });
      queryClient.invalidateQueries({
        queryKey: customerKeys.bexio(variables),
      });
      queryClient.invalidateQueries({
        queryKey: ["error_log", "contact-sync", variables] as const,
      });
      return userOnSuccess?.(data, variables, ...rest);
    },
  });
}

/**
 * Latest error_log row for `entity='customers' AND entity_id=customerId
 * AND source='contact-sync'`. Surfaced in the Failed state of
 * <BexioContactCard> (Story 2.6 AC11). Returns null when no failure on
 * record. RLS allows admin + office SELECT only.
 */
export type LatestContactSyncError = {
  id: string;
  message: string;
  severity: "critical" | "error" | "warning" | "info";
  created_at: string;
};

export function useLatestContactSyncError(customerId: string | null) {
  const enabled = customerId !== null && customerId.length > 0;
  return useQuery({
    queryKey: enabled
      ? (["error_log", "contact-sync", customerId] as const)
      : (["error_log", "contact-sync", "none"] as const),
    queryFn: enabled
      ? async (): Promise<LatestContactSyncError | null> => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("error_log")
            .select("id, message, severity, created_at")
            .eq("entity", "customers")
            .eq("entity_id", customerId)
            .eq("source", "contact-sync")
            .in("severity", ["error", "critical"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "warning",
                source: "bexio-contact-card",
                message: error.message,
                details: {
                  customer_id: customerId,
                  operation: "read_latest_error",
                  code: error.code ?? null,
                },
                entity: "customers",
                entityId: customerId,
              },
              supabase,
            );
            // Don't throw — the card has a graceful "no error message
            // available" fallback. Failed reads must not break the page.
            return null;
          }
          return (data as LatestContactSyncError | null) ?? null;
        }
      : skipToken,
    // 60s staleTime — error messages don't change frequently, and after
    // a manual sync the mutation invalidates this key explicitly.
    staleTime: 60_000,
  });
}
