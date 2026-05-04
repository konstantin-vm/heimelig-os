"use client";

// Device-domain query layer (Story 3.2). Mirrors the patterns established by
// `lib/queries/articles.ts` (Story 3.1):
//
//   - `deviceKeys` factory keeps every cache slot under one root.
//   - `useArticleDevices` / `useDevice` are server-side filtered + paged.
//   - `useDeviceCreate` / `useDeviceUpdate` strip `status` from the payload —
//     direct UPDATE on `devices.status` is forbidden by convention
//     (CLAUDE.md anti-pattern). Story 3.3 ships `transition_device_status`
//     as the SECURITY DEFINER RPC; the Zod `.superRefine` in
//     `lib/validations/device.ts` is the second tripwire.
//   - `useDeviceSoftDelete` writes `retired_at = current_date` (Europe/Zurich)
//     instead of hard-deleting the row.
//   - Realtime subscriptions invalidate the relevant cache slots on
//     postgres_changes events for `public.devices` (joined the publication
//     in migration 00047).

import { useEffect } from "react";
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { z } from "zod";

import { createClient } from "@/lib/supabase/client";
import {
  DEVICE_AUDIT_TRAIL_PAGE_SIZE,
  DEVICE_LIST_DEFAULT_SORT,
  DEVICE_LIST_PAGE_SIZE,
  DEVICE_SEARCH_MAX_LEN,
  type DeviceListSortColumn,
  type DeviceListSortDir,
} from "@/lib/constants/device";
import { getSessionRole } from "@/lib/supabase/session";
import { logError } from "@/lib/utils/error-log";
import { uuidSchema } from "@/lib/validations/common";
import {
  deviceConditionSchema,
  deviceStatusSchema,
  type BatchRegisterInput,
  type Device,
  type DeviceCreate,
  type DeviceUpdate,
} from "@/lib/validations/device";

// PostgREST cardinality detection occasionally embeds a many-to-one FK as a
// single-element array instead of an object. Normalise at the query boundary
// so downstream Zod schemas + consumers see a consistent object|null shape.
function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ---------------------------------------------------------------------------
// Filter shape — URL-driven via `<DeviceListFilters>` (mirrors `<ArticleListFilters>`).
// ---------------------------------------------------------------------------

export type DeviceListFilters = {
  search?: string;
  status?: ReadonlyArray<Device["status"]>;
  condition?: ReadonlyArray<Device["condition"]>;
  isNew?: boolean | null;
  /** When false (default), `retired_at IS NULL`; when true, retired devices included. */
  includeRetired?: boolean;
  sort?: DeviceListSortColumn;
  dir?: DeviceListSortDir;
  page?: number;
  pageSize?: number;
};

export const deviceKeys = {
  all: ["devices"] as const,
  byArticle: (articleId: string, filters?: DeviceListFilters) =>
    [...deviceKeys.all, "byArticle", articleId, filters ?? {}] as const,
  /** Parent prefix for invalidating every filter slice for an article. */
  byArticleAll: (articleId: string) =>
    [...deviceKeys.all, "byArticle", articleId] as const,
  lists: () => [...deviceKeys.all, "list"] as const,
  list: (filters: DeviceListFilters) =>
    [...deviceKeys.lists(), filters] as const,
  details: () => [...deviceKeys.all, "detail"] as const,
  detail: (id: string) => [...deviceKeys.details(), id] as const,
  audit: (id: string, limit: number, offset: number) =>
    [...deviceKeys.all, "audit", id, { limit, offset }] as const,
  /** Parent prefix for invalidating every audit-page slice for a device. */
  auditAll: (id: string) => [...deviceKeys.all, "audit", id] as const,
};

// ---------------------------------------------------------------------------
// Joined-row shapes + Zod runtime guards (Story 3.1 review LOW finding —
// avoid the `as Array<...>` double-cast that masks DB drift).
// ---------------------------------------------------------------------------

const deviceArticleJoinSchema = z
  .object({
    article_number: z.string(),
    name: z.string(),
    variant_label: z.string().nullable(),
  })
  .nullable();

