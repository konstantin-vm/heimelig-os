"use client";

// Shared helpers for the "Pro Seite" select in <TablePagination>. Each
// list table parses its own filters from the URL — keeping the page-size
// logic here avoids duplicating the same 10 lines × 4 tables.

import { useMemo } from "react";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const VALID: ReadonlySet<number> = new Set(PAGE_SIZE_OPTIONS);

type ReadonlyURLSearchParams = {
  get: (key: string) => string | null;
  toString: () => string;
};

export function parsePageSizeParam(
  searchParams: ReadonlyURLSearchParams,
  fallback: number,
): number {
  const raw = parseInt(searchParams.get("ps") ?? "", 10);
  return Number.isFinite(raw) && VALID.has(raw) ? raw : fallback;
}

export function usePageSizeParam(
  searchParams: ReadonlyURLSearchParams,
  fallback: number,
): number {
  return useMemo(
    () => parsePageSizeParam(searchParams, fallback),
    [searchParams, fallback],
  );
}

type Router = { replace: (href: string, opts?: { scroll?: boolean }) => void };

export function buildPageSizeHandler(
  searchParams: ReadonlyURLSearchParams,
  router: Router,
  fallback: number,
): (next: number) => void {
  return (next: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === fallback) params.delete("ps");
    else params.set("ps", String(next));
    params.delete("page");
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  };
}
