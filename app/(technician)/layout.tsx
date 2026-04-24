import { Suspense } from "react";

import { MobileShell } from "@/components/composed/mobile-shell";
import { loadShellSession } from "@/components/composed/shell-session";

async function MobileChrome({ children }: { children: React.ReactNode }) {
  const session = await loadShellSession();
  if (!session) {
    return <main className="p-4">{children}</main>;
  }
  return (
    <MobileShell
      role={session.role}
      displayName={session.displayName}
      email={session.email}
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