const deviceWarehouseJoinSchema = z
  .object({
    code: z.string(),
    name: z.string(),
  })
  .nullable();

const deviceSupplierJoinSchema = z
  .object({
    name: z.string(),
  })
  .nullable();

const deviceCustomerJoinSchema = z
  .object({
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    company_name: z.string().nullable(),
  })
  .nullable();

export const deviceListRowSchema = z.object({
  id: uuidSchema,
  serial_number: z.string(),
  article_id: uuidSchema,
  qr_code: z.string().nullable(),
  status: deviceStatusSchema,
  condition: deviceConditionSchema,
  is_new: z.boolean(),
  current_warehouse_id: uuidSchema.nullable(),
  current_contract_id: uuidSchema.nullable(),
  reserved_for_customer_id: uuidSchema.nullable(),
  retired_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  articles: deviceArticleJoinSchema,
  warehouses: deviceWarehouseJoinSchema,
  customers: deviceCustomerJoinSchema,
});

export type DeviceListRow = z.infer<typeof deviceListRowSchema>;

export const deviceDetailRowSchema = z.object({
  id: uuidSchema,
  serial_number: z.string(),
  article_id: uuidSchema,
  qr_code: z.string().nullable(),
  status: deviceStatusSchema,
  condition: deviceConditionSchema,
  is_new: z.boolean(),
  current_warehouse_id: uuidSchema.nullable(),
  current_contract_id: uuidSchema.nullable(),
  supplier_id: uuidSchema.nullable(),
  inbound_date: z.string().nullable(),
  outbound_date: z.string().nullable(),
  acquired_at: z.string().nullable(),
  // PostgREST returns numeric as string; coerce in the consumer via Number().
  acquisition_price: z.union([z.string(), z.number()]).nullable(),
  reserved_for_customer_id: uuidSchema.nullable(),
  reserved_at: z.string().nullable(),
  retired_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
  articles: deviceArticleJoinSchema,
  warehouses: deviceWarehouseJoinSchema,
  suppliers: deviceSupplierJoinSchema,
  customers: deviceCustomerJoinSchema,
});

export type DeviceDetailRow = z.infer<typeof deviceDetailRowSchema>;

export type DeviceListResult = {
  rows: DeviceListRow[];
  total: number;
};

// ---------------------------------------------------------------------------
// Sorting helper.
// ---------------------------------------------------------------------------

function applyDeviceSort<
  Q extends {
    order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => Q;
  },
>(query: Q, sort: DeviceListSortColumn, dir: DeviceListSortDir): Q {
  const ascending = dir === "asc";
  switch (sort) {
    case "serial_number":
      return query
        .order("serial_number", { ascending })
        .order("id", { ascending });
    case "status":
      return query
        .order("status", { ascending })
        .order("serial_number", { ascending });
    case "condition":
      return query
        .order("condition", { ascending })
        .order("serial_number", { ascending });
    case "created_at":
      return query
        .order("created_at", { ascending })
        .order("id", { ascending });
    default:
      return query.order("serial_number", { ascending: true });
  }
}

// ---------------------------------------------------------------------------
// useArticleDevices — server-side filter / sort / pagination, scoped by article.
// ---------------------------------------------------------------------------

const DEVICE_LIST_SELECT = `
  id,
  serial_number,
  article_id,
  qr_code,
  status,
  condition,
  is_new,
  current_warehouse_id,
  current_contract_id,
  reserved_for_customer_id,
  retired_at,
  notes,
  created_at,
  updated_at,
  articles ( article_number, name, variant_label ),
  warehouses ( code, name ),
  customers!devices_reserved_for_customer_id_fkey (
    first_name, last_name, company_name
  )
`;

