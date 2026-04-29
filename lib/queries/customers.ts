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
  CustomerCreate,
} from "@/lib/validations/customer";

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
