import { CountBadge } from "./count-badge";
import { cn } from "@/lib/utils";

export type PageHeaderProps = {
  title: string;
  count?: number | null;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, count, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        {typeof count === "number" ? <CountBadge count={count} /> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
