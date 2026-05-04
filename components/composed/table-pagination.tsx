"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type TablePaginationProps = {
  /** 1-indexed current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Wire to enable the "Pro Seite" select; omitted → select hidden. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  /** German plural noun for the count text — defaults to "Einträgen". */
  itemNoun?: string;
  className?: string;
};

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

type PageSlot = number | "gap-l" | "gap-r";

function buildPageSlots(current: number, lastPage: number): PageSlot[] {
  const SIBLINGS = 1;
  const TOTAL_SLOTS = SIBLINGS * 2 + 5;
  if (lastPage <= TOTAL_SLOTS) {
    return Array.from({ length: lastPage }, (_, i) => i + 1);
  }
  const left = Math.max(current - SIBLINGS, 1);
  const right = Math.min(current + SIBLINGS, lastPage);
  const showLeftGap = left > 2;
  const showRightGap = right < lastPage - 1;
  const edgeCount = 3 + 2 * SIBLINGS;

  if (!showLeftGap && showRightGap) {
    return [
      ...Array.from({ length: edgeCount }, (_, i) => i + 1),
      "gap-r",
      lastPage,
    ];
  }
  if (showLeftGap && !showRightGap) {
    return [
      1,
      "gap-l",
      ...Array.from(
        { length: edgeCount },
        (_, i) => lastPage - edgeCount + 1 + i,
      ),
    ];
  }
  return [
    1,
    "gap-l",
    ...Array.from({ length: right - left + 1 }, (_, i) => left + i),
    "gap-r",
    lastPage,
  ];
}

const ICON_BTN = "h-9 w-9 rounded-md";

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  itemNoun = "Einträgen",
  className,
}: TablePaginationProps) {
  const showSizeSelect = Boolean(onPageSizeChange);
  if (total <= pageSize) return null;

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, total);
  const isFirst = page <= 1;
  const isLast = page >= lastPage;
  const slots = buildPageSlots(page, lastPage);

  return (
    <nav
      aria-label="Seitennavigation"
      className={cn(
        "flex flex-col items-center justify-between gap-3 px-3 py-3 text-sm sm:flex-row",
        className,
      )}
    >
      <div className="flex items-center gap-3 text-muted-foreground">
        <span role="status" className="tabular-nums">
          {startIdx}–{endIdx} von {total} {itemNoun}
        </span>
        {showSizeSelect ? (
          <>
            <span aria-hidden className="text-muted-foreground/60">·</span>
            <label className="flex items-center gap-2">
              Pro Seite
              <Select
                value={String(pageSize)}
                onValueChange={(v) => onPageSizeChange?.(Number(v))}
              >
                <SelectTrigger size="sm" className="w-[72px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </>
        ) : null}
      </div>
      <ul className="flex items-center gap-1">
        <li>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={ICON_BTN}
            onClick={() => onPageChange(1)}
            disabled={isFirst}
            aria-label="Erste Seite"
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden />
          </Button>
        </li>
        <li>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={ICON_BTN}
            onClick={() => onPageChange(page - 1)}
            disabled={isFirst}
            aria-label="Vorherige Seite"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
        </li>
        {slots.map((slot, idx) =>
          slot === "gap-l" || slot === "gap-r" ? (
            <li key={`${slot}-${idx}`} aria-hidden>
              <span className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground">
                …
              </span>
            </li>
          ) : (
            <li key={slot}>
              <Button
                type="button"
                variant={slot === page ? "default" : "ghost"}
                size="icon"
                className={cn(ICON_BTN, "tabular-nums")}
                onClick={() => onPageChange(slot)}
                aria-current={slot === page ? "page" : undefined}
                aria-label={`Seite ${slot}`}
              >
                {slot}
              </Button>
            </li>
          ),
        )}
        <li>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={ICON_BTN}
            onClick={() => onPageChange(page + 1)}
            disabled={isLast}
            aria-label="Nächste Seite"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </li>
        <li>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={ICON_BTN}
            onClick={() => onPageChange(lastPage)}
            disabled={isLast}
            aria-label="Letzte Seite"
          >
            <ChevronsRight className="h-4 w-4" aria-hidden />
          </Button>
        </li>
      </ul>
    </nav>
  );
}
