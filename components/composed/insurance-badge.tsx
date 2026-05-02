// <InsuranceBadge> — Story 2.5 — renders the partner-KK label on the
// S-003 customer list row + S-004 profile cards. Distinct from
// `<InsuranceTypeBadge>` (which colors Grund/Zusatz, Story 2.3); this badge
// colors the actual insurer (Helsana / Sanitas / KPT / Visana / Andere /
// Keine) per the Design Tokens table in `customer-list.md`.

import { cn } from "@/lib/utils";

export type InsuranceBadgeInsurer =
  | "helsana"
  | "sanitas"
  | "kpt"
  | "visana"
  | "other"
  | "none";

export type InsuranceBadgeProps = {
  /**
   * Either the partner-KK code, the literal "other" (freetext), or "none"
   * when the customer has no active grund insurance row. The card-list query
   * resolves this from `customer_insurance.partner_insurers.code` /
   * `insurer_name_freetext` / row absence.
   */
  insurer: InsuranceBadgeInsurer | null | undefined;
  /**
   * Optional override label — when "other" is passed and the consumer wants
   * to surface the freetext name in place of "Andere" (for the profile card,
   * not the list row where space is tight).
   */
  label?: string;
  className?: string;
};

const INSURER_LABEL: Record<InsuranceBadgeInsurer, string> = {
  helsana: "Helsana",
  sanitas: "Sanitas",
  kpt: "KPT",
  visana: "Visana",
  other: "Andere",
  none: "Keine",
};

// Color map per `customer-list.md` Design Tokens table:
//   Helsana  → info-soft / info-foreground
//   Sanitas  → primary-soft / primary
//   KPT      → highlight-soft / highlight-foreground
//   Visana   → success-soft / success
//   Andere   → muted
//   Keine    → muted (slightly softer)
const INSURER_CLASSES: Record<InsuranceBadgeInsurer, string> = {
  helsana: "bg-info-soft text-info-foreground",
  sanitas: "bg-primary-soft text-primary",
  kpt: "bg-highlight-soft text-highlight-foreground",
  visana: "bg-success-soft text-success",
  other: "bg-muted text-muted-foreground",
  none: "bg-muted/60 text-muted-foreground",
};

export function InsuranceBadge({ insurer, label, className }: InsuranceBadgeProps) {
  const resolved = insurer ?? "none";
  const text = label ?? INSURER_LABEL[resolved];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        INSURER_CLASSES[resolved],
        className,
      )}
      data-insurer={resolved}
    >
      {text}
    </span>
  );
}
