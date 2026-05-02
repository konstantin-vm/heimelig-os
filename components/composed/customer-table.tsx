"use client";

import { useEffect, useId, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  SearchX,
  Users,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  customerKeys,
  useCustomersList,
  type CustomerInsurerFilter,
  type CustomerListFilters,
  type CustomerListRow,
  type CustomerStatusFilter,
  type CustomerTimeframeFilter,
} from "@/lib/queries/customers";
import {
  CUSTOMER_LIST_DEFAULT_SORT,
  CUSTOMER_LIST_PAGE_SIZE,
  SORTABLE_CUSTOMER_LIST_COLUMNS,
  type CustomerListSortColumn,
  type CustomerListSortDir,
} from "@/lib/constants/customer";
import { SWISS_CANTONS, type SwissCantonCode } from "@/lib/constants/swiss-cantons";
import { formatDate, formatPhone, formatPrimaryAddressLine } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

import { BexioSyncBadge } from "./bexio-sync-badge";
import {
  InsuranceBadge,
  type InsuranceBadgeInsurer,
} from "./insurance-badge";
import { RowActions } from "./row-actions";
import { TablePagination } from "./table-pagination";

export type CustomerTableProps = {
  /** Search term, owned by parent — never URL-synced (nDSG). */
  searchTerm: string;
  /** Reset the search term in the parent (called from the empty-state CTA). */
  onClearSearchTerm: () => void;
  /** Open the edit modal for the given customer. */
  onEdit: (customerId: string) => void;
};

const VALID_CANTON_CODES: ReadonlySet<string> = new Set(
  SWISS_CANTONS.map((c) => c.code),
);

const PARTNER_INSURER_CODES: ReadonlySet<string> = new Set([
  "helsana",
  "sanitas",
  "kpt",
  "visana",
]);

