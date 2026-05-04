"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import type { NavItem } from "@/lib/constants/navigation";
import type { AppRole } from "@/lib/constants/roles";
import { BRAND_WORDMARK } from "@/lib/constants/brand";
import { PageHeaderProvider } from "@/lib/contexts/page-header-context";

import { DesktopTopBar } from "./desktop-top-bar";
import { SidebarNav, type SidebarCounters } from "./sidebar-nav";
import { TopBar } from "./top-bar";

type DesktopShellProps = {
  role: AppRole;
  displayName: string;
  email: string;
  items: readonly NavItem[];
  counters?: SidebarCounters;
  children: React.ReactNode;
};

export function DesktopShell({
  role,
  displayName,
  email,
  items,
  counters,
  children,
}: DesktopShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <PageHeaderProvider>
    <div className="flex min-h-svh w-full">
      <SidebarNav
        items={items}
        role={role}
        displayName={displayName}
        email={email}
        counters={counters}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-only top bar: menu trigger + compact user avatar. On lg+ the
            sidebar footer owns the user menu, so the top bar is hidden. */}
        <div className="lg:hidden">
          <TopBar
            role={role}
            displayName={displayName}
            email={email}
            showRoleBadge
            leadingSlot={
              <>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Navigation öffnen"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </button>
                <span className="text-base font-semibold">
                  {BRAND_WORDMARK}
                </span>
              </>
            }
          />
        </div>
        {/* Desktop-only top bar: breadcrumb + bell. Aligned with Pencil
            S-005 / customer-profile design context (h-16, white, border-b). */}
        <div className="hidden lg:block">
          <DesktopTopBar items={items} />
        </div>
        <main className="flex-1 bg-secondary px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
    </PageHeaderProvider>
  );
}
