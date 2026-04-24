"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import type { NavItem } from "@/lib/constants/navigation";
import { BRAND_WORDMARK } from "@/lib/constants/brand";
import { cn } from "@/lib/utils";

type SidebarNavProps = {
  items: readonly NavItem[];
  drawerOpen: boolean;
  onCloseDrawer: () => void;
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({
  items,
  pathname,
  onNavigate,
}: {
  items: readonly NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-1 px-3 py-2">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>{item.labelDe}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({
  items,
  drawerOpen,
  onCloseDrawer,
}: SidebarNavProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, onCloseDrawer]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  return (
    <>
      {/* Persistent sidebar (lg+) */}
      <aside className="hidden w-60 shrink-0 border-r bg-background lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col">
        <div className="flex h-16 items-center border-b px-5 text-base font-semibold">
          {BRAND_WORDMARK}
        </div>
        <nav
          aria-label="Hauptnavigation"
          className="flex-1 overflow-y-auto py-2"
        >
          <NavList items={items} pathname={pathname} />
        </nav>
      </aside>

      {/* Drawer (<lg) */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            aria-label="Navigation schließen"
            onClick={onCloseDrawer}
            className="absolute inset-0 bg-foreground/40"
          />
          <div className="relative flex h-full w-72 max-w-[85%] flex-col border-r bg-background shadow-xl">
            <div className="flex h-16 items-center justify-between border-b px-4">
              <span className="text-base font-semibold">{BRAND_WORDMARK}</span>
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Navigation schließen"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav
              aria-label="Hauptnavigation"
              className="flex-1 overflow-y-auto py-2"
            >
              <NavList
                items={items}
                pathname={pathname}
                onNavigate={onCloseDrawer}
              />
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