export function useArticleDevices(
  articleId: string | null,
  filters: DeviceListFilters = {},
) {
  const enabled = !!articleId && uuidSchema.safeParse(articleId).success;
  return useQuery({
    queryKey: enabled
      ? deviceKeys.byArticle(articleId!, filters)
      : [...deviceKeys.all, "byArticle-disabled"],
    placeholderData: keepPreviousData,
    queryFn: enabled
      ? async (): Promise<DeviceListResult> => {
          const supabase = createClient();
          const sort = filters.sort ?? DEVICE_LIST_DEFAULT_SORT.col;
          const dir = filters.dir ?? DEVICE_LIST_DEFAULT_SORT.dir;
          const pageSize = filters.pageSize ?? DEVICE_LIST_PAGE_SIZE;
          const page = filters.page && filters.page > 0 ? filters.page : 1;
          const from = (page - 1) * pageSize;
          const to = from + pageSize - 1;

          let query = supabase
            .from("devices")
            .select(DEVICE_LIST_SELECT, { count: "exact" })
            .eq("article_id", articleId!);

          if (filters.status && filters.status.length > 0) {
            query = query.in("status", filters.status as string[]);
          }
          if (filters.condition && filters.condition.length > 0) {
            query = query.in("condition", filters.condition as string[]);
          }
          if (filters.isNew !== undefined && filters.isNew !== null) {
            query = query.eq("is_new", filters.isNew);
          }
          if (!filters.includeRetired) {
            query = query.is("retired_at", null);
          }

          const search = filters.search?.trim() ?? "";
          if (search.length > 0) {
            // Same escape rules as Story 3.1's article search:
            //   * `%`, `_` — SQL LIKE wildcards
            //   * `,`, `(`, `)` — PostgREST `.or()` separators
            //   * `\` — escape character itself
            // Cap to 100 chars to avoid PostgREST 414 (URI Too Long).
            const trimmed = search.slice(0, DEVICE_SEARCH_MAX_LEN);
            const escaped = trimmed.replace(/[%_,()\\]/g, "\\$&");
            query = query.or(
              [
                `serial_number.ilike.%${escaped}%`,
                `qr_code.ilike.%${escaped}%`,
              ].join(","),
            );
          }

          query = applyDeviceSort(query, sort, dir);
          query = query.range(from, to);

          const { data, error, count } = await query;

          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "error",
                source: "device-list",
                message: "device list query failed",
                details: {
                  article_id: articleId,
                  operation: "list",
                  code: error.code ?? null,
                },
                entity: "devices",
              },
              supabase,
            );
            throw error;
          }

          // Normalise PostgREST embed shapes (array vs object) before parsing.
          const normalised = (data ?? []).map((row) => {
            const r = row as Record<string, unknown>;
            return {
              ...r,
              articles: unwrapEmbed(r.articles as unknown),
              warehouses: unwrapEmbed(r.warehouses as unknown),
              customers: unwrapEmbed(r.customers as unknown),
            };
          });

          // Runtime parse — surfaces DB drift (e.g. a renamed column on the
          // joined customers table) instead of silently casting through.
          const rowsParsed = z.array(deviceListRowSchema).safeParse(normalised);
          if (!rowsParsed.success) {
            await logError(
              {
                errorType: "VALIDATION",
                severity: "warning",
                source: "device-list",
                message: "device list shape drift",
                details: {
                  article_id: articleId,
                  operation: "list",
                  issueCount: rowsParsed.error.issues.length,
                },
                entity: "devices",
              },
              supabase,
            );
            // Soft-fail: cast through so the UI keeps rendering. The error_log
            // row is the trail to fix the drift.
            return {
              rows: normalised as unknown as DeviceListRow[],
              total: count ?? (normalised.length ?? 0),
            };
          }

          return {
            rows: rowsParsed.data,
            total: count ?? rowsParsed.data.length,
          };
        }
      : skipToken,
  });
}

// ---------------------------------------------------------------------------
// useDevice — single-row read by id with full joins.
// ---------------------------------------------------------------------------

const DEVICE_DETAIL_SELECT = `
  id,
  serial_number,
  article_id,
  qr_code,
  status,
  condition,
  is_new,
  current_warehouse_id,
  current_contract_id,
  supplier_id,
  inbound_date,
  outbound_date,
  acquired_at,
  acquisition_price,
  reserved_for_customer_id,
  reserved_at,
  retired_at,
  notes,
  created_at,
  updated_at,
  created_by,
  updated_by,
  articles ( article_number, name, variant_label ),
  warehouses ( code, name ),
  suppliers ( name ),
  customers!devices_reserved_for_customer_id_fkey (
    first_name, last_name, company_name
  )
`;

