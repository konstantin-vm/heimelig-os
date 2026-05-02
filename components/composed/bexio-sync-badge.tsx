// <BexioSyncBadge> — Story 2.5 — colors `customers.bexio_sync_status` for the
// list row + profile card. **Distinct component** from Story 1.7's
// `<BexioStatusBadge>` (which serves the OAuth-credential lifecycle
// Verbunden/Läuft bald ab/Abgelaufen/Nicht verbunden). Do not conflate.
//
// Status values come from the `customers.bexio_sync_status` enum:
//   pending        → ⏳ Pending (highlight-soft)
//   synced         → ✓ Synced (success-soft)
//   failed         → ⚠ Fehler (destructive-soft)
//   never_synced |
//   local_only |
//   null           → Nicht verknüpft (muted)

import { CheckIcon, ClockIcon, AlertTriangleIcon, MinusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type BexioSyncBadgeStatus =
  | "pending"
  | "synced"
  | "failed"
  | "never_synced"
  | "local_only"
  | null
  | undefined;

export type BexioSyncBadgeProps = {
  status: BexioSyncBadgeStatus;
  className?: string;
};

type DisplayState = {
  label: string;
  classes: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const DISPLAY_BY_STATUS: Record<
  Exclude<BexioSyncBadgeStatus, null | undefined>,
  DisplayState
> = {
  pending: {
    label: "Pending",
    classes: "bg-highlight-soft text-highlight-foreground",
    Icon: ClockIcon,
  },
  synced: {
    label: "Synced",
    classes: "bg-success-soft text-success",
    Icon: CheckIcon,
  },
  failed: {
    label: "Fehler",
    classes: "bg-destructive/10 text-destructive",
    Icon: AlertTriangleIcon,
  },
  never_synced: {
    label: "Nicht verknüpft",
    classes: "bg-muted text-muted-foreground",
    Icon: MinusIcon,
  },
  local_only: {
    label: "Nicht verknüpft",
    classes: "bg-muted text-muted-foreground",
    Icon: MinusIcon,
  },
};

const FALLBACK_DISPLAY: DisplayState = DISPLAY_BY_STATUS.never_synced;

export function BexioSyncBadge({ status, className }: BexioSyncBadgeProps) {
  const display = status ? DISPLAY_BY_STATUS[status] ?? FALLBACK_DISPLAY : FALLBACK_DISPLAY;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        display.classes,
        className,
      )}
      data-bexio-sync={status ?? "none"}
    >
      <display.Icon className="h-3 w-3" aria-hidden />
      {display.label}
    </span>
  );
}
