"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import type { NavItem } from "@/lib/constants/navigation";
import type { AppRole } from "@/lib/constants/roles";

import { SidebarNav } from "./sidebar-nav";
import { TopBar } from "./top-bar";

type DesktopShellProps = {
  role: AppRole;
  displayName: string;
  email: string;
  items: readonly NavItem[];
  children: React.ReactNode;
};

export function DesktopShell({
  role,
  displayName,
  email,
  items,
  children,
}: DesktopShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-svh w-full">
      <SidebarNav
        items={items}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          role={role}
          displayName={displayName}
          email={email}
          showRoleBadge
          showWordmark
          leadingSlot={
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Navigation öffnen"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          }
        />
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