export function useDevice(id: string | null) {
  const enabled = !!id && uuidSchema.safeParse(id).success;
  return useQuery({
    queryKey: enabled
      ? deviceKeys.detail(id!)
      : [...deviceKeys.all, "detail-disabled"],
    queryFn: enabled
      ? async (): Promise<DeviceDetailRow | null> => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("devices")
            .select(DEVICE_DETAIL_SELECT)
            .eq("id", id!)
            .maybeSingle();

          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "error",
                source: "device-detail",
                message: "device detail read failed",
                details: {
                  device_id: id,
                  operation: "read",
                  code: error.code ?? null,
                },
                entity: "devices",
                entityId: id ?? undefined,
              },
              supabase,
            );
            throw error;
          }
          if (data == null) return null;

          const r = data as Record<string, unknown>;
          const normalised = {
            ...r,
            articles: unwrapEmbed(r.articles as unknown),
            warehouses: unwrapEmbed(r.warehouses as unknown),
            suppliers: unwrapEmbed(r.suppliers as unknown),
            customers: unwrapEmbed(r.customers as unknown),
          };

          const parsed = deviceDetailRowSchema.safeParse(normalised);
          if (!parsed.success) {
            await logError(
              {
                errorType: "VALIDATION",
                severity: "warning",
                source: "device-detail",
                message: "device detail shape drift",
                details: {
                  device_id: id,
                  operation: "read",
                  issueCount: parsed.error.issues.length,
                },
                entity: "devices",
                entityId: id ?? undefined,
              },
              supabase,
            );
            return normalised as unknown as DeviceDetailRow;
          }
          return parsed.data;
        }
      : skipToken,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function mapDeviceMutationError(code: string | null | undefined): string | null {
  switch (code) {
    case "23505":
      return "Diese Seriennummer ist bereits vergeben.";
    case "23503":
      return "Der gewählte Artikel / Standort / Lieferant existiert nicht.";
    case "42501":
      return "Sie haben keine Berechtigung für diese Aktion.";
    case "22023":
      // Story 3.6 — `batch_register_devices` raises this for invalid input
      // (quantity bounds, article/warehouse/supplier eligibility). The RPC's
      // German message carries the binding text; this is the fallback.
      return "Ungültige Eingabe für Sammelregistrierung.";
    case "P0001":
      // Generic PL/pgSQL `raise exception` without an explicit errcode.
      // Story 3.6 RPC uses specific codes (42501, 22023), but defensive
      // mapping here covers any future RPC that raises with the default.
      return "Sammelregistrierung abgelehnt — bitte Eingaben prüfen.";
    case "PGRST116":
      return "Aktualisierung betraf 0 Zeilen — möglicherweise fehlt die RLS-Berechtigung.";
    default:
      return null;
  }
}

export type CreateDeviceInput = {
  device: DeviceCreate;
};

export function useDeviceCreate(
  options?: UseMutationOptions<Device, Error, CreateDeviceInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ device }: CreateDeviceInput) => {
      const supabase = createClient();
      // Strip `status` — server default seeds 'available'. Story 3.3 ships
      // the transition path; until then a direct INSERT with status would
      // bypass that path and is rejected by the Zod refine in
      // `lib/validations/device.ts` for updates too.
      const { status: _stripStatus, ...payload } = device;
      void _stripStatus;
      const { data, error } = await supabase
        .from("devices")
        .insert(payload as unknown as Record<string, unknown>)
        .select("*")
        .single();

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "device-create",
            message: "device create failed",
            details: {
              article_id: device.article_id ?? null,
              operation: "create",
              code: error.code ?? null,
            },
            entity: "devices",
          },
          supabase,
        );
        const friendly = mapDeviceMutationError(error.code);
        if (friendly) throw new Error(friendly);
        throw error;
      }
      return data as Device;
    },
    ...options,
    onSuccess: (...args) => {
      const [, vars] = args;
      queryClient.invalidateQueries({ queryKey: deviceKeys.all });
      if (vars.device.article_id) {
        queryClient.invalidateQueries({
          queryKey: deviceKeys.byArticleAll(vars.device.article_id),
        });
      }
      return options?.onSuccess?.(...args);
    },
  });
}

