"use client";

import { useEffect, useId, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Box,
  Loader2,
  SearchX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import {
  ARTICLE_LIST_DEFAULT_SORT,
  ARTICLE_LIST_PAGE_SIZE,
  SORTABLE_ARTICLE_LIST_COLUMNS,
  articleCategoryLabels,
  articleVatRateLabels,
  type ArticleListSortColumn,
  type ArticleListSortDir,
} from "@/lib/constants/article";
import {
  articleCategoryValues,
  articleTypeValues,
} from "@/lib/validations/article";
import {
  articleKeys,
  useArticlesList,
  type ArticleListFilters,
  type ArticleListRow,
  type ArticleStatusFilter,
} from "@/lib/queries/articles";
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

import { PriceDisplay } from "./price-display";
import { RowActions } from "./row-actions";
import { StatusBadge } from "./status-badge";
import { TablePagination } from "./table-pagination";

const VALID_CATEGORIES: ReadonlySet<string> = new Set(articleCategoryValues);
const VALID_TYPES: ReadonlySet<string> = new Set(articleTypeValues);
const VALID_STATUS: ReadonlySet<string> = new Set(["active", "inactive"]);

type ReadonlyURLSearchParams = ReturnType<typeof useSearchParams>;

function parseFilters(
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
  searchTerm: string,
  pageSize: number,
): {
  filters: ArticleListFilters;
  page: number;
  sort: ArticleListSortColumn;
  dir: ArticleListSortDir;
} {
  const get = (key: string) => searchParams.get(key) ?? "";
  const sortRaw = get("sort");
  const sort: ArticleListSortColumn = SORTABLE_ARTICLE_LIST_COLUMNS.has(
    sortRaw as ArticleListSortColumn,
  )
    ? (sortRaw as ArticleListSortColumn)
    : ARTICLE_LIST_DEFAULT_SORT.col;
  const dirRaw = get("dir");
  const dir: ArticleListSortDir = dirRaw === "desc" ? "desc" : "asc";
  const pageRaw = parseInt(get("page") || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const categoryRaw = get("category");
  const typeRaw = get("type");
  const rentableRaw = get("rentable");
  const sellableRaw = get("sellable");
  const statusRaw = get("status");

  const filters: ArticleListFilters = {
    search: searchTerm.trim() || undefined,
    category: VALID_CATEGORIES.has(categoryRaw)
      ? (categoryRaw as ArticleListFilters["category"])
      : null,
    type: VALID_TYPES.has(typeRaw)
      ? (typeRaw as ArticleListFilters["type"])
      : null,
    isRentable: rentableRaw === "true" ? true : rentableRaw === "false" ? false : null,
    isSellable: sellableRaw === "true" ? true : sellableRaw === "false" ? false : null,
    // AC6 — default to "active" when no `status` URL param is present so
    // soft-deleted (is_active=false) articles stay hidden by default. Users
    // can pick "Inaktiv" or "Alle" via the filter UI; "Alle" sends an
    // explicit `?status=all` token which the parser converts to null
    // (disable the filter), while a missing/unknown param coerces to
    // "active" for the AC6 default-hidden invariant.
    status: VALID_STATUS.has(statusRaw)
      ? (statusRaw as ArticleStatusFilter)
      : statusRaw === "all"
        ? null
        : "active",
    sort,
    dir,
    page,
    pageSize,
  };
  return { filters, page, sort, dir };
}

export type ArticleTableProps = {
  searchTerm: string;
  onClearSearchTerm: () => void;
  onEdit: (articleId: string) => void;
};

export function ArticleTable({
  searchTerm,
  onClearSearchTerm,
  onEdit,
}: ArticleTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const channelSuffix = useId();

  const pageSize = usePageSizeParam(searchParams, ARTICLE_LIST_PAGE_SIZE);

  const { filters, page, sort, dir } = useMemo(
    () => parseFilters(searchParams, searchTerm, pageSize),
    [searchParams, searchTerm, pageSize],
  );

  const { data, isLoading, isError, refetch, isFetching } =
    useArticlesList(filters);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
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
  // articles-row mutation (insert/update/delete). Mirrors Story 2.5 customer
  // table; useId() suffix prevents strict-mode + HMR double-mount channel
  // collisions.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`articles:list:${channelSuffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "articles" },
        () => {
          queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
          queryClient.invalidateQueries({ queryKey: articleKeys.totalCount() });
        },
      )
      // The Privat-price column reads from current_price_for_article — also
      // invalidate on any price_lists change for any article.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "price_lists" },
        () => {
          queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, channelSuffix]);

  function pushSort(nextCol: ArticleListSortColumn) {
    if (!SORTABLE_ARTICLE_LIST_COLUMNS.has(nextCol)) return;
    const params = new URLSearchParams(searchParams.toString());
    let newSort: ArticleListSortColumn | "" = nextCol;
    let newDir: ArticleListSortDir = "asc";
    if (sort === nextCol) {
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
    for (const k of ["category", "type", "rentable", "sellable", "status", "page"]) {
      params.delete(k);
    }
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  const hasActiveFilters =
    Boolean(filters.search)
    || Boolean(filters.category)
    || Boolean(filters.type)
    || filters.isRentable !== null
    || filters.isSellable !== null
    || Boolean(filters.status);

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table
          className="w-full text-left text-sm"
          aria-label="Artikelliste"
          aria-busy={isFetching}
        >
          <thead className="bg-muted/50">
            <tr className="border-b border-border">
              <SortableHeader
                col="article_number"
                label="Artikelnr."
                width="w-[10%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <SortableHeader
                col="name"
                label="Name"
                width="w-[28%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <SortableHeader
                col="category"
                label="Kategorie"
                width="w-[12%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <th
                scope="col"
                className="w-[12%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Verwendung
              </th>
              <th
                scope="col"
                className="w-[8%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                MwSt
              </th>
              <th
                scope="col"
                className="w-[12%] px-3 py-3 text-right text-sm font-semibold text-muted-foreground tabular-nums"
              >
                Privat
              </th>
              <th
                scope="col"
                className="w-[8%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Status
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
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Artikel werden geladen…
                  </span>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-destructive">
                  Artikel konnten nicht geladen werden.{" "}
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
                <td colSpan={8} className="px-3 py-16 text-center">
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
                      <Box className="h-8 w-8" aria-hidden />
                      <span className="text-sm font-medium text-foreground">
                        Noch keine Artikel erfasst
                      </span>
                      <span className="text-sm">
                        Lege den ersten Artikel mit dem Button oben rechts an.
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const detailHref = `/articles/${row.id}`;
                return (
                  <tr
                    key={row.id}
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
                    <td className="px-3 py-3 tabular-nums">
                      <span className="text-sm font-medium text-foreground">
                        {row.article_number}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {row.name}
                        </span>
                        {row.variant_label ? (
                          <span className="text-[12px] text-muted-foreground">
                            {row.variant_label}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground">
                      {articleCategoryLabels[row.category]}
                    </td>
                    <td className="px-3 py-3 text-sm">
                      <UsageChips
                        isRentable={row.is_rentable}
                        isSellable={row.is_sellable}
                        type={row.type}
                      />
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground">
                      {articleVatRateLabels[
                        row.vat_rate as keyof typeof articleVatRateLabels
                      ] ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <PriceDisplay amount={row.current_private_price} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge
                        entity="article"
                        status={row.is_active ? "active" : "inactive"}
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RowActions
                        onEdit={() => onEdit(row.id)}
                        triggerAriaLabel={`Aktionen für Artikel ${row.article_number}`}
                        editLabel="Artikel bearbeiten"
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
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={pushPage}
        onPageSizeChange={buildPageSizeHandler(
          searchParams,
          router,
          ARTICLE_LIST_PAGE_SIZE,
        )}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        itemNoun="Artikeln"
      />
    </Card>
  );
}

type SortableHeaderProps = {
  col: ArticleListSortColumn;
  label: string;
  width: string;
  currentSort: ArticleListSortColumn;
  currentDir: ArticleListSortDir;
  onSort: (col: ArticleListSortColumn) => void;
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
  const Icon = !isActive ? ArrowUpDown : currentDir === "asc" ? ArrowUp : ArrowDown;
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
        className="inline-flex items-center gap-1 hover:text-foreground focus-visible:underline focus-visible:outline-hidden"
      >
        {label}
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </th>
  );
}

type UsageChipsProps = {
  isRentable: ArticleListRow["is_rentable"];
  isSellable: ArticleListRow["is_sellable"];
  type: ArticleListRow["type"];
};

function UsageChips({ isRentable, isSellable, type }: UsageChipsProps) {
  if (type === "service") {
    return (
      <span className="inline-flex items-center rounded-md bg-info-soft px-2 py-0.5 text-xs font-medium text-info-foreground">
        Service
      </span>
    );
  }
  if (!isRentable && !isSellable) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      {isRentable ? (
        <span className="inline-flex items-center rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
          Miete
        </span>
      ) : null}
      {isSellable ? (
        <span className="inline-flex items-center rounded-md bg-success-soft px-2 py-0.5 text-xs font-medium text-success-foreground">
          Verkauf
        </span>
      ) : null}
    </span>
  );
}
