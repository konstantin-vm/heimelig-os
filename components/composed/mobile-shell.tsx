import type { NavItem } from "@/lib/constants/navigation";
import type { AppRole } from "@/lib/constants/roles";

import { BottomNav } from "./bottom-nav";
import { TopBar } from "./top-bar";

type MobileShellProps = {
  role: AppRole;
  displayName: string;
  email: string;
  items: readonly NavItem[];
  children: React.ReactNode;
};

export function MobileShell({
  role,
  displayName,
  email,
  items,
  children,
}: MobileShellProps) {
  return (
    <div className="flex min-h-svh w-full flex-col">
      <TopBar
        role={role}
        displayName={displayName}
        email={email}
        showRoleBadge={false}
        showWordmark
      />
      <main className="flex-1 px-4 py-4 pb-24">{children}</main>
      <BottomNav items={items} />
    </div>
  );
}
