"use client";

// Inventory-domain query layer (Story 3.4). Reads only; threshold edits
// route through the existing `<ArticleEditForm>` (Story 3.1) which writes
// `articles.min_stock` / `articles.critical_stock` directly.
//
// Data source: `public.inventory_overview` (migration 00053) — one row
// per `articles.is_rentable = true`. The view derives
// `availability_bucket` (`green | yellow | red`) and `stock_warning`
// (`none | low | critical`) inline so consumers don't re-implement the
// threshold logic.
//
// Realtime: `useInventoryRealtime()` subscribes to BOTH `public.articles`
// AND `public.devices` postgres_changes — both base tables are already in
// the `supabase_realtime` publication per migrations 00043 + 00047. The
// view itself cannot be added to the publication (Postgres rejects
// `ALTER PUBLICATION ... ADD TABLE` on a view with 0A000
// `feature_not_supported`); the dual-table subscription is the canonical
// path per AC-RT. On any event, invalidates `inventoryKeys.all`. Fallback:
// if the channel does not transition to `joined` within 5s, falls back to
// a 30s `refetchInterval` on the consumer query.
//
// Patterns mirrored from `lib/queries/articles.ts` (Story 3.1) and
// `lib/queries/devices.ts` (Story 3.2): key factory, server-paginated
// list with `keepPreviousData`, Zod runtime guard at the response
// boundary, `logError` boundary on every mutation/read, search-escape
// regex matching the cross-domain pattern (escapes `%`, `_`, `,`, `(`,
// `)`, `\`, `*`, `:` — the latter two added in Story 3.4 closing
// Story-3.2 review deferred-work line 249).

import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";

import {
  INVENTORY_LIST_DEFAULT_SORT,
  INVENTORY_LIST_PAGE_SIZE,
  INVENTORY_SEARCH_MAX_LEN,
  type InventoryListSortValue,
} from "@/lib/constants/inventory";
import { createClient } from "@/lib/supabase/client";
import { logError } from "@/lib/utils/error-log";
import {
  inventoryRowSchema,
  type AvailabilityBucket,
  type InventoryRow,
} from "@/lib/validations/inventory";
import { articleCategoryValues } from "@/lib/validations/article";

// ---------------------------------------------------------------------------
// Filter shape — URL-driven via `<InventoryFilters>`.
// ---------------------------------------------------------------------------

type ArticleCategory = (typeof articleCategoryValues)[number];

export type InventoryListFilters = {
  search?: string;
  categories?: ReadonlyArray<ArticleCategory>;
  /** Restrict to rows where `stock_warning IN ('low','critical')`. */
  warningsOnly?: boolean;
  /** Pin to a single bucket (`green | yellow | red`). */
  bucket?: AvailabilityBucket | null;
  /** Default true — soft-deleted articles drop out of the inventory grid. */
  activeOnly?: boolean;
  sort?: InventoryListSortValue;
  page?: number;
  pageSize?: number;
};

// ---------------------------------------------------------------------------
// Key factory — every cache slot under one root.
// ---------------------------------------------------------------------------
// No `details(id)` slot — clicking a card navigates to /articles/[id]
// which uses `articleKeys.detail(id)` from `lib/queries/articles.ts`.

export const inventoryKeys = {
  all: ["inventory"] as const,
  totalCount: () => [...inventoryKeys.all, "total-count"] as const,
  lists: () => [...inventoryKeys.all, "list"] as const,
  list: (filters: InventoryListFilters) =>
    [...inventoryKeys.lists(), filters] as const,
};

// ---------------------------------------------------------------------------
// Internal: SELECT column list. Keep in sync with
// `lib/queries/__smoke__/inventory-overview.ts` and `inventoryRowSchema`.
// ---------------------------------------------------------------------------

const INVENTORY_OVERVIEW_COLUMNS =
  "article_id, article_number, name, category, variant_label, manufacturer, " +
  "min_stock, critical_stock, is_active, total_devices, available_devices, " +
  "rented_devices, cleaning_devices, repair_devices, sold_devices, " +
  "retired_devices, availability_bucket, stock_warning";

