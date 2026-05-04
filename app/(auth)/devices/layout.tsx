import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/supabase/session";

// Story 3.2 / AC-RLS(d): explicit route guard for `/devices/*`. Mirrors the
// `/articles/layout.tsx` decision (Story 3.1) — admin / office / warehouse
// stay on the page; technician redirects to `/dashboard`. RLS on `devices`
// already denies SELECT for technician at the database layer; this guard
// keeps the deep-linked URL from rendering an empty-state shell.
export default async function DevicesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
