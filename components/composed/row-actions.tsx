"use client";

import type { ReactNode } from "react";
import { Eye, MoreHorizontal, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type RowActionItem = {
  /** Visible label. */
  label: string;
  /** Optional leading icon (16px Lucide icon). */
  icon?: ReactNode;
  /** Selection handler — invoked on click / Enter / Space. */
  onSelect: () => void;
  /** Renders the item in destructive colour and adds a separator above it. */
  destructive?: boolean;
  /** Disables the item (still rendered, not actionable). */
  disabled?: boolean;
};

export type RowActionsProps = {
  /** Convenience shortcut — adds an "Anzeigen" item that calls `onView`. */
  onView?: () => void;
  /** Convenience shortcut — adds a "Bearbeiten" item that calls `onEdit`. */
  onEdit?: () => void;
  /** Custom items appended after the convenience ones. */
  items?: ReadonlyArray<RowActionItem>;
  /** aria-label override for the trigger. */
  triggerAriaLabel?: string;
  /** Label override for the convenience "Bearbeiten" item. */
  editLabel?: string;
  /** Label override for the convenience "Anzeigen" item. */
  viewLabel?: string;
  className?: string;
};

/**
 * Per-row action menu for list tables. A single MoreHorizontal trigger opens a
 * dropdown so the row stays scannable and we can keep the row itself clickable
 * without colliding with multiple inline icons.
 *
 * The trigger button stops click propagation so it never fires the row's
 * navigate-to-detail handler. Each menu item handler runs in `onSelect`, which
 * Radix already shields from the underlying row click.
 */
export function RowActions({
  onView,
  onEdit,
  items,
  triggerAriaLabel = "Aktionen",
  editLabel = "Bearbeiten",
  viewLabel = "Anzeigen",
  className,
}: RowActionsProps) {
  const built: RowActionItem[] = [];
  if (onView) {
    built.push({
      label: viewLabel,
      icon: <Eye className="h-4 w-4" aria-hidden />,
      onSelect: onView,
    });
  }
  if (onEdit) {
    built.push({
      label: editLabel,
      icon: <Pencil className="h-4 w-4" aria-hidden />,
      onSelect: onEdit,
    });
  }
  const allItems: RowActionItem[] = items ? [...built, ...items] : built;

  if (allItems.length === 0) return null;

  return (
    <div
      className={cn("flex items-center justify-end", className)}
      // The dropdown content is portalled, but the trigger lives inside a
      // potentially clickable <tr>. Stopping propagation on this wrapper keeps
      // pointer-down events from bubbling into the row navigation handler.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={triggerAriaLabel}
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {allItems.map((item, idx) => {
            const prev = idx > 0 ? allItems[idx - 1] : undefined;
            const showSeparator = Boolean(
              item.destructive && prev && !prev.destructive,
            );
            return (
              <RowActionMenuEntry
                key={`${item.label}-${idx}`}
                item={item}
                separatorBefore={showSeparator}
              />
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RowActionMenuEntry({
  item,
  separatorBefore,
}: {
  item: RowActionItem;
  separatorBefore: boolean;
}) {
  return (
    <>
      {separatorBefore ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        disabled={item.disabled}
        onSelect={(e) => {
          e.preventDefault();
          item.onSelect();
        }}
        className={cn(
          item.destructive &&
            "text-destructive focus:bg-destructive/10 focus:text-destructive",
        )}
      >
        {item.icon}
        <span>{item.label}</span>
      </DropdownMenuItem>
    </>
  );
}
