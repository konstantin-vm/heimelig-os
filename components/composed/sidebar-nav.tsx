"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  X,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ROLE_LABELS_DE,
  type AppRole,
} from "@/lib/constants/roles";
import type {
  NavItem,
  NavSubItem,
  SidebarCounterKey,
} from "@/lib/constants/navigation";
import { cn } from "@/lib/utils";

import { LogoutButton } from "./logout-button";
import { NAV_ICONS } from "./nav-icons";

export type SidebarCounters = Partial<Record<SidebarCounterKey, number>>;

type SidebarNavProps = {
  items: readonly NavItem[];
  role: AppRole;
  displayName: string;
  email: string;
  counters?: SidebarCounters;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
};

const COUNTER_VARIANT: Record<
  SidebarCounterKey,
  "neutral" | "warning" | "destructive"
> = {
  orders: "neutral",
  contracts: "warning",
  invoices: "destructive",
};

const ARTIKEL_STORAGE_KEY = "sidebar.artikel.expanded";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getInitials(displayName: string, email: string): string {
  const source = displayName.trim() || email.split("@")[0] || "";
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first && second) {
    return (first.charAt(0) + second.charAt(0)).toUpperCase();
  }
  if (source.length >= 2) return source.slice(0, 2).toUpperCase();
  return source.toUpperCase() || "?";
}

function SidebarCounter({
  count,
  variant,
}: {
  count: number;
  variant: "neutral" | "warning" | "destructive";
}) {
  if (count <= 0) return null;
  const display = count > 99 ? "99+" : String(count);
  return (
    <span
      className={cn(
        "ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        variant === "neutral" &&
          "bg-sidebar-accent text-sidebar-accent-foreground",
        variant === "warning" && "bg-highlight text-highlight-foreground",
        variant === "destructive" &&
          "bg-destructive text-destructive-foreground",
      )}
    >
      {display}
    </span>
  );
}

const ITEM_ROW =
  "flex h-8 w-full items-center gap-3 rounded-md px-2 text-sm font-normal transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring";
const ITEM_INACTIVE =
  "text-sidebar-foreground hover:bg-white/5";
const ITEM_ACTIVE =
  "bg-sidebar-accent text-sidebar-accent-foreground";

function SidebarLink({
  item,
  active,
  counter,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  counter: React.ReactNode;
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICONS[item.iconKey];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(ITEM_ROW, active ? ITEM_ACTIVE : ITEM_INACTIVE)}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.labelDe}</span>
      {counter}
    </Link>
  );
}

