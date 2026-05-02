import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
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

export type CustomerListFilters = {
  search?: string;
  region?: string | null;
  insurer?: string | null;
  timeframe?: "30d" | "6m" | "1y" | "older" | null;
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
};

export const partnerInsurerKeys = {
  all: ["partner_insurers"] as const,
  activeList: () => [...partnerInsurerKeys.all, "active"] as const,
};

// ---------------------------------------------------------------------------
// Row shape returned by useCustomersList — joins primary address.
// ---------------------------------------------------------------------------

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
    "id" | "street" | "street_number" | "zip" | "city"
  > | null;
};

export type CustomerDetail = Customer & {
  primary_address: CustomerAddress | null;
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * D2 (Round 3) — interim cap until Story 2.5 ships pagination. The list page
 * surfaces a "Liste gekürzt — N von M" warning when the result length hits
 * this cap, so office users aren't blind-sided after the Blue-Office import
 * pushes the active-customer count past the limit.
 */
export const CUSTOMER_LIST_LIMIT = 200;

export function useCustomersList(filters: CustomerListFilters = {}) {
  return useQuery({
    queryKey: customerKeys.list(filters),
    queryFn: async (): Promise<CustomerListRow[]> => {
      const supabase = createClient();
      // P11 — outer (LEFT) join on customer_addresses; legacy customers
      // imported without a primary address row must still appear in the list
      // (otherwise they look "deleted" to office users).
      const { data, error } = await supabase
        .from("customers")
        .select(
          `
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
            street,
            street_number,
            zip,
            city
          )
          `,
        )
        .eq("is_active", true)
        .order("last_name", { ascending: true, nullsFirst: false })
        .order("company_name", { ascending: true, nullsFirst: false })
        .limit(CUSTOMER_LIST_LIMIT);

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-list",
            message: error.message,
            details: { code: error.code ?? null, operation: "list" },
          },
          supabase,
        );
        throw error;
      }

      return (data ?? []).map((row) => {
        const { customer_addresses, ...customer } = row; // P30
        const addressRows = Array.isArray(customer_addresses)
          ? customer_addresses
          : customer_addresses
            ? [customer_addresses]
            : [];
        const primary = addressRows.find(
          (a) => a.address_type === "primary" && a.is_default_for_type,
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
              }
            : null,
        } as CustomerListRow;
      });
    },
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
// Falls back to `unknown_unique` so 23505 from a non-target constraint (PK,
// FK, etc.) is not mis-attributed to the partial-unique index (review fix).
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
  return "unknown_unique";
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
  return useQuery({
    queryKey: enabled
      ? customerKeys.addresses(customerId)
      : ["customers", "addresses", "__disabled__"],
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
    }: UpdateAddressInput) => {
      const supabase = createClient();

      // Strip is_default_for_type from the patch — promote needs the RPC to
      // sidestep idx_customer_addresses_default_per_type_unique. Demote
      // (false) is safe to fold back into the single UPDATE below.
      // Also strip every non-mutable column so a stale form (or future
      // regression) cannot smuggle is_active=false through the update path
      // and bypass the dedicated soft-delete hook + its
      // is_default_for_type=false cleanup (review fix).
      const cleanedPatch: Record<string, unknown> = { ...values };
      delete cleanedPatch.is_default_for_type;
      delete cleanedPatch.customer_id;
      delete cleanedPatch.address_type; // address_type is read-only post-create
      delete cleanedPatch.is_active; // soft-delete owns this column
      delete cleanedPatch.id;
      delete cleanedPatch.created_at;
      delete cleanedPatch.created_by;
      delete cleanedPatch.updated_at;
      delete cleanedPatch.updated_by;
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
      const { data: updated, error } = await supabase
        .from("customer_addresses")
        .update(patch as never)
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
