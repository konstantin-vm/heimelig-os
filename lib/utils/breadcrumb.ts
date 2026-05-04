import type { NavItem, NavSubItem } from "@/lib/constants/navigation";

export type BreadcrumbTrailItem = {
  label: string;
  href?: string;
};

function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  const trimmed =
    pathname.endsWith("/") && pathname.length > 1
      ? pathname.slice(0, -1)
      : pathname;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function findTopLevel(
  pathname: string,
  items: readonly NavItem[],
): NavItem | undefined {
  return items.find((item) => item.href === pathname);
}

function findChild(
  pathname: string,
  items: readonly NavItem[],
): { parent: NavItem; child: NavSubItem } | undefined {
  for (const item of items) {
    const child = item.children?.find((c) => c.href === pathname);
    if (child) return { parent: item, child };
  }
  return undefined;
}

/**
 * Resolve a breadcrumb trail for a path against the navigation tree.
 *
 * Direct match precedence: child wins over top-level (so `/articles` shows
 * as `[Artikel, Produkte]` — Produkte is the named view for that route).
 *
 * Dynamic detail (one unknown segment beyond a known route): top-level wins
 * over child to avoid claiming a specific sub-route the user isn't on. So
 * `/articles/abc-123` → `[Artikel]`, but `/articles/inventory/abc-123` →
 * `[Artikel, Inventar]` (parent trim hits a sub-route).
 */
export function getBreadcrumbTrail(
  pathname: string,
  items: readonly NavItem[],
): BreadcrumbTrailItem[] {
  const path = normalizePath(pathname);
  if (path === "/") return [];

  const childMatch = findChild(path, items);
  if (childMatch) {
    return [
      { label: childMatch.parent.labelDe, href: childMatch.parent.href },
      { label: childMatch.child.labelDe },
    ];
  }

  const topMatch = findTopLevel(path, items);
  if (topMatch) {
    return [{ label: topMatch.labelDe }];
  }

  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return [];
  const parentPath = path.slice(0, lastSlash);

  const parentTop = findTopLevel(parentPath, items);
  if (parentTop) {
    return [{ label: parentTop.labelDe }];
  }
  const parentChild = findChild(parentPath, items);
  if (parentChild) {
    return [
      { label: parentChild.parent.labelDe, href: parentChild.parent.href },
      { label: parentChild.child.labelDe },
    ];
  }

  return [];
}
