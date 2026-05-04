"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

export type PageHeaderBreadcrumbItem = { label: string; href?: string };

export type PageHeaderState = {
  /** List view title, shown left of the count badge in the top bar. */
  title?: string;
  /** Optional count rendered as a small pill next to the title. */
  count?: number | null;
  /**
   * Custom breadcrumb trail. Overrides the path-derived auto-trail. Use this
   * on detail pages where the leaf segment carries an entity name (e.g.
   * customer full name) that the auto-resolver can't know.
   */
  breadcrumb?: readonly PageHeaderBreadcrumbItem[];
  /** Right-aligned actions (typically primary CTA + secondary buttons). */
  actions?: ReactNode;
};

// Module-level store. Client-only (the hooks below run only after hydration),
// so it cannot leak across SSR requests. Priority-tagged so a more specific
// header (PageHeader, priority 2) wins when a generic wrapper (PageShell,
// priority 1) and the specific one are both mounted on the same page —
// React fires child effects before parents, so without priority the parent
// would clobber the child.
type Entry = { id: symbol; priority: number; state: PageHeaderState };
const stack: Entry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function topEntry(): Entry | undefined {
  let best: Entry | undefined;
  for (const candidate of stack) {
    if (!best || candidate.priority > best.priority) best = candidate;
  }
  return best;
}

let cachedTopState: PageHeaderState | null = null;

function snapshot(): PageHeaderState | null {
  return cachedTopState;
}

function recompute() {
  const next = topEntry()?.state ?? null;
  if (next !== cachedTopState) {
    cachedTopState = next;
    notify();
  }
}

function pushHeader(
  id: symbol,
  priority: number,
  state: PageHeaderState,
): void {
  const existing = stack.find((entry) => entry.id === id);
  if (existing) {
    existing.state = state;
    existing.priority = priority;
    // If this entry is the top, re-publish so consumers pick up new actions.
    if (topEntry()?.id === id) {
      cachedTopState = state;
      notify();
    }
    return;
  }
  stack.push({ id, priority, state });
  recompute();
}

function clearHeader(id: symbol): void {
  const idx = stack.findIndex((entry) => entry.id === id);
  if (idx === -1) return;
  stack.splice(idx, 1);
  recompute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_SNAPSHOT: PageHeaderState | null = null;

/**
 * No-op provider kept for parent symmetry. The store is module-level so the
 * provider doesn't actually own state — it exists so callers can wrap the
 * tree once per shell to make the contract obvious in the JSX.
 */
export function PageHeaderProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Read the currently active page header (top of the stack). */
export function usePageHeader(): PageHeaderState | null {
  return useSyncExternalStore(
    subscribe,
    snapshot,
    () => SERVER_SNAPSHOT,
  );
}

/** Priority levels for built-in slot setters. Higher wins. */
export const PAGE_HEADER_PRIORITY = {
  /** Generic wrapper (e.g. PageShell title=) — falls back when nothing more specific is set. */
  shell: 1,
  /** Page-specific identity (e.g. PageHeader with count + actions). Wins over shell. */
  page: 2,
  /** Page-overridden custom breadcrumb (entity-named detail views). Wins over page. */
  override: 3,
} as const;

/**
 * Register a page header for the lifetime of the calling component. Each
 * call gets a unique id so navigation overlap (next page mounts before the
 * previous unmounts) leaves the stack consistent. `priority` lets a more
 * specific setter beat a generic one mounted in the same tree.
 */
export function useSetPageHeader(
  state: PageHeaderState | null,
  priority: number = PAGE_HEADER_PRIORITY.page,
): void {
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) {
    idRef.current = Symbol("page-header");
  }

  // Push-on-every-commit; closes over latest `state`. Store dedupes by id
  // and notifies only when the visible (top-priority) state actually shifts.
  useEffect(() => {
    const id = idRef.current!;
    if (state === null) {
      clearHeader(id);
      return;
    }
    pushHeader(id, priority, state);
  });

  // Clear on unmount.
  useEffect(() => {
    const id = idRef.current!;
    return () => {
      clearHeader(id);
    };
  }, []);
}