// Free-text search escape — see `lib/queries/articles.ts` line 181 +
// `lib/queries/devices.ts` line 290 (deferred-work line 249 — `*` and `:`
// added 2026-05-04 in this story across all three call-sites).
function escapeInventorySearch(raw: string): string {
  const trimmed = raw.slice(0, INVENTORY_SEARCH_MAX_LEN);
  return trimmed.replace(/[%_,()\\*:]/g, "\\$&");
}

// Map common Postgres error codes to German user copy.
function mapInventoryQueryError(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "42501":
      return "Sie haben keine Berechtigung, das Inventar einzusehen.";
    case "PGRST301":
    case "PGRST116":
      return "Inventardaten konnten nicht geladen werden — bitte später erneut versuchen.";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// useInventoryOverview — server-paged + filtered list.
// ---------------------------------------------------------------------------

export type InventoryListResult = {
  rows: InventoryRow[];
  total: number;
};

export function useInventoryOverview(
  filters: InventoryListFilters = {},
  opts?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: inventoryKeys.list(filters),
    placeholderData: keepPreviousData,
    refetchInterval: opts?.refetchInterval ?? false,
    queryFn: async (): Promise<InventoryListResult> => {
      const supabase = createClient();
      const sort = filters.sort ?? INVENTORY_LIST_DEFAULT_SORT;
      const pageSize = filters.pageSize ?? INVENTORY_LIST_PAGE_SIZE;
      const page = filters.page && filters.page > 0 ? filters.page : 1;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from("inventory_overview")
        .select(INVENTORY_OVERVIEW_COLUMNS, { count: "exact" });

      const activeOnly = filters.activeOnly ?? true;
      if (activeOnly) {
        query = query.eq("is_active", true);
      }
      if (filters.categories && filters.categories.length > 0) {
        query = query.in("category", filters.categories as string[]);
      }
      if (filters.warningsOnly) {
        query = query.in("stock_warning", ["low", "critical"]);
      }
      if (filters.bucket) {
        query = query.eq("availability_bucket", filters.bucket);
      }
      const search = filters.search?.trim() ?? "";
      if (search.length > 0) {
        const escaped = escapeInventorySearch(search);
        query = query.or(
          [
            `name.ilike.%${escaped}%`,
            `article_number.ilike.%${escaped}%`,
            `manufacturer.ilike.%${escaped}%`,
          ].join(","),
        );
      }

      // Sort. The view does not currently expose a `utilization_pct`
      // column; `utilization_desc` proxies via `rented_devices` (highest
      // first). Tightening to a true rented/total ratio is a Sprint-2
      // follow-up — extend the view, do not compute client-side (would
      // break server-side sort + pagination contract).
      switch (sort) {
        case "available_asc":
          query = query
            .order("available_devices", { ascending: true })
            .order("name", { ascending: true });
          break;
        case "utilization_desc":
          query = query
            .order("rented_devices", { ascending: false })
            .order("name", { ascending: true });
          break;
        case "name":
        default:
          query = query
            .order("name", { ascending: true })
            .order("article_number", { ascending: true });
          break;
      }
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "inventory-list",
            message: "inventory_overview list query failed",
            details: {
              code: error.code ?? null,
              operation: "list",
              filterCount:
                (filters.categories?.length ?? 0) +
                (filters.bucket ? 1 : 0) +
                (filters.warningsOnly ? 1 : 0) +
                (search.length > 0 ? 1 : 0),
            },
            entity: "inventory_overview",
          },
          supabase,
        );
        const friendly = mapInventoryQueryError(error.code);
        if (friendly) throw new Error(friendly);
        throw error;
      }

      const rowsParsed = z
        .array(inventoryRowSchema)
        .safeParse(data ?? []);
      if (!rowsParsed.success) {
        await logError(
          {
            errorType: "VALIDATION",
            severity: "warning",
            source: "inventory-list",
            message: "inventory_overview shape drift",
            details: {
              issueCount: rowsParsed.error.issues.length,
              operation: "list",
            },
            entity: "inventory_overview",
          },
          supabase,
        );
        // Soft-fail: cast through so the UI keeps rendering. The
        // error_log row is the trail to fix the drift.
        return {
          rows: (data ?? []) as unknown as InventoryRow[],
          total: count ?? (data?.length ?? 0),
        };
      }

      return {
        rows: rowsParsed.data,
        total: count ?? rowsParsed.data.length,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// useInventoryTotalCount — page-header badge (rentable + active count).
// ---------------------------------------------------------------------------

export function useInventoryTotalCount() {
  return useQuery({
    queryKey: inventoryKeys.totalCount(),
    queryFn: async (): Promise<number> => {
      const supabase = createClient();
      const { count, error } = await supabase
        .from("inventory_overview")
        .select("article_id", { count: "exact", head: true })
        .eq("is_active", true);

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "inventory-total-count",
            message: "inventory_overview total-count query failed",
            details: {
              code: error.code ?? null,
              operation: "total-count",
            },
            entity: "inventory_overview",
          },
          supabase,
        );
        throw error;
      }
      return count ?? 0;
    },
    staleTime: 1000 * 60 * 5,
  });
}

