// Story 3.5 — dedicated mobile-first shell for the warehouse QR scan page
// (D-SHELL 2026-05-04). This is the FIRST `(auth)` route group to bypass the
// parent's `<DesktopShell>` — every other `(auth)/...` group inherits the
// parent layout's sidebar chrome. The camera viewfinder needs the full
// viewport on a phone (≥80vh). `<DesktopShell>` reserves ~256px of sidebar
// space even when the drawer is closed; that geometry fights the camera
// surface and pushes the manual-entry fallback below the fold on small
// devices. Document the bypass here so future contributors don't replicate
// it by accident — every other multi-role page should use the parent shell.

import { Suspense } from "react";

import { TopBar } from "@/components/composed/top-bar";
import { loadShellSession } from "@/components/composed/shell-session";

async function ScanChrome({ children }: { children: React.ReactNode }) {
  const session = await loadShellSession();
  if (!session) {
    return <main className="p-4">{children}</main>;
  }
  return (
    <div className="flex min-h-svh w-full flex-col">
      <TopBar
        role={session.role}
        displayName={session.displayName}
        email={session.email}
        showWordmark
        showRoleBadge={false}
      />
      <main className="flex-1 px-4 py-4">{children}</main>
    </div>
  );
}

export default function ScanGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Do NOT render `{children}` inside the Suspense fallback — the scan page
  // mounts the camera on first render, and triggering the camera-permission
  // prompt before the auth chrome has resolved is jarring UX. Keep the
  // fallback content-free; once `loadShellSession()` resolves the page tree
  // mounts inside the proper chrome.
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center p-4 text-sm text-muted-foreground">
          Wird geladen…
        </main>
      }
    >
      <ScanChrome>{children}</ScanChrome>
    </Suspense>
  );
}
