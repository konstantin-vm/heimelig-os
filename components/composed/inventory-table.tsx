"use client";

// <InventoryTable> — replaces the Story-3.4 card grid with a sortable
// list-table that mirrors the customer / article / device tables. Same
// data hooks (`useInventoryOverview`, `useInventoryRealtime`); the row
// click navigates to `/articles/[id]` and the dropdown surfaces the
// "Schwellwerte konfigurieren" action that used to live in each card.

import { useEffect, useId, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  PackageSearch,
  SearchX,
  Settings2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TablePagination } from "@/components/composed/table-pagination";
import { articleCategoryLabels } from "@/lib/constants/article";
import {
  INVENTORY_LIST_DEFAULT_SORT,
  INVENTORY_LIST_PAGE_SIZE,
  type InventoryListSortValue,
} from "@/lib/constants/inventory";
import { parseInventoryFiltersFromSearchParams } from "@/components/composed/inventory-filters";
import {
  useInventoryOverview,
  useInventoryRealtime,
  type InventoryListFilters,
} from "@/lib/queries/inventory";
import { articleCategoryValues } from "@/lib/validations/article";
import {
  navigateOnRowClick,
  navigateOnRowKey,
} from "@/lib/utils/row-navigation";
import {
  buildPageSizeHandler,
  PAGE_SIZE_OPTIONS,
  usePageSizeParam,
} from "@/lib/utils/url-page-size";
import { cn } from "@/lib/utils";

import { RowActions } from "./row-actions";
import { StatusBadge } from "./status-badge";

export type InventoryTableProps = {
  searchTerm: string;
  onClearSearchTerm: () => void;
  /** Forwards to the parent's threshold-edit modal. */
  onConfigureThresholds: (articleId: string) => void;
};

const CATEGORY_SET: ReadonlySet<string> = new Set(articleCategoryValues);
type ArticleCategory = (typeof articleCategoryValues)[number];

const VALID_SORTS: ReadonlySet<InventoryListSortValue> = new Set([
  "name",
  "available_asc",
  "utilization_desc",
]);

type ReadonlyURLSearchParams = ReturnType<typeof useSearchParams>;

function parseSort(
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
): InventoryListSortValue {
  const raw = searchParams.get("sort");
  if (raw && VALID_SORTS.has(raw as InventoryListSortValue)) {
    return raw as InventoryListSortValue;
  }
  return INVENTORY_LIST_DEFAULT_SORT;
}

