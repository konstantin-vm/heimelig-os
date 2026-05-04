"use client";

// <DeviceTable> — Story 3.2.
//
// Server-paged device list scoped to a single article. Mirrors `<ArticleTable>`
// (Story 3.1) for sort/pagination/realtime, with a few differences:
//   * Filtered by `article_id`.
//   * Status + condition rendered via the extended `<StatusBadge>`
//     (`entity='device' | 'device-condition'`).
//   * `is_new` rendered as a small "Neu" / "Gebraucht" chip.
//   * Per-row actions: eye → /devices/[id], pencil → edit modal,
//     trash → soft-delete (admin-only via `useAppRole()`; RLS denies for
//     non-admin even if the icon were exposed).

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  PackageSearch,
  SearchX,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DEVICE_LIST_DEFAULT_SORT,
  DEVICE_LIST_PAGE_SIZE,
  SORTABLE_DEVICE_LIST_COLUMNS,
  deviceIsNewLabels,
  type DeviceListSortColumn,
  type DeviceListSortDir,
} from "@/lib/constants/device";
import { useAppRole } from "@/lib/hooks/use-app-role";
import {
  useArticleDevices,
  useArticleDevicesRealtime,
  useDeviceSoftDelete,
  type DeviceListFilters,
  type DeviceListRow,
} from "@/lib/queries/devices";
import { cn } from "@/lib/utils";

import { ConfirmDialog } from "./confirm-dialog";
import { RowActions } from "./row-actions";
import { StatusBadge } from "./status-badge";
import { TablePagination } from "./table-pagination";
import {
  parseDeviceListFiltersFromSearchParams,
} from "./device-list-filters";

type ReadonlyURLSearchParams = ReturnType<typeof useSearchParams>;

