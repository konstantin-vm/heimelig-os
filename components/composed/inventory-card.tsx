"use client";

// <InventoryCard> — Story 3.4. One card per row from
// `public.inventory_overview`. Read-only by design — threshold edits
// route through the existing `<ArticleEditForm>` (Story 3.1) opened by
// the parent's modal coordinator. Whole-card click is NOT navigational
// (would trap clicks on the threshold-config CTA); only the title link
// + threshold-config link are interactive.

import Link from "next/link";
import { Box, Settings2 } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/composed/status-badge";
import { articleCategoryLabels } from "@/lib/constants/article";
import { deviceStatusLabels } from "@/lib/constants/device";
import { cn } from "@/lib/utils";
import type { InventoryRow } from "@/lib/validations/inventory";

export type InventoryCardProps = {
  row: InventoryRow;
  /** Opens the existing `<ArticleEditForm>` in edit mode for this article. */
  onConfigureThresholds: (articleId: string) => void;
};

// Per-status row order — matches the device-domain conventional order
// from `<DeviceTable>`. Zero-count statuses are omitted from the display
// for visual density (mentioned in spec §"S-010 / Per-article card").
const STATUS_ROW_ORDER = [
  "available",
  "rented",
  "cleaning",
  "repair",
  "sold",
] as const;

// Stable colour key for the segmented utilisation bar. Token mapping
// mirrors `<StatusBadge>`'s availability/condition arms (success for
// available, info for rented, amber for cleaning, red for repair,
// muted for sold). The bar represents the `total_devices` population
// (status IN active set, retired excluded — same denominator the SQL
// view uses), so segments + segmentTotal MUST track that population.
// Retired devices are surfaced in the post-bar text only.
// Bar fills use the strong/balanced variants of each semantic token —
// brand `--success` (neon Frühlingsgrün, L=82 C=0.208) is tuned for icons
// against the dark indigo sidebar, not as a fill on white where it
// overpowers the muted info/destructive segments next to it. The
// `--success-strong` token (L=65 C=0.16) sits at the same visual weight
// as `--info` and `--destructive` so the stacked bar reads as one
// composition rather than a single screaming green segment.
const SEGMENT_BG: Record<string, string> = {
  available: "bg-success-strong",
  rented: "bg-info",
  cleaning: "bg-warning",
  repair: "bg-destructive",
  sold: "bg-muted-foreground/40",
};

export function InventoryCard({
  row,
  onConfigureThresholds,
}: InventoryCardProps) {
  const subtitle = [
    row.variant_label && `Variante: ${row.variant_label}`,
    articleCategoryLabels[row.category],
    row.manufacturer,
  ]
    .filter(Boolean)
    .join(" · ");

  const perStatus = STATUS_ROW_ORDER.map((s) => ({
    status: s,
    count: row[`${s}_devices` as keyof InventoryRow] as number,
  })).filter((entry) => entry.count > 0);

  // Segments mirror the view's `total_devices` denominator (active devices,
  // retired excluded). Retired count surfaces in the post-bar text only —
  // mixing it into the bar contradicted the textual "X von Y aktiv"
  // summary and the aria-label, which both read `total_devices`.
  const segments = [
    { key: "available", count: row.available_devices },
    { key: "rented", count: row.rented_devices },
    { key: "cleaning", count: row.cleaning_devices },
    { key: "repair", count: row.repair_devices },
    { key: "sold", count: row.sold_devices },
  ];
  const segmentTotal = segments.reduce((acc, s) => acc + s.count, 0);

  const thresholdsConfigured =
    row.min_stock !== null || row.critical_stock !== null;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="space-y-1.5 p-4 pb-2">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            aria-hidden
          >
            <Box className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <Link
              href={`/articles/${row.article_id}`}
              className={cn(
                "block text-sm font-semibold leading-snug",
                // AC-AX — expand vertical hit area to ≥44 px without
                // distorting the visual layout. `-my-2` re-collapses the
                // visual margin so the subtitle still sits flush below.
                "min-h-[44px] py-2 -my-2 flex items-center",
                "hover:underline focus-visible:outline-hidden focus-visible:underline",
              )}
            >
              <span className="text-muted-foreground">
                {row.article_number}
              </span>{" "}
              <span>{row.name}</span>
            </Link>
            {subtitle ? (
              <p className="truncate text-xs text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
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
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-3 p-4 pt-2">
        {perStatus.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {perStatus
              .map((s) => `${deviceStatusLabels[s.status]} ${s.count}`)
              .join(" · ")}
          </p>
        ) : row.retired_devices > 0 ? (
          // Retired-only article (all devices ausgemustert). Surface the
          // retired count so the card is not silent — the per-status row
          // above filters out zero-count statuses, which here means "no
          // active devices", but retired devices still exist.
          <p className="text-xs text-muted-foreground">
            Nur ausgemusterte Geräte ({row.retired_devices}).
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Noch keine Geräte erfasst.
          </p>
        )}

        {segmentTotal > 0 ? (
          <div className="space-y-1">
            <div
              className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`Auslastung: ${row.rented_devices} vermietet von ${row.total_devices} aktiv`}
            >
              {segments
                .filter((s) => s.count > 0)
                .map((s) => (
                  <span
                    key={s.key}
                    className={cn("h-full", SEGMENT_BG[s.key] ?? "bg-muted")}
                    style={{
                      width: `${(s.count / segmentTotal) * 100}%`,
                    }}
                  />
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {row.rented_devices} vermietet von {row.total_devices} aktiv
              {row.retired_devices > 0
                ? ` · ${row.retired_devices} ausgemustert`
                : ""}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {thresholdsConfigured ? (
            <span>
              Min {row.min_stock ?? "–"} · Kritisch {row.critical_stock ?? "–"}
            </span>
          ) : (
            <span>Keine Schwellwerte definiert</span>
          )}
          <button
            type="button"
            onClick={() => onConfigureThresholds(row.article_id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-3 font-medium text-primary",
              // AC-AX — ≥44 px tap target on the threshold-edit link.
              "min-h-[44px]",
              "hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden />
            Schwellwerte konfigurieren
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
