import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/supabase/session";

// Story 3.2 / AC-RLS(d): explicit route guard for `/devices/*`. Mirrors the
// `/articles/layout.tsx` decision (Story 3.1) — admin / office / warehouse
// stay on the page; technician redirects to `/dashboard`. RLS on `devices`
// already denies SELECT for technician at the database layer; this guard
// keeps the deep-linked URL from rendering an empty-state shell.
//
// Next 16 / cacheComponents: `getClaims()` reads the request cookie, which
// counts as uncached dynamic data. Without an enclosing Suspense the
// prerender pass for any child route fails with "Uncached data was accessed
// outside of <Suspense>". The guard renders no UI of its own (it either
// `redirect()`s or returns `children`), so a transparent Suspense boundary
// preserves behaviour while unblocking child-segment prerender.
async function DevicesGuard({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  // Fail closed on a claims-read error (e.g. token rotation race) — without
  // a valid role we cannot make a routing decision, so redirect to /login
  // rather than letting the page render with an undefined role.
  if (claimsError || !claimsData?.claims) {
    redirect("/login");
  }
  const role = getSessionRole(claimsData.claims);
  if (role === "technician") {
    redirect("/dashboard");
  }
  return <>{children}</>;
}

export default function DevicesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <DevicesGuard>{children}</DevicesGuard>
    </Suspense>
  );
}
