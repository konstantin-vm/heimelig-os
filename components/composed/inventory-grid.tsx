"use client";

// <InventoryGrid> — Story 3.4. Wraps `<InventoryCard>` in a CSS Grid;
// renders skeleton / empty / error states; subscribes to
// `useInventoryRealtime()` once at the top level for the page.

import { useId } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TablePagination } from "@/components/composed/table-pagination";
import {
  InventoryCard,
  type InventoryCardProps,
} from "@/components/composed/inventory-card";
import { parseInventoryFiltersFromSearchParams } from "@/components/composed/inventory-filters";
import { INVENTORY_LIST_PAGE_SIZE } from "@/lib/constants/inventory";
import {
  useInventoryOverview,
  useInventoryRealtime,
} from "@/lib/queries/inventory";
import { articleCategoryValues } from "@/lib/validations/article";
import { cn } from "@/lib/utils";

const CATEGORY_SET: ReadonlySet<string> = new Set(articleCategoryValues);

type ArticleCategory = (typeof articleCategoryValues)[number];

export type InventoryGridProps = {
  /** Committed search term, owned by the page-body. */
  searchTerm: string;
  /** Clears the page-body's local search-term state. */
  onClearSearchTerm: () => void;
  /** Forwarded to each card; opens parent's threshold-edit modal. */
  onConfigureThresholds: InventoryCardProps["onConfigureThresholds"];
};

export function InventoryGrid({
  searchTerm,
  onClearSearchTerm,
  onConfigureThresholds,
}: InventoryGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const parsed = parseInventoryFiltersFromSearchParams(
    new URLSearchParams(searchParams.toString()),
  );

  const instanceKey = useId();
  const { joined } = useInventoryRealtime(instanceKey);

  // Drop any URL-pinned categories that aren't in the canonical enum
  // (defense-in-depth — the filter component already filters, but route
  // hand-typing should not crash the query).
  const categories: ReadonlyArray<ArticleCategory> = parsed.categories.filter(
    (c): c is ArticleCategory => CATEGORY_SET.has(c),
  );

  const filters = {
    search: searchTerm,
    categories,
    warningsOnly: parsed.warningsOnly,
    bucket: parsed.bucket,
    page: parsed.page,
    pageSize: INVENTORY_LIST_PAGE_SIZE,
  };

  // When Realtime hasn't joined within 5s, fall back to a 30s polling
  // refetch so the grid still picks up mutations (AC-RT — Story 2.5/3.1/3.2
  // deferred-parity per deferred-work line 242; Story 3.4 ships the
  // canonical implementation).
  const refetchInterval = joined ? false : 30_000;

  const query = useInventoryOverview(filters, { refetchInterval });

  function setPage(page: number) {
    const current =
      typeof window !== "undefined"
        ? window.location.search.replace(/^\?/, "")
        : searchParams.toString();
    const params = new URLSearchParams(current);
    if (page <= 1) params.delete("page");
    else params.set("page", String(page));
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  // Clears local search state AND every URL filter param. Mirrors
  // `<InventoryFilters>.resetAll()` so the empty-state CTA escapes from
  // a filter-narrowed empty result correctly (previously it cleared
  // only the local search, leaving URL params intact and the empty
  // state stuck — AC2 violation).
  function resetAllFilters() {
    onClearSearchTerm();
    const current =
      typeof window !== "undefined"
        ? window.location.search.replace(/^\?/, "")
        : searchParams.toString();
    const params = new URLSearchParams(current);
    for (const k of ["category", "warningsOnly", "bucket", "page"]) {
      params.delete(k);
    }
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  if (query.isPending) {
    return <InventoryGridSkeleton />;
  }

  if (query.isError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <p className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertCircle className="h-4 w-4" aria-hidden />
            Inventar konnte nicht geladen werden
          </p>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm text-destructive">
          <span>
            {query.error instanceof Error
              ? query.error.message
              : "Unbekannter Fehler — bitte später erneut versuchen."}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
          >
            Erneut versuchen
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { rows, total } = query.data;

  if (rows.length === 0) {
    const hasFilters =
      Boolean(searchTerm) ||
      categories.length > 0 ||
      parsed.warningsOnly ||
      parsed.bucket !== null;
    return (
      <InventoryEmptyState
        variant={hasFilters ? "filter" : "catalog"}
        onClearFilters={resetAllFilters}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
        )}
      >
        {rows.map((row) => (
          <InventoryCard
            key={row.article_id}
            row={row}
            onConfigureThresholds={onConfigureThresholds}
          />
        ))}
      </div>
      <TablePagination
        page={filters.page ?? 1}
        pageSize={filters.pageSize ?? INVENTORY_LIST_PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        itemNoun="Artikel"
      />
    </div>
  );
}

function InventoryGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="flex h-full flex-col">
          <CardHeader className="space-y-2 p-4 pb-2">
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 animate-pulse rounded-md bg-muted"
                aria-hidden
              />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="flex gap-1.5">
              <div className="h-5 w-20 animate-pulse rounded bg-muted" />
              <div className="h-5 w-28 animate-pulse rounded bg-muted" />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-2 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

type InventoryEmptyStateProps = {
  variant: "catalog" | "filter";
  onClearFilters: () => void;
};

function InventoryEmptyState({
  variant,
  onClearFilters,
}: InventoryEmptyStateProps) {
  if (variant === "filter") {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <PackageSearch
            className="h-10 w-10 text-muted-foreground"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="text-sm font-medium">Keine Treffer</p>
            <p className="text-xs text-muted-foreground">
              Aktive Filter passen auf keinen vermietbaren Artikel.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearFilters}
          >
            Filter zurücksetzen
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <PackageSearch
          className="h-10 w-10 text-muted-foreground"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            Noch keine vermietbaren Artikel
          </p>
          <p className="text-xs text-muted-foreground">
            Lege zuerst einen Artikel im Katalog an — danach erscheint er
            hier mit seiner aktuellen Verfügbarkeit.
          </p>
        </div>
        <Button asChild type="button" variant="outline" size="sm">
          <Link href="/articles?action=create">Artikel anlegen</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