export type UpdateDeviceInput = {
  id: string;
  patch: DeviceUpdate;
};

export function useDeviceUpdate(
  options?: UseMutationOptions<Device, Error, UpdateDeviceInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateDeviceInput) => {
      const supabase = createClient();
      // Defense-in-depth: `status` updates go through `transition_device_status`
      // (Story 3.3) — direct UPDATE is forbidden. Throw rather than silently
      // strip so a future caller passing a status field gets an immediate
      // error instead of a misleading "Gerät aktualisiert" toast on a no-op.
      if ("status" in (patch as Record<string, unknown>)) {
        throw new Error(
          "Status-Änderungen erfolgen über transition_device_status (Story 3.3) — bitte den Status nicht im Update-Patch übergeben.",
        );
      }
      const sanitized: Record<string, unknown> = {
        ...(patch as Record<string, unknown>),
      };
      const { data, error } = await supabase
        .from("devices")
        .update(sanitized)
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "device-edit",
            message: "device update failed",
            details: {
              device_id: id,
              operation: "update",
              code: error.code ?? null,
            },
            entity: "devices",
            entityId: id,
          },
          supabase,
        );
        const friendly = mapDeviceMutationError(error.code);
        if (friendly) throw new Error(friendly);
        throw error;
      }
      return data as Device;
    },
    ...options,
    onSuccess: (...args) => {
      const [data, vars] = args;
      queryClient.invalidateQueries({ queryKey: deviceKeys.detail(vars.id) });
      queryClient.invalidateQueries({ queryKey: deviceKeys.auditAll(vars.id) });
      queryClient.invalidateQueries({ queryKey: deviceKeys.all });
      if (data?.article_id) {
        queryClient.invalidateQueries({
          queryKey: deviceKeys.byArticleAll(data.article_id),
        });
      }
      return options?.onSuccess?.(...args);
    },
  });
}

/**
 * Soft-delete via `retired_at = current_date`. Admin-only:
 *   1. UI hides the trash icon for non-admin via `useAppRole()`.
 *   2. This mutation re-checks the role from JWT claims and refuses
 *      non-admin callers — defense-in-depth, since RLS on `devices` allows
 *      office + warehouse UPDATE on the entire row (no column-level scope
 *      on `retired_at` until Story 3.3 routes soft-delete through the
 *      `transition_device_status` SECURITY DEFINER RPC).
 *
 * `retired_at` is a date column — render today in Europe/Zurich so the
 * boundary doesn't flip at 23:00 CET (Story 3.1 review MEDIUM finding).
 */
export function useDeviceSoftDelete(
  options?: UseMutationOptions<{ id: string; article_id: string | null }, Error, { id: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const supabase = createClient();

      // Role guard: re-read JWT claims rather than trusting a (possibly stale)
      // useAppRole() result from a non-admin caller.
      const { data: claimsData } = await supabase.auth.getClaims();
      const role = getSessionRole(claimsData?.claims ?? null);
      if (role !== "admin") {
        throw new Error("Nur Administratoren dürfen Geräte ausmustern.");
      }

      const todayCET = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Zurich",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      const { data, error } = await supabase
        .from("devices")
        .update({ retired_at: todayCET })
        .eq("id", id)
        .select("id, article_id")
        .single();

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "device-soft-delete",
            message: "device soft-delete failed",
            details: {
              device_id: id,
              operation: "soft-delete",
              code: error.code ?? null,
            },
            entity: "devices",
            entityId: id,
          },
          supabase,
        );
        const friendly = mapDeviceMutationError(error.code);
        if (friendly) throw new Error(friendly);
        throw error;
      }
      if (!data) {
        throw new Error("Geräte-Ausmusterung lieferte keine Zeile zurück.");
      }
      return data as { id: string; article_id: string | null };
    },
    ...options,
    onSuccess: (...args) => {
      const [data, vars] = args;
      queryClient.invalidateQueries({ queryKey: deviceKeys.detail(vars.id) });
      queryClient.invalidateQueries({ queryKey: deviceKeys.auditAll(vars.id) });
      queryClient.invalidateQueries({ queryKey: deviceKeys.all });
      if (data?.article_id) {
        queryClient.invalidateQueries({
          queryKey: deviceKeys.byArticleAll(data.article_id),
        });
      }
      return options?.onSuccess?.(...args);
    },
  });
}

