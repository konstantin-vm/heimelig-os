import type { AppRole } from "@/lib/constants/roles";

import { BottomNav } from "./bottom-nav";
import { TopBar } from "./top-bar";

type MobileShellProps = {
  role: AppRole;
  displayName: string;
  email: string;
  children: React.ReactNode;
};

export function MobileShell({
  role,
  displayName,
  email,
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
      <BottomNav role={role} />
    </div>
  );
}