function customerName(row: CustomerListRow): string {
  if (row.customer_type === "institution") {
    return row.company_name ?? "—";
  }
  const parts = [row.last_name, row.first_name].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function rowInsurer(row: CustomerListRow): InsuranceBadgeInsurer {
  const p = row.primary_insurer;
  if (!p) return "none";
  if (p.partner_code && PARTNER_INSURER_CODES.has(p.partner_code)) {
    return p.partner_code as InsuranceBadgeInsurer;
  }
  // Has an insurance row but no recognised partner code → freetext = "Andere".
  if (p.freetext_name) return "other";
  return "none";
}

function parseFilters(
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
  searchTerm: string,
): {
  filters: CustomerListFilters;
  page: number;
  sort: CustomerListSortColumn;
  dir: CustomerListSortDir;
} {
  const get = (k: string) => searchParams.get(k) ?? "";

  const sortRaw = get("sort");
  const sort: CustomerListSortColumn = SORTABLE_CUSTOMER_LIST_COLUMNS.has(
    sortRaw as CustomerListSortColumn,
  )
    ? (sortRaw as CustomerListSortColumn)
    : CUSTOMER_LIST_DEFAULT_SORT.col;
  const dirRaw = get("dir");
  const dir: CustomerListSortDir = dirRaw === "desc" ? "desc" : "asc";
  const pageRaw = parseInt(get("page") || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const insurerRaw = get("insurer");
  const VALID_INSURERS: ReadonlySet<string> = new Set([
    "helsana",
    "sanitas",
    "kpt",
    "visana",
    "other",
    "none",
  ]);
  const timeframeRaw = get("timeframe");
  const VALID_TIMEFRAMES: ReadonlySet<string> = new Set([
    "30d",
    "6m",
    "1y",
    "older",
  ]);
  const statusRaw = get("status");
  const VALID_STATUSES: ReadonlySet<string> = new Set(["active", "inactive"]);
  const regionRaw = get("region");

  const filters: CustomerListFilters = {
    search: searchTerm.trim() || undefined,
    region: VALID_CANTON_CODES.has(regionRaw)
      ? (regionRaw as SwissCantonCode)
      : null,
    insurer: VALID_INSURERS.has(insurerRaw)
      ? (insurerRaw as CustomerInsurerFilter)
      : null,
    timeframe: VALID_TIMEFRAMES.has(timeframeRaw)
      ? (timeframeRaw as CustomerTimeframeFilter)
      : null,
    status: VALID_STATUSES.has(statusRaw)
      ? (statusRaw as CustomerStatusFilter)
      : null,
    sort,
    dir,
    page,
    pageSize: CUSTOMER_LIST_PAGE_SIZE,
  };
  return { filters, page, sort, dir };
}

type ReadonlyURLSearchParams = ReturnType<typeof useSearchParams>;

export function CustomerTable({
  searchTerm,
  onClearSearchTerm,
  onEdit,
}: CustomerTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const channelSuffix = useId();

  const { filters, page, sort, dir } = useMemo(
    () => parseFilters(searchParams, searchTerm),
    [searchParams, searchTerm],
  );

  const { data, isLoading, isError, refetch, isFetching } =
    useCustomersList(filters);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  // If the URL points to a page beyond the last one (filter narrowed the set
  // OR the user pasted a stale link), redirect to the last page so the user
  // doesn't get stuck on an empty page with a vanished pagination footer.
  const lastPage = Math.max(1, Math.ceil(total / CUSTOMER_LIST_PAGE_SIZE));
  useEffect(() => {
    if (!isLoading && total > 0 && page > lastPage) {
      const params = new URLSearchParams(searchParams.toString());
      if (lastPage > 1) params.set("page", String(lastPage));
      else params.delete("page");
      const queryStr = params.toString();
      router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
    }
  }, [isLoading, total, page, lastPage, searchParams, router]);

  // Realtime — invalidate the list cache + total-count cache on any
  // customers-row mutation (insert/update/delete). useId() suffix prevents
  // strict-mode + HMR double-mount channel collisions (Story 2.2 review).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`customers:list:${channelSuffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customers" },
        () => {
          queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
          queryClient.invalidateQueries({ queryKey: customerKeys.totalCount() });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, channelSuffix]);

  function pushSort(nextCol: CustomerListSortColumn) {
    if (!SORTABLE_CUSTOMER_LIST_COLUMNS.has(nextCol)) return;
    const params = new URLSearchParams(searchParams.toString());
    let newSort: CustomerListSortColumn | "" = nextCol;
    let newDir: CustomerListSortDir = "asc";
    if (sort === nextCol) {
      // Toggle: asc → desc → cleared (back to default).
      if (dir === "asc") newDir = "desc";
      else {
        newSort = "";
        newDir = "asc";
      }
    }
    if (newSort) {
      params.set("sort", newSort);
      params.set("dir", newDir);
    } else {
      params.delete("sort");
      params.delete("dir");
    }
    params.delete("page");
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  function pushPage(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage > 1) params.set("page", String(nextPage));
    else params.delete("page");
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  function clearFilters() {
    onClearSearchTerm();
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ["region", "insurer", "timeframe", "status", "page"]) {
      params.delete(k);
    }
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  const hasActiveFilters =
    Boolean(filters.search) ||
    Boolean(filters.region) ||
    Boolean(filters.insurer) ||
    Boolean(filters.timeframe) ||
    Boolean(filters.status);

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table
          className="w-full text-left text-sm"
          aria-label="Kundenliste"
          aria-busy={isFetching}
        >
          <thead className="bg-muted/50">
            <tr className="border-b border-border">
              <SortableHeader
                col="last_name"
                label="Kunde"
                width="w-[22%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <th
                scope="col"
                className="w-[26%] px-3 py-3 text-sm font-semibold text-muted-foreground"
                aria-sort="none"
              >
                Adresse
              </th>
              <SortableHeader
                col="phone"
                label="Telefon"
                width="w-[12%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <th
                scope="col"
                className="w-[10%] px-3 py-3 text-sm font-semibold text-muted-foreground"
                aria-sort="none"
              >
                Versicherung
              </th>
              <th
                scope="col"
                className="w-[6%] px-3 py-3 text-center text-sm font-semibold text-muted-foreground"
                aria-sort="none"
              >
                Geräte
              </th>
              <SortableHeader
                col="created_at"
                label="Kunde seit"
                width="w-[10%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <SortableHeader
                col="bexio_sync_status"
                label="Bexio"
                width="w-[10%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <th
                scope="col"
                className="w-[6%] px-3 py-3 text-right text-sm font-semibold text-muted-foreground"
              >
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Kunden werden geladen…
                  </span>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-12 text-center text-destructive"
                >
                  Kunden konnten nicht geladen werden.{" "}
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="underline underline-offset-2"
                  >
                    Erneut versuchen
                  </button>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-16 text-center"
                >
                  {hasActiveFilters ? (
                    <span className="inline-flex flex-col items-center gap-2 text-muted-foreground">
                      <SearchX className="h-8 w-8" aria-hidden />
                      <span className="text-sm font-medium text-foreground">
                        Keine Treffer
                      </span>
                      <span className="text-sm">
                        Passe deine Suche oder die Filter an.
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearFilters}
                      >
                        Filter zurücksetzen
                      </Button>
                    </span>
                  ) : (
                    <span className="inline-flex flex-col items-center gap-2 text-muted-foreground">
                      <Users className="h-8 w-8" aria-hidden />
                      <span className="text-sm font-medium text-foreground">
                        Noch keine Kunden erfasst
                      </span>
                      <span className="text-sm">
                        Lege den ersten Kunden mit dem Button oben rechts an.
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    "hover:bg-muted/30 focus-within:bg-muted/30",
                  )}
                >
                  <td className="px-3 py-3">
                    <Link
                      href={`/customers/${row.id}`}
                      className={cn(
                        "flex flex-col gap-0.5 -mx-3 -my-3 px-3 py-3",
                        "focus-visible:outline-hidden focus-visible:underline",
                      )}
                      aria-label={`${customerName(row)} öffnen`}
                    >
                      <span className="text-sm font-semibold text-foreground">
                        {customerName(row)}
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        {row.customer_number}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground">
                    <span className="line-clamp-2">
                      {formatPrimaryAddressLine(row.primary_address)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground tabular-nums">
                    {formatPhone(row.phone)}
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground">
                    <InsuranceBadge insurer={rowInsurer(row)} />
                  </td>
                  {/* TODO(Epic 5) — wire device count from rental_contracts.
                      Cell width stays in column reservation so Epic 5 wiring
                      is a single-line query change. */}
                  <td className="px-3 py-3 text-center text-sm text-muted-foreground">
                    —
                  </td>
                  <td className="px-3 py-3 text-sm text-muted-foreground tabular-nums">
                    {formatDate(row.created_at)}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <BexioSyncBadge status={row.bexio_sync_status} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <RowActions
                      onView={() => router.push(`/customers/${row.id}`)}
                      onEdit={() => onEdit(row.id)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={page}
        pageSize={CUSTOMER_LIST_PAGE_SIZE}
        total={total}
        onPageChange={pushPage}
      />
    </Card>
  );
}

type SortableHeaderProps = {
  col: CustomerListSortColumn;
  label: string;
  width: string;
  currentSort: CustomerListSortColumn;
  currentDir: CustomerListSortDir;
  onSort: (col: CustomerListSortColumn) => void;
};

function SortableHeader({
  col,
  label,
  width,
  currentSort,
  currentDir,
  onSort,
}: SortableHeaderProps) {
  const isActive = currentSort === col;
  const ariaSort: React.AriaAttributes["aria-sort"] = isActive
    ? currentDir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  const Icon = !isActive
    ? ArrowUpDown
    : currentDir === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-3 text-sm font-semibold text-muted-foreground",
        width,
      )}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-hidden focus-visible:underline"
      >
        {label}
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </th>
  );
}