export function InventoryTable({
  searchTerm,
  onClearSearchTerm,
  onConfigureThresholds,
}: InventoryTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const instanceKey = useId();

  const parsed = parseInventoryFiltersFromSearchParams(
    new URLSearchParams(searchParams.toString()),
  );

  const categories: ReadonlyArray<ArticleCategory> = parsed.categories.filter(
    (c): c is ArticleCategory => CATEGORY_SET.has(c),
  );

  const sort = useMemo(() => parseSort(searchParams), [searchParams]);
  const pageSize = usePageSizeParam(searchParams, INVENTORY_LIST_PAGE_SIZE);

  const filters: InventoryListFilters = {
    search: searchTerm,
    categories,
    warningsOnly: parsed.warningsOnly,
    bucket: parsed.bucket,
    sort,
    page: parsed.page,
    pageSize,
  };

  const { joined } = useInventoryRealtime(instanceKey);
  const refetchInterval = joined ? false : 30_000;

  const query = useInventoryOverview(filters, { refetchInterval });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (!query.isLoading && total > 0 && parsed.page > lastPage) {
      const params = new URLSearchParams(searchParams.toString());
      if (lastPage > 1) params.set("page", String(lastPage));
      else params.delete("page");
      const queryStr = params.toString();
      router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
    }
  }, [query.isLoading, total, parsed.page, lastPage, searchParams, router]);

  function pushSort(next: InventoryListSortValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (sort === next) {
      params.delete("sort");
    } else {
      params.set("sort", next);
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
    for (const k of ["category", "warningsOnly", "bucket", "sort", "page"]) {
      params.delete(k);
    }
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  const hasActiveFilters =
    Boolean(searchTerm) ||
    categories.length > 0 ||
    parsed.warningsOnly ||
    parsed.bucket !== null;

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table
          className="w-full text-left text-sm"
          aria-label="Inventarliste"
          aria-busy={query.isFetching}
        >
          <thead className="bg-muted/50">
            <tr className="border-b border-border">
              <th
                scope="col"
                className="w-[10%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Artikelnr.
              </th>
              <SortableHeader
                sortKey="name"
                label="Name"
                width="w-[26%]"
                currentSort={sort}
                onSort={pushSort}
              />
              <th
                scope="col"
                className="w-[12%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Kategorie
              </th>
              <th
                scope="col"
                className="w-[14%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Verfügbarkeit
              </th>
              <SortableHeader
                sortKey="available_asc"
                label="Verfügbar"
                width="w-[8%]"
                currentSort={sort}
                onSort={pushSort}
                align="right"
              />
              <SortableHeader
                sortKey="utilization_desc"
                label="Vermietet"
                width="w-[8%]"
                currentSort={sort}
                onSort={pushSort}
                align="right"
              />
              <th
                scope="col"
                className="w-[10%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Schwellwerte
              </th>
              <th
                scope="col"
                className="w-[6%] px-3 py-3 text-right text-sm font-semibold text-muted-foreground"
              >
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Inventar wird geladen…
                  </span>
                </td>
              </tr>
            ) : query.isError ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center">
                  <span className="inline-flex flex-col items-center gap-2 text-destructive">
                    <AlertCircle className="h-6 w-6" aria-hidden />
                    <span className="text-sm font-medium">
                      Inventar konnte nicht geladen werden
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => query.refetch()}
                    >
                      Erneut versuchen
                    </Button>
                  </span>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-16 text-center">
                  {hasActiveFilters ? (
                    <span className="inline-flex flex-col items-center gap-2 text-muted-foreground">
                      <SearchX className="h-8 w-8" aria-hidden />
                      <span className="text-sm font-medium text-foreground">
                        Keine Treffer
                      </span>
                      <span className="text-sm">
                        Aktive Filter passen auf keinen vermietbaren Artikel.
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
                      <PackageSearch className="h-8 w-8" aria-hidden />
                      <span className="text-sm font-medium text-foreground">
                        Noch keine vermietbaren Artikel
                      </span>
                      <span className="text-sm">
                        Lege zuerst einen Artikel im Katalog an — danach erscheint
                        er hier mit seiner aktuellen Verfügbarkeit.
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const detailHref = `/articles/${row.article_id}`;
                const subtitle = [
                  row.variant_label && `Variante: ${row.variant_label}`,
                  row.manufacturer,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const thresholdsConfigured =
                  row.min_stock !== null || row.critical_stock !== null;
                return (
                  <tr
                    key={row.article_id}
                    role="link"
                    tabIndex={0}
                    aria-label={`Artikel ${row.article_number} öffnen`}
                    onClick={(e) => navigateOnRowClick(e, router, detailHref)}
                    onKeyDown={(e) => navigateOnRowKey(e, router, detailHref)}
                    className={cn(
                      "border-b border-border last:border-b-0 cursor-pointer",
                      "hover:bg-muted/30 focus-within:bg-muted/30",
                      "focus-visible:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    )}
                  >
                    <td className="px-3 py-3 tabular-nums text-sm font-medium text-foreground">
                      {row.article_number}
                    </td>
                    <td className="px-3 py-3 text-sm">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {row.name}
                        </span>
                        {subtitle ? (
                          <span className="truncate text-[12px] text-muted-foreground">
                            {subtitle}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground">
                      {articleCategoryLabels[row.category]}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge
                          entity="availability"
                          status={row.availability_bucket}
                        />
                        {row.stock_warning !== "none" ? (
                          <StatusBadge
                            entity="stock-warning"
                            status={row.stock_warning}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums text-foreground">
                      {row.available_devices}
                      <span className="text-muted-foreground"> / {row.total_devices}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums text-foreground">
                      {row.rented_devices}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {thresholdsConfigured ? (
                        <span>
                          Min {row.min_stock ?? "–"} · Krit. {row.critical_stock ?? "–"}
                        </span>
                      ) : (
                        <span className="italic">Nicht definiert</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RowActions
                        triggerAriaLabel={`Aktionen für ${row.name}`}
                        items={[
                          {
                            label: "Schwellwerte konfigurieren",
                            icon: <Settings2 className="h-4 w-4" aria-hidden />,
                            onSelect: () => onConfigureThresholds(row.article_id),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={parsed.page}
        pageSize={pageSize}
        total={total}
        onPageChange={pushPage}
        onPageSizeChange={buildPageSizeHandler(
          searchParams,
          router,
          INVENTORY_LIST_PAGE_SIZE,
        )}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        itemNoun="Artikel"
      />
    </Card>
  );
}

type SortableHeaderProps = {
  sortKey: InventoryListSortValue;
  label: string;
  width: string;
  currentSort: InventoryListSortValue;
  onSort: (next: InventoryListSortValue) => void;
  align?: "left" | "right";
};

// The inventory query layer exposes only three named sort modes ("name",
// "available_asc", "utilization_desc"). We map each to one header so the
// click target reads as a column-level sort while still respecting the
// view's available `ORDER BY` columns. Toggling the active header clears
// the sort back to the default ("name").
function SortableHeader({
  sortKey,
  label,
  width,
  currentSort,
  onSort,
  align = "left",
}: SortableHeaderProps) {
  const isActive = currentSort === sortKey;
  const dirHint =
    sortKey === "utilization_desc" ? "desc" : "asc";
  const ariaSort: React.AriaAttributes["aria-sort"] = isActive
    ? dirHint === "asc"
      ? "ascending"
      : "descending"
    : "none";
  const Icon = !isActive
    ? ArrowUpDown
    : dirHint === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-3 text-sm font-semibold text-muted-foreground",
        align === "right" && "text-right",
        width,
      )}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground focus-visible:underline focus-visible:outline-hidden",
          align === "right" && "ml-auto",
        )}
      >
        {label}
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </th>
  );
}
