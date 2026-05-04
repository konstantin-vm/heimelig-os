import { ROLE_ALLOWED_PATHS, type AppRole } from "@/lib/constants/roles";

export type NavShell = "desktop" | "mobile";

export type SidebarCounterKey = "orders" | "contracts" | "invoices";

export type NavIconKey =
  | "dashboard"
  | "customers"
  | "articles"
  | "orders"
  | "contracts"
  | "invoices"
  | "tours"
  | "settings"
  | "tour"
  | "scan";

export type NavSubItem = {
  key: string;
  labelDe: string;
  href: string;
  roles: readonly AppRole[];
};

export type NavItem = {
  key: string;
  labelDe: string;
  href: string;
  iconKey: NavIconKey;
  roles: readonly AppRole[];
  shell: NavShell;
  children?: readonly NavSubItem[];
  adminSection?: boolean;
  counterKey?: SidebarCounterKey;
};

export const DESKTOP_NAV: readonly NavItem[] = [
  {
    key: "dashboard",
    labelDe: "Dashboard",
    href: "/dashboard",
    iconKey: "dashboard",
    roles: ["admin", "office"],
    shell: "desktop",
  },
  {
    key: "customers",
    labelDe: "Kunden",
    href: "/customers",
    iconKey: "customers",
    roles: ["admin", "office"],
    shell: "desktop",
  },
  {
    // Story 3.5 — top-level entry for the warehouse mobile QR scan page
    // (D-ROUTE 2026-05-04). Positioned above "Artikel" so warehouse — who
    // sees only `scan` + `articles` — gets the scan flow as the first nav
    // row (their most-used path); admin / office see it as an additional
    // row above "Artikel" for occasional support use. Per-role ordering
    // would require a richer nav schema; documented in
    // `2026-05-04_story-3-5.md` as the cheap default until it's needed.
    // Technician is intentionally excluded — their in-stop scanner lives
    // under `/(technician)/stop/[id]` (Epic-8 / Story 8.4).
    key: "scan",
    labelDe: "Scannen",
    href: "/scan",
    iconKey: "scan",
    roles: ["admin", "office", "warehouse"],
    shell: "desktop",
  },
  {
    key: "articles",
    labelDe: "Artikel",
    href: "/articles",
    iconKey: "articles",
    roles: ["admin", "office", "warehouse"],
    shell: "desktop",
    children: [
      {
        key: "articles.products",
        labelDe: "Produkte",
        href: "/articles",
        roles: ["admin", "office", "warehouse"],
      },
      {
        // Story 3.4 — operational inventory grid (S-010 NEW). Sibling to
        // the Story-3.1 `/articles` catalog table; sub-nav grouping under
        // the existing "Artikel" parent rather than a new top-level entry
        // (D-ROUTE decision 2026-05-04).
        key: "articles.inventory",
        labelDe: "Inventar",
        href: "/articles/inventory",
        roles: ["admin", "office", "warehouse"],
      },
      {
        key: "articles.devices",
        labelDe: "Geräte",
        href: "/articles/devices",
        roles: ["admin", "office", "warehouse"],
      },
      {
        key: "articles.price-lists",
        labelDe: "Preislisten",
        href: "/articles/price-lists",
        roles: ["admin", "office"],
      },
      {
        key: "articles.batch",
        labelDe: "Batch-Registrierung",
        href: "/articles/batch",
        roles: ["admin", "warehouse"],
      },
      {
        // Renamed from `articles.scan` (`/articles/scan`) in Story 3.7 — the
        // entry was misleadingly named "scan" but always pointed at the
        // desktop label-print page (the *mobile* PWA scan is Story 3.5's
        // own route under the technician shell). `office` added so office
        // users can re-print labels for service-call follow-ups too. The
        // dev-time `assertNavHrefsCoverAllowedPaths` guard re-runs on boot
        // and verifies `/articles/labels` is still under `/articles` for
        // each listed role.
        key: "articles.labels",
        labelDe: "QR-Etiketten",
        href: "/articles/labels",
        roles: ["admin", "office", "warehouse"],
      },
    ],
  },
  {
    key: "orders",
    labelDe: "Aufträge",
    href: "/orders",
    iconKey: "orders",
    roles: ["admin", "office"],
    shell: "desktop",
    counterKey: "orders",
  },
  {
    key: "contracts",
    labelDe: "Verträge",
    href: "/contracts",
    iconKey: "contracts",
    roles: ["admin", "office"],
    shell: "desktop",
    counterKey: "contracts",
  },
  {
    key: "invoices",
    labelDe: "Rechnungen",
    href: "/invoices",
    iconKey: "invoices",
    roles: ["admin", "office"],
    shell: "desktop",
    counterKey: "invoices",
  },
  {
    key: "tours",
    labelDe: "Touren",
    href: "/tours",
    iconKey: "tours",
    roles: ["admin", "office"],
    shell: "desktop",
  },
  {
    key: "settings",
    labelDe: "Einstellungen",
    href: "/settings",
    iconKey: "settings",
    roles: ["admin"],
    shell: "desktop",
    adminSection: true,
  },
] as const;

export const MOBILE_NAV: readonly NavItem[] = [
  {
    key: "tour",
    labelDe: "Heutige Tour",
    href: "/tour",
    iconKey: "tour",
    roles: ["technician"],
    shell: "mobile",
  },
] as const;

const ALL_NAV: readonly NavItem[] = [...DESKTOP_NAV, ...MOBILE_NAV];

export function navItemsFor(role: AppRole): NavItem[] {
  return ALL_NAV
    .filter((item) => item.roles.includes(role))
    .map((item) =>
      item.children
        ? {
            ...item,
            children: item.children.filter((child) =>
              child.roles.includes(role),
            ),
          }
        : item,
    );
}

// Dev-time guard: every NavItem.href must match ROLE_ALLOWED_PATHS for every
// role the item is exposed to. Prevents drift between middleware and menu.
function assertNavHrefsCoverAllowedPaths(): void {
  const check = (href: string, role: AppRole, key: string) => {
    const allowed = ROLE_ALLOWED_PATHS[role];
    const ok = allowed.some(
      (prefix) => href === prefix || href.startsWith(`${prefix}/`),
    );
    if (!ok) {
      throw new Error(
        `[navigation] href "${href}" (key=${key}) not permitted for role "${role}" — update ROLE_ALLOWED_PATHS or NavItem.roles`,
      );
    }
  };

  for (const item of ALL_NAV) {
    for (const role of item.roles) {
      check(item.href, role, item.key);
    }
    if (item.children) {
      for (const child of item.children) {
        for (const role of child.roles) {
          check(child.href, role, child.key);
        }
      }
    }
  }
}

if (process.env.NODE_ENV !== "production") {
  assertNavHrefsCoverAllowedPaths();
}