// ---------------------------------------------------------------------------
// Audit-trail reader (S-013 Verlauf card).
// ---------------------------------------------------------------------------

export type DeviceAuditEntry = {
  id: string;
  action: string;
  actor_user_id: string | null;
  actor_system: string | null;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  created_at: string;
  actor_label: string | null;
};

export type DeviceAuditTrailResult = {
  rows: DeviceAuditEntry[];
  total: number;
};

export function useDeviceAuditTrail(
  id: string | null,
  options?: { limit?: number; offset?: number },
) {
  const limit = options?.limit ?? DEVICE_AUDIT_TRAIL_PAGE_SIZE;
  const offset = options?.offset ?? 0;
  const enabled = !!id && uuidSchema.safeParse(id).success;
  return useQuery({
    queryKey: enabled
      ? deviceKeys.audit(id!, limit, offset)
      : [...deviceKeys.all, "audit-disabled"],
    queryFn: enabled
      ? async (): Promise<DeviceAuditTrailResult> => {
          const supabase = createClient();
          const from = offset;
          const to = offset + limit - 1;
          const { data, error, count } = await supabase
            .from("audit_log")
            .select(
              "id, action, actor_user_id, actor_system, before_values, after_values, created_at",
              { count: "exact" },
            )
            .eq("entity", "devices")
            .eq("entity_id", id!)
            .order("created_at", { ascending: false })
            .range(from, to);

          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "error",
                source: "device-audit-trail",
                message: "device audit trail read failed",
                details: {
                  device_id: id,
                  operation: "audit-list",
                  code: error.code ?? null,
                },
                entity: "audit_log",
                entityId: id ?? undefined,
              },
              supabase,
            );
            throw error;
          }
          const rows = (data ?? []) as Array<
            Omit<DeviceAuditEntry, "actor_label">
          >;
          // Resolve actor labels in a separate batch lookup. user_profiles
          // RLS allows authenticated to SELECT public columns (name).
          const actorIds = Array.from(
            new Set(
              rows
                .map((r) => r.actor_user_id)
                .filter((v): v is string => typeof v === "string"),
            ),
          );
          const labels = new Map<string, string>();
          if (actorIds.length > 0) {
            const { data: profiles, error: profileError } = await supabase
              .from("user_profiles")
              .select("id, first_name, last_name")
              .in("id", actorIds);
            if (!profileError) {
              for (const p of profiles ?? []) {
                const label = [p.first_name, p.last_name]
                  .filter(Boolean)
                  .join(" ")
                  .trim();
                // Only set a real label — leave the slot empty so the consumer
                // falls back to the truncated UUID display rather than rendering
                // the full UUID twice (review LOW finding).
                if (label) labels.set(p.id, label);
              }
            }
          }
          return {
            rows: rows.map((r) => ({
              ...r,
              actor_label: r.actor_user_id
                ? labels.get(r.actor_user_id) ?? null
                : r.actor_system,
            })),
            total: count ?? rows.length,
          };
        }
      : skipToken,
  });
}

// ---------------------------------------------------------------------------
// Realtime subscriptions — invalidate cache slots on postgres_changes.
// ---------------------------------------------------------------------------

/**
 * Subscribes to `public.devices` changes filtered by `article_id=eq.{id}` so
 * unrelated articles' edits don't churn the cache. Mirrors the article-table
 * pattern in `components/composed/article-table.tsx`.
 *
 * `instanceKey` MUST be a `useId()`-style stable per-mount string. Without it,
 * StrictMode double-mount + multi-tab subscribers collide on the same channel
 * name and the second `subscribe()` may race the first's `removeChannel()`.
 */
