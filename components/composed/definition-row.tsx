// <DefinitionRow> — Story 2.5 — label/value stack used inside the
// `<CustomerInfoCard>` and `<BexioContactCard>` to render the 6 customer
// info rows + 4 bexio status rows. Two-line vertical: 11px medium muted
// label above, 14px medium foreground value below.

import { cn } from "@/lib/utils";

export type DefinitionRowProps = {
  label: string;
  /** When null/undefined/empty string, renders the muted "nicht erfasst" placeholder. */
  value?: React.ReactNode;
  /** Override placeholder text (e.g. "—" for non-applicable cells). */
  emptyPlaceholder?: string;
  /** When true, value is preserved with whitespace-pre-wrap (Notizen). */
  preserveWhitespace?: boolean;
  className?: string;
};

export function DefinitionRow({
  label,
  value,
  emptyPlaceholder = "nicht erfasst",
  preserveWhitespace = false,
  className,
}: DefinitionRowProps) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0);
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-medium",
          isEmpty ? "text-muted-foreground italic" : "text-foreground",
          preserveWhitespace && "whitespace-pre-wrap",
        )}
      >
        {isEmpty ? emptyPlaceholder : value}
      </span>
    </div>
  );
}
