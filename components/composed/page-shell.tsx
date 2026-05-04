"use client";

import {
  PAGE_HEADER_PRIORITY,
  useSetPageHeader,
} from "@/lib/contexts/page-header-context";
import { cn } from "@/lib/utils";

export type PageShellProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** @deprecated Use top-bar breadcrumb for back-navigation. Ignored. */
  backHref?: string;
  className?: string;
  children: React.ReactNode;
};

/**
 * Page layout shell: registers the page identity (title + actions) with the
 * shell's top bar and provides the body's vertical-stack spacing. The page
 * title no longer renders inline — the shell owns the chrome — so screens
 * stop showing the same string two or three times stacked vertically.
 *
 * `subtitle` is no longer rendered visually (was rare; never made it into
 * the design system's modern top-bar layout). Drop it from callers when
 * touching them.
 *
 * `backHref` is deprecated: the top-bar breadcrumb provides back-navigation.
 * The prop is accepted to keep existing callers compiling but is ignored.
 */
export function PageShell({
  title,
  actions,
  className,
  children,
}: PageShellProps) {
  useSetPageHeader({ title, actions }, PAGE_HEADER_PRIORITY.shell);

  return (
    <div className={cn("flex flex-col gap-6", className)}>{children}</div>
  );
}
