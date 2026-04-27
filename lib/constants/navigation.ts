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
  | "tour";

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
        key: "articles.scan",
        labelDe: "QR-Etiketten",
        href: "/articles/scan",
        roles: ["admin", "warehouse"],
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
