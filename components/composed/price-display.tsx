// <PriceDisplay> — generic CHF amount formatter declared in
// `docs/design/desktop/component-map.md`. Sprint-1 variants:
//   default  → "CHF 1'234.50" (formatChf from lib/utils/format)
//   redacted → "—" with aria-label "Preise sind nicht verfügbar"
//
// Sprint-3 (Epic 4 KK-Split) will add a `split` variant. Until then, KK-Split
// rendering lives in <PriceListCard> directly.
//
// The `redacted` variant is defense-in-depth for the warehouse role on the
// article catalog: RLS already blocks warehouse from reading `price_lists`,
// but if the UI accidentally tries to render a price slot in a warehouse-
// scoped subtree, this variant produces a benign placeholder with a screen-
// reader hint instead of leaking an empty cell.

import { formatChf } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

export type PriceDisplayVariant = "default" | "redacted";

export type PriceDisplayProps = {
  amount?: number | string | null;
  variant?: PriceDisplayVariant;
  /** Optional class on the outer element. */
  className?: string;
};

export function PriceDisplay({
  amount,
  variant = "default",
  className,
}: PriceDisplayProps) {
  if (variant === "redacted") {
    return (
      <span
        className={cn("text-muted-foreground", className)}
        aria-label="Preise sind nicht verfügbar"
        title="Preise sind nicht verfügbar"
        data-price-variant="redacted"
      >
        —
      </span>
    );
  }
  return (
    <span
      className={cn("font-medium tabular-nums", className)}
      data-price-variant="default"
    >
      {formatChf(amount)}
    </span>
  );
}
