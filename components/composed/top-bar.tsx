import { BRAND_WORDMARK } from "@/lib/constants/brand";
import type { AppRole } from "@/lib/constants/roles";

import { UserMenu } from "./user-menu";

type TopBarProps = {
  role: AppRole;
  displayName: string;
  email: string;
  showRoleBadge?: boolean;
  leadingSlot?: React.ReactNode;
  showWordmark?: boolean;
};

export function TopBar({
  role,
  displayName,
  email,
  showRoleBadge = true,
  leadingSlot,
  showWordmark = false,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center gap-3 border-b bg-background px-4">
      {leadingSlot}
      {showWordmark ? (
        <span className="text-base font-semibold">{BRAND_WORDMARK}</span>
      ) : (
        <span className="sr-only">{BRAND_WORDMARK}</span>
      )}
      <div className="ml-auto">
        <UserMenu
          role={role}
          displayName={displayName}
          email={email}
          showRoleBadge={showRoleBadge}
        />
      </div>
    </header>
  );
}