// ---------------------------------------------------------------------------
// useInventoryRealtime — dual-table subscription with timeout fallback.
// ---------------------------------------------------------------------------
//
// Subscribes to BOTH `public.articles` AND `public.devices` postgres_changes
// events (defense-in-depth — both already in the publication per migrations
// 00043 + 00047 — so a silent publication-on-view regression on a future
// Supabase upgrade does not break invalidation). On either event,
// invalidates `inventoryKeys.all`. Returns the channel-joined state so
// the consumer can pivot to a polling fallback when the WebSocket fails
// to connect within 5s (AC-RT — pairs with `useInventoryOverview(filters,
// { refetchInterval: 30_000 })` on the page when `joined === false`).
//
// `instanceKey` MUST be a `useId()`-style stable per-mount string. Story
// 3.2 review carryover: without it, StrictMode double-mount + multi-tab
// subscribers collide on the same channel name and the second
// `subscribe()` may race the first's `removeChannel()`.

export function useInventoryRealtime(instanceKey: string): {
  joined: boolean;
} {
  const queryClient = useQueryClient();
  // Optimistic initial state — assume the channel will join. The 5s
  // timeout below flips this to `false` only if `SUBSCRIBED` has not
  // fired by then, which is when the consumer engages its 30s polling
  // fallback. Tracking actual subscribe success in a ref (separate
  // from the React state) lets the timeout decide deterministically
  // even when StrictMode double-mounts the effect.
  const [joined, setJoined] = useState(true);
  const subscribedRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    subscribedRef.current = false;
    // Story 3.5 — 100ms trailing-edge throttle around the invalidate call.
    // A warehouse worker rebooking 5–10 devices in 30 seconds via the new
    // `/scan` flow now feeds this hook; without throttling, every transition
    // kicks two postgres_changes events (DELETE + INSERT on the device row's
    // status update path, plus any tab keeping its own postgres-changes
    // subscription) and each one triggers a full inventory refetch. The
    // trailing-edge timer collapses bursts; a single isolated event still
    // resolves within 100ms of the writer's commit. Resolves
    // `_bmad-output/implementation-artifacts/deferred-work.md` line 8.
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (invalidateTimer != null) clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(() => {
        invalidateTimer = null;
        queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      }, 100);
    };

    const channel = supabase
      .channel(`inventory:overview:${instanceKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "articles" },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices" },
        invalidate,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          subscribedRef.current = true;
          setJoined(true);
        } else if (
          // Once-subscribed channel that dies (mobile carrier handoff,
          // server restart, idle WS disconnect) emits one of these.
          // Without flipping `joined` back to false, the polling fallback
          // never re-engages and the grid silently goes stale.
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          subscribedRef.current = false;
          setJoined(false);
        }
      });

    // 5-second `SUBSCRIBED`-deadline fallback. If the channel has not
    // produced a SUBSCRIBED status by then, flip the consumer-visible
    // state so the page wires its `refetchInterval` polling fallback.
    const timeout = setTimeout(() => {
      if (!subscribedRef.current) {
        setJoined(false);
      }
    }, 5_000);

    return () => {
      clearTimeout(timeout);
      if (invalidateTimer != null) clearTimeout(invalidateTimer);
      void supabase.removeChannel(channel);
    };
  }, [instanceKey, queryClient]);

  return { joined };
}