function SidebarExpandable({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const children = item.children ?? [];
  const hasActiveChild = children.some((c) => isActive(pathname, c.href));
  const [expanded, setExpanded] = useState<boolean>(hasActiveChild);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ARTIKEL_STORAGE_KEY);
    // TODO(Lilian, Story 1.4 polish): React 19 lint flags setState-in-effect.
    // Consider deriving expanded state from props/localStorage at render time.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored !== null) setExpanded(stored === "true");
  }, []);

  useEffect(() => {
    // TODO(Lilian, Story 1.4 polish): mirror-prop-into-state antipattern.
    // Likely solvable by deriving `expanded` from `hasActiveChild` directly.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasActiveChild) setExpanded(true);
  }, [hasActiveChild]);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ARTIKEL_STORAGE_KEY, String(next));
      }
      return next;
    });
  };

  const Icon = NAV_ICONS[item.iconKey];
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={`sidebar-sub-${item.key}`}
        className={cn(ITEM_ROW, ITEM_INACTIVE, "text-left")}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{item.labelDe}</span>
        <ChevronIcon
          className="ml-auto h-4 w-4 shrink-0 text-sidebar-muted-foreground"
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <ul id={`sidebar-sub-${item.key}`} className="flex flex-col gap-0.5">
          {children.map((child) => (
            <SidebarSubItemRow
              key={child.key}
              child={child}
              active={isActive(pathname, child.href)}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SidebarSubItemRow({
  child,
  active,
  onNavigate,
}: {
  child: NavSubItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <li>
      <Link
        href={child.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "flex h-7 items-center rounded-md pl-10 pr-2 text-[13px] font-normal transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-white/5",
        )}
      >
        <span className="truncate">{child.labelDe}</span>
      </Link>
    </li>
  );
}

function SidebarSectionTitle({ label }: { label: string }) {
  return (
    <div className="px-2 pb-1 pt-3 text-xs font-medium text-sidebar-muted-foreground">
      {label}
    </div>
  );
}

function SidebarContent({
  items,
  pathname,
  counters,
  onNavigate,
}: {
  items: readonly NavItem[];
  pathname: string;
  counters: SidebarCounters;
  onNavigate?: () => void;
}) {
  let adminSectionRendered = false;

  return (
    <nav aria-label="Hauptnavigation" className="flex flex-1 flex-col gap-0.5">
      {items.map((item) => {
        const sectionTitle =
          item.adminSection && !adminSectionRendered ? (
            <SidebarSectionTitle key={`section-${item.key}`} label="Admin" />
          ) : null;
        // TODO(Lilian, Story 1.4 polish): mutating local var in render is flagged
        // by react-hooks/immutability. Consider precomputing the first-admin index
        // before the .map() and rendering the section title via index check.
        // eslint-disable-next-line react-hooks/immutability
        if (item.adminSection) adminSectionRendered = true;

        const node = item.children?.length ? (
          <SidebarExpandable
            item={item}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ) : (
          <SidebarLink
            item={item}
            active={isActive(pathname, item.href)}
            onNavigate={onNavigate}
            counter={
              item.counterKey ? (
                <SidebarCounter
                  count={counters[item.counterKey] ?? 0}
                  variant={COUNTER_VARIANT[item.counterKey]}
                />
              ) : null
            }
          />
        );

        return (
          <div key={item.key}>
            {sectionTitle}
            {node}
          </div>
        );
      })}
    </nav>
  );
}

function SidebarHeader({ role }: { role: AppRole }) {
  return (
    <div className="flex flex-col gap-1 px-2 pt-2">
      <Image
        src="/Heimelig_Logo_Weiss.png"
        alt="Heimelig"
        width={141}
        height={24}
        priority
      />
      <span className="text-xs text-sidebar-muted-foreground">
        {ROLE_LABELS_DE[role]}
      </span>
    </div>
  );
}

function SidebarFooter({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  const initials = getInitials(displayName, email);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Benutzermenü"
        className="mt-auto flex w-full items-center gap-3 rounded-md border-t border-sidebar-border px-2 py-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-sidebar-foreground"
        >
          {initials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-sidebar-foreground">
            {displayName}
          </span>
          <span className="truncate text-xs text-sidebar-muted-foreground">
            {email}
          </span>
        </span>
        <ChevronsUpDown
          className="h-4 w-4 shrink-0 text-sidebar-muted-foreground"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-56">
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">Persönliche Einstellungen</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-1 py-1">
          <LogoutButton />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SidebarNav({
  items,
  role,
  displayName,
  email,
  counters = {},
  drawerOpen,
  onCloseDrawer,
}: SidebarNavProps) {
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    onCloseDrawer();
    triggerRef.current?.focus();
  }, [onCloseDrawer]);

  useEffect(() => {
    if (!drawerOpen) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, handleClose]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen || !drawerRef.current) return;
    const panel = drawerRef.current;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    panel.addEventListener("keydown", trapFocus);
    return () => panel.removeEventListener("keydown", trapFocus);
  }, [drawerOpen]);

  const shellClasses =
    "flex h-svh w-60 shrink-0 flex-col gap-4 bg-sidebar p-2 text-sidebar-foreground";

  return (
    <>
      {/* Persistent sidebar (lg+) */}
      <aside className={cn("hidden lg:sticky lg:top-0 lg:flex", shellClasses)}>
        <SidebarHeader role={role} />
        <SidebarContent items={items} pathname={pathname} counters={counters} />
        <SidebarFooter displayName={displayName} email={email} />
      </aside>

      {/* Drawer (<lg) */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div
            role="presentation"
            onClick={handleClose}
            className="absolute inset-0 cursor-pointer bg-foreground/40"
          />
          <div ref={drawerRef} className={cn("relative max-w-[85%] shadow-xl", shellClasses)}>
            <div className="flex items-start justify-between gap-2">
              <SidebarHeader role={role} />
              <button
                type="button"
                onClick={handleClose}
                aria-label="Navigation schließen"
                className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-white/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <SidebarContent
              items={items}
              pathname={pathname}
              counters={counters}
              onNavigate={handleClose}
            />
            <SidebarFooter displayName={displayName} email={email} />
          </div>
        </div>
      ) : null}
    </>
  );
}