function parseFilters(
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
  searchTerm: string,
): {
  filters: DeviceListFilters;
  page: number;
  sort: DeviceListSortColumn;
  dir: DeviceListSortDir;
} {
  const get = (key: string) => searchParams.get(key) ?? "";
  const sortRaw = get("sort");
  const sort: DeviceListSortColumn = SORTABLE_DEVICE_LIST_COLUMNS.has(
    sortRaw as DeviceListSortColumn,
  )
    ? (sortRaw as DeviceListSortColumn)
    : DEVICE_LIST_DEFAULT_SORT.col;
  const dirRaw = get("dir");
  const dir: DeviceListSortDir = dirRaw === "desc" ? "desc" : "asc";
  const pageRaw = parseInt(get("page") || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const params = new URLSearchParams(searchParams.toString());
  const { status, condition, isNew, includeRetired } =
    parseDeviceListFiltersFromSearchParams(params);

  const filters: DeviceListFilters = {
    search: searchTerm.trim() || undefined,
    status: status as DeviceListFilters["status"],
    condition: condition as DeviceListFilters["condition"],
    isNew,
    includeRetired,
    sort,
    dir,
    page,
    pageSize: DEVICE_LIST_PAGE_SIZE,
  };
  return { filters, page, sort, dir };
}

function customerLabel(c: DeviceListRow["customers"]): string | null {
  if (!c) return null;
  if (c.company_name) return c.company_name;
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

export type DeviceTableProps = {
  articleId: string;
  searchTerm: string;
  onClearSearchTerm: () => void;
  onEdit: (deviceId: string) => void;
};

export function DeviceTable({
  articleId,
  searchTerm,
  onClearSearchTerm,
  onEdit,
}: DeviceTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const channelKey = useId();

  const { data: role } = useAppRole();
  const isAdmin = role === "admin";

  const { filters, page, sort, dir } = useMemo(
    () => parseFilters(searchParams, searchTerm),
    [searchParams, searchTerm],
  );

  const { data, isLoading, isError, refetch, isFetching } = useArticleDevices(
    articleId,
    filters,
  );
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  // Realtime invalidations — `channelKey` (useId()) keeps this mount's
  // Supabase channel name unique across StrictMode double-mount + multi-tab
  // open, mirroring the project-wide convention from articles realtime hooks.
  useArticleDevicesRealtime(articleId, channelKey);

  const lastPage = Math.max(1, Math.ceil(total / DEVICE_LIST_PAGE_SIZE));
  useEffect(() => {
    if (!isLoading && total > 0 && page > lastPage) {
      const params = new URLSearchParams(searchParams.toString());
      if (lastPage > 1) params.set("page", String(lastPage));
      else params.delete("page");
      const queryStr = params.toString();
      router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
    }
  }, [isLoading, total, page, lastPage, searchParams, router]);

  const [confirmDelete, setConfirmDelete] = useState<DeviceListRow | null>(null);
  const softDelete = useDeviceSoftDelete({
    onSuccess: () => {
      toast.success("Gerät ausgemustert.");
      setConfirmDelete(null);
    },
    onError: (err) => {
      toast.error("Ausmusterung fehlgeschlagen", { description: err.message });
      setConfirmDelete(null);
    },
  });

  function pushSort(nextCol: DeviceListSortColumn) {
    if (!SORTABLE_DEVICE_LIST_COLUMNS.has(nextCol)) return;
    const params = new URLSearchParams(searchParams.toString());
    let newSort: DeviceListSortColumn | "" = nextCol;
    let newDir: DeviceListSortDir = "asc";
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
    for (const k of ["status", "condition", "new", "retired", "page"]) {
      params.delete(k);
    }
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  const hasActiveFilters =
    Boolean(filters.search)
    || (filters.status && filters.status.length > 0)
    || (filters.condition && filters.condition.length > 0)
    || filters.isNew !== null
    || filters.includeRetired;

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table
          className="w-full text-left text-sm"
          aria-label="Geräteliste"
          aria-busy={isFetching}
        >
          <thead className="bg-muted/50">
            <tr className="border-b border-border">
              <SortableHeader
                col="serial_number"
                label="Seriennummer"
                width="w-[18%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <th
                scope="col"
                className="w-[12%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                QR
              </th>
              <SortableHeader
                col="status"
                label="Status"
                width="w-[10%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <SortableHeader
                col="condition"
                label="Zustand"
                width="w-[10%]"
                currentSort={sort}
                currentDir={dir}
                onSort={pushSort}
              />
              <th
                scope="col"
                className="w-[8%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Lager
              </th>
              <th
                scope="col"
                className="w-[16%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Aktueller Kunde
              </th>
              <th
                scope="col"
                className="w-[7%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Neu
              </th>
              <th
                scope="col"
                className="w-[14%] px-3 py-3 text-sm font-semibold text-muted-foreground"
              >
                Notizen
              </th>
              <th
                scope="col"
                className="w-[5%] px-3 py-3 text-right text-sm font-semibold text-muted-foreground"
              >
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Geräte werden geladen…
                  </span>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-12 text-center text-destructive"
                >
                  Geräte konnten nicht geladen werden.{" "}
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
                <td colSpan={9} className="px-3 py-16 text-center">
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
                      <PackageSearch className="h-8 w-8" aria-hidden />
                      <span className="text-sm font-medium text-foreground">
                        Noch keine Geräte für diesen Artikel
                      </span>
                      <span className="text-sm">
                        Lege das erste Gerät über den Button oben rechts an.
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const customer = customerLabel(row.customers);
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      "hover:bg-muted/30 focus-within:bg-muted/30",
                    )}
                  >
                    <td className="px-3 py-3 font-medium tabular-nums">
                      <Link
                        href={`/devices/${row.id}`}
                        className="-mx-3 -my-3 block px-3 py-3 text-sm text-foreground focus-visible:underline focus-visible:outline-hidden"
                        aria-label={`Gerät ${row.serial_number} öffnen`}
                      >
                        {row.serial_number}
                      </Link>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      {row.qr_code ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge entity="device" status={row.status} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge
                        entity="device-condition"
                        status={row.condition}
                      />
                    </td>
                    <td className="px-3 py-3 text-sm">
                      {row.warehouses?.code ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-sm">
                      {row.current_contract_id ? "—" : customer ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                          row.is_new
                            ? "bg-success-soft text-success-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {row.is_new
                          ? deviceIsNewLabels.true
                          : deviceIsNewLabels.false}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      <span className="line-clamp-1">{row.notes ?? "—"}</span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <RowActions
                          onView={() => router.push(`/devices/${row.id}`)}
                          onEdit={() => onEdit(row.id)}
                          ariaLabel={`Gerät ${row.serial_number} bearbeiten`}
                          viewAriaLabel={`Gerät ${row.serial_number} anzeigen`}
                        />
                        {isAdmin ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete(row);
                            }}
                            aria-label={`Gerät ${row.serial_number} ausmustern`}
                            className="h-9 w-9 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
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
        pageSize={DEVICE_LIST_PAGE_SIZE}
        total={total}
        onPageChange={pushPage}
        itemNoun="Geräten"
      />

      {confirmDelete ? (
        <ConfirmDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setConfirmDelete(null);
          }}
          title="Gerät ausmustern?"
          description={`Das Gerät ${confirmDelete.serial_number} wird mit dem heutigen Datum als ausgemustert markiert (retired_at). Es bleibt in den Daten erhalten, ist aber für neue Aufträge nicht mehr verfügbar.`}
          confirmLabel="Ausmustern"
          variant="destructive"
          onConfirm={async () => {
            await softDelete.mutateAsync({ id: confirmDelete.id });
          }}
        />
      ) : null}
    </Card>
  );
}

type SortableHeaderProps = {
  col: DeviceListSortColumn;
  label: string;
  width: string;
  currentSort: DeviceListSortColumn;
  currentDir: DeviceListSortDir;
  onSort: (col: DeviceListSortColumn) => void;
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
        className="inline-flex items-center gap-1 hover:text-foreground focus-visible:underline focus-visible:outline-hidden"
      >
        {label}
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </th>
  );
}
