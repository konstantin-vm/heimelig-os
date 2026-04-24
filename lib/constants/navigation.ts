import {
  AlertTriangle,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  Receipt,
  Route,
  Settings,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { ROLE_ALLOWED_PATHS, type AppRole } from "@/lib/constants/roles";

export type NavShell = "desktop" | "mobile";

export type NavItem = {
  key: string;
  labelDe: string;
  href: string;
  icon: LucideIcon;
  roles: readonly AppRole[];
  shell: NavShell;
  adminOnly?: boolean;
};

export const DESKTOP_NAV: readonly NavItem[] = [
  {
    key: "dashboard",
    labelDe: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["admin", "office"],
    shell: "desktop",
  },
  {
    key: "customers",
    labelDe: "Kunden",
    href: "/customers",
    icon: Users,
    roles: ["admin", "office"],
    shell: "desktop",
  },
  {
    key: "articles",
    labelDe: "Artikel",
    href: "/articles",
    icon: Package,
    roles: ["admin", "office", "warehouse"],
    shell: "desktop",
  },
  {
    key: "orders",
    labelDe: "Aufträge",
    href: "/orders",
    icon: ClipboardList,
    roles: ["admin", "office"],
    shell: "desktop",
  },
  {
    key: "contracts",
    labelDe: "Mietverträge",
    href: "/contracts",
    icon: FileText,
    roles: ["admin", "office"],
    shell: "desktop",
  },
  {
    key: "invoices",
    labelDe: "Rechnungen",
    href: "/invoices",
    icon: Receipt,
    roles: ["admin", "office"],
    shell: "desktop",
  },
  {
    key: "tours",
    labelDe: "Touren",
    href: "/tours",
    icon: Truck,
    roles: ["admin", "office"],
    shell: "desktop",
  },
  {
    key: "settings",
    labelDe: "Einstellungen",
    href: "/settings",
    icon: Settings,
    roles: ["admin"],
    shell: "desktop",
    adminOnly: true,
  },
  {
    key: "errors",
    labelDe: "Fehler",
    href: "/errors",
    icon: AlertTriangle,
    roles: ["admin"],
    shell: "desktop",
    adminOnly: true,
  },
] as const;

export const MOBILE_NAV: readonly NavItem[] = [
  {
    key: "tour",
    labelDe: "Heutige Tour",
    href: "/tour",
    icon: Route,
    roles: ["technician"],
    shell: "mobile",
  },
] as const;

const ALL_NAV: readonly NavItem[] = [...DESKTOP_NAV, ...MOBILE_NAV];

export function navItemsFor(role: AppRole): NavItem[] {
  return ALL_NAV.filter((item) => item.roles.includes(role));
}

// Dev-time guard: every NavItem.href must match ROLE_ALLOWED_PATHS for every
// role the item is exposed to. Prevents drift between middleware and menu.
function assertNavHrefsCoverAllowedPaths(): void {
  for (const item of ALL_NAV) {
    for (const role of item.roles) {
      const allowed = ROLE_ALLOWED_PATHS[role];
      const ok = allowed.some(
        (prefix) => item.href === prefix || item.href.startsWith(`${prefix}/`),
      );
      if (!ok) {
        throw new Error(
          `[navigation] href "${item.href}" (key=${item.key}) not permitted for role "${role}" — update ROLE_ALLOWED_PATHS or NavItem.roles`,
        );
      }
    }
  }
}

if (process.env.NODE_ENV !== "production") {
  assertNavHrefsCoverAllowedPaths();
}
