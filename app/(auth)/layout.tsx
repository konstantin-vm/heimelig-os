import { Suspense } from "react";

import { DesktopShell } from "@/components/composed/desktop-shell";
import { loadShellSession } from "@/components/composed/shell-session";
import { navItemsFor } from "@/lib/constants/navigation";

async function DesktopChrome({ children }: { children: React.ReactNode }) {
  const session = await loadShellSession();
  if (!session) {
    // proxy.ts normally prevents this; render children bare as a safe fallback.
    return <main className="p-6">{children}</main>;
  }
  return (
    <DesktopShell
      role={session.role}
      displayName={session.displayName}
      email={session.email}
      items={navItemsFor(session.role)}
    >
      {children}
    </DesktopShell>
  );
}

export default function DesktopGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<main className="p-6">{children}</main>}>
      <DesktopChrome>{children}</DesktopChrome>
    </Suspense>
  );
}