export function useArticleDevicesRealtime(
  articleId: string | null,
  instanceKey: string,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!articleId) return;
    if (!uuidSchema.safeParse(articleId).success) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`devices:byArticle:${articleId}:${instanceKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "devices",
          filter: `article_id=eq.${articleId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: deviceKeys.byArticleAll(articleId),
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [articleId, instanceKey, queryClient]);
}

export function useDeviceRealtime(id: string | null, instanceKey: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!id) return;
    if (!uuidSchema.safeParse(id).success) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`devices:detail:${id}:${instanceKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "devices",
          filter: `id=eq.${id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: deviceKeys.detail(id) });
          queryClient.invalidateQueries({ queryKey: deviceKeys.auditAll(id) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, instanceKey, queryClient]);
}

// ---------------------------------------------------------------------------
// Story 3.6 — Batch device registration mutation.
//
// Calls the SECURITY DEFINER RPC `public.batch_register_devices` (migration
// 00052, re-emitted by 00054 with review fixes). The function generates
// serial_numbers under a per-article advisory lock + atomic N-row INSERT,
// returning `{id, serial_number}[]` for the toast + downstream Story 3.7
// (label PDF) hook.
//
// Privilege: admin / office / warehouse — the RPC role-gates internally and
// raises 42501 otherwise. Warehouse callers' acquisition_price is silently
// stripped to NULL inside the function (defense-in-depth on top of the form
// hide). The mutation never reaches the table directly — `devices` RLS
// remains intact for non-batch flows.
// ---------------------------------------------------------------------------

export type BatchRegisterResult = Array<{
  id: string;
  serial_number: string;
}>;

export function useBatchRegisterDevices(
  options?: UseMutationOptions<BatchRegisterResult, Error, BatchRegisterInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BatchRegisterInput) => {
      const supabase = createClient();
      // RPC types come from `lib/supabase/types.ts` (auto-generated after
      // `pnpm db:types`). nullable fields → `undefined` over the wire so the
      // optional positional defaults of the PG function fire.
      const { data, error } = await supabase.rpc("batch_register_devices", {
        p_article_id: input.article_id,
        p_quantity: input.quantity,
        p_warehouse_id: input.current_warehouse_id ?? undefined,
        p_supplier_id: input.supplier_id ?? undefined,
        p_acquired_at: input.acquired_at ?? undefined,
        p_acquisition_price: input.acquisition_price ?? undefined,
        p_inbound_date: input.inbound_date ?? undefined,
        p_notes: input.notes ?? undefined,
      });

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "device-batch-register",
            message: "batch register failed",
            details: {
              article_id: input.article_id,
              quantity: input.quantity,
              operation: "batch-register",
              code: error.code ?? null,
            },
            entity: "devices",
          },
          supabase,
        );
        // Prefer the verbatim PG message when the RPC raised one of the
        // German user-facing strings authored in `batch_register_devices`
        // — those are more specific than the friendly map. For any other
        // error code (e.g. 23505 unique_violation, where PG emits an
        // English "duplicate key value" message that would surface ugly
        // schema details), fall through to the friendly German fallback.
        if (
          typeof error.message === "string" &&
          /^(Anzahl muss|Artikel ist nicht|Lager ist nicht|Lieferant ist nicht|Sammelregistrierung erfordert|Serial-Bereich für|p_article_id darf nicht NULL)/u.test(
            error.message,
          )
        ) {
          throw new Error(error.message);
        }
        const friendly = mapDeviceMutationError(error.code);
        if (friendly) throw new Error(friendly);
        throw error;
      }
      return (data ?? []) as BatchRegisterResult;
    },
    ...options,
    onSuccess: (...args) => {
      const [, vars] = args;
      queryClient.invalidateQueries({ queryKey: deviceKeys.all });
      queryClient.invalidateQueries({
        queryKey: deviceKeys.byArticleAll(vars.article_id),
      });
      return options?.onSuccess?.(...args);
    },
  });
}
