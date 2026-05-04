"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { NavItem } from "@/lib/constants/navigation";
import {
  usePageHeader,
  type PageHeaderBreadcrumbItem,
} from "@/lib/contexts/page-header-context";
import { getBreadcrumbTrail } from "@/lib/utils/breadcrumb";

import { CountBadge } from "./count-badge";

type DesktopTopBarProps = {
  items: readonly NavItem[];
};

function BreadcrumbTrail({
  trail,
}: {
  trail: readonly PageHeaderBreadcrumbItem[];
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="text-sm">
        {trail.map((item, idx) => {
          const isLast = idx === trail.length - 1;
          return (
            <Fragment key={`${idx}-${item.label}`}>
              <BreadcrumbItem>
                {isLast || !item.href ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={item.href}>{item.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast ? (
                <BreadcrumbSeparator>
                  <span aria-hidden="true">/</span>
                </BreadcrumbSeparator>
              ) : null}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function DesktopTopBar({ items }: DesktopTopBarProps) {
  const pathname = usePathname();
  const header = usePageHeader();

  // Resolution: page-set breadcrumb > page-set title > auto-trail from path.
  const customBreadcrumb = header?.breadcrumb;
  const title = header?.title;
  const count = header?.count;
  const actions = header?.actions;
  const autoTrail = customBreadcrumb
    ? null
    : getBreadcrumbTrail(pathname ?? "/", items);

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between gap-6 border-b bg-background px-8">
      <div className="flex min-w-0 items-center gap-3">
        {customBreadcrumb && customBreadcrumb.length > 0 ? (
          <BreadcrumbTrail trail={customBreadcrumb} />
        ) : title ? (
          <>
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {title}
            </h1>
            {typeof count === "number" ? <CountBadge count={count} /> : null}
          </>
        ) : autoTrail && autoTrail.length > 0 ? (
          <BreadcrumbTrail trail={autoTrail} />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
        <button
          type="button"
          aria-label="Benachrichtigungen"
          aria-disabled="true"
          disabled
          title="Benachrichtigungen — bald verfügbar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
