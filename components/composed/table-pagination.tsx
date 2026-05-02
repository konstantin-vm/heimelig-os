"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TablePaginationProps = {
  /** 1-indexed current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** German singular noun for the count text — defaults to "Kunden". */
  itemNoun?: string;
  className?: string;
};

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  itemNoun = "Kunden",
  className,
}: TablePaginationProps) {
  if (total <= pageSize) return null;

  const startIdx = (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const isFirst = page <= 1;
  const isLast = page >= lastPage;

  return (
    <nav
      aria-label="Seitennavigation"
      className={cn(
        "flex flex-col items-center justify-between gap-2 px-2 py-2 text-sm sm:flex-row",
        className,
      )}
    >
      <p className="text-muted-foreground" role="status">
        {startIdx}–{endIdx} von {total} {itemNoun} angezeigt
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={isFirst}
          aria-label="Vorherige Seite"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Zurück
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={isLast}
          aria-label="Nächste Seite"
        >
          Weiter
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
