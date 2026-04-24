import { Suspense } from "react";

import { MobileShell } from "@/components/composed/mobile-shell";
import { loadShellSession } from "@/components/composed/shell-session";
import { navItemsFor } from "@/lib/constants/navigation";

async function MobileChrome({ children }: { children: React.ReactNode }) {
  const session = await loadShellSession();
  if (!session) {
    return <main className="p-4">{children}</main>;
  }
  const items = navItemsFor(session.role).filter((i) => i.shell === "mobile");
  return (
    <MobileShell
      role={session.role}
      displayName={session.displayName}
      email={session.email}
      items={items}
    >
      {children}
    </MobileShell>
  );
}

export default function TechnicianGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<main className="p-4">{children}</main>}>
      <MobileChrome>{children}</MobileChrome>
    </Suspense>
  );
}
