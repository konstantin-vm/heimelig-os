import { cn } from "@/lib/utils";

export type CountBadgeProps = {
  count: number | null | undefined;
  /** "info" maps to bg-info-soft / text-foreground per design-context. */
  tone?: "info" | "muted";
  className?: string;
};

export function CountBadge({
  count,
  tone = "info",
  className,
}: CountBadgeProps) {
  const hasCount = typeof count === "number";
  const display = hasCount ? count : "–";
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[13px] font-medium",
        tone === "info"
          ? "bg-info-soft text-foreground"
          : "bg-muted text-muted-foreground",
        className,
      )}
      aria-label={hasCount ? `${count} Einträge` : "Anzahl unbekannt"}
    >
      {display}
    </span>
  );
}
