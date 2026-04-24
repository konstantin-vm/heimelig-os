import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

export type PageShellProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  backHref?: string;
  className?: string;
  children: React.ReactNode;
};

export function PageShell({
  title,
  subtitle,
  actions,
  backHref,
  className,
  children,
}: PageShellProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {backHref ? (
            <Link
              href={backHref}
              className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="h-5 w-5" />
              <span className="sr-only">Zurück</span>
            </Link>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2 sm:justify-end">
            {actions}
          </div>
        ) : null}
      </header>
      <section className="flex flex-col gap-4">{children}</section>
    </div>
  );
}
