"use client";

import { useSetPageHeader } from "@/lib/contexts/page-header-context";

export type PageHeaderProps = {
  title: string;
  count?: number | null;
  actions?: React.ReactNode;
  /** @deprecated Visual styling lives in the shell top bar — no per-page className needed. */
  className?: string;
};

/**
 * Slot-setter: registers the page identity (title, count, actions) with the
 * shell's top bar via React context. Renders nothing visually — the shell
 * owns the rendering so every screen has the same chrome and there's only
 * one source of truth for "where am I and what can I do here?".
 *
 * Pages keep using `<PageHeader title="…" count={…} actions={…} />` exactly
 * as before; the difference is purely in where it surfaces.
 */
export function PageHeader({ title, count, actions }: PageHeaderProps) {
  useSetPageHeader({ title, count, actions });
  return null;
}
