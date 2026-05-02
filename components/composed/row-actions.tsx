"use client";

import { Eye, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RowActionsProps = {
  onView?: () => void;
  onEdit?: () => void;
  /** aria-label override for the Pencil button. */
  ariaLabel?: string;
  /** aria-label override for the Eye button. */
  viewAriaLabel?: string;
  className?: string;
};

/**
 * Per-row action group used in the customer list. Story 2.5 added the optional
 * `onView` (eye icon → /customers/[id]); when `onView` is omitted, the eye
 * button is not rendered. Story 2.5 Resolved decision 7 — no trash icon on
 * list rows.
 *
 * Both buttons stop propagation so a row-level click handler (router.push)
 * can fire on the bare `<tr>` without these icons triggering it twice.
 */
export function RowActions({
  onView,
  onEdit,
  ariaLabel = "Kunde bearbeiten",
  viewAriaLabel = "Kunde anzeigen",
  className,
}: RowActionsProps) {
  function stop<E extends { stopPropagation: () => void }>(handler?: () => void) {
    return (e: E) => {
      e.stopPropagation();
      handler?.();
    };
  }
  return (
    <div className={cn("flex items-center justify-end gap-1", className)}>
      {onView ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={stop(onView)}
          aria-label={viewAriaLabel}
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
        >
          <Eye className="h-4 w-4" />
        </Button>
      ) : null}
      {onEdit ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={stop(onEdit)}
          aria-label={ariaLabel}
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
