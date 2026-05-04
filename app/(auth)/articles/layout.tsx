import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/supabase/session";

// Defense-in-depth: sidebar already excludes technician from /articles, but
// a deep-linked URL must not leak an empty-state catalog (RLS denies the
// SELECT silently → 0 rows). The technician_articles view exists for a
// future role-aware reader (Story 3.2), so we redirect here rather than
// switching the query source. Admin / office / warehouse stay on the page.
//
// Next 16 / cacheComponents: `getClaims()` reads the request cookie and
// is therefore uncached dynamic data. Without an enclosing Suspense the
// prerender pass for any child route ( /articles/[id], /articles/new, … )
// fails with "Uncached data was accessed outside of <Suspense>". The
// guard itself never renders UI — its only output is a `redirect()` for
// technician or `children` otherwise — so streaming it through a
// transparent Suspense boundary preserves behaviour while letting the
// child segment prerender its own shell.
async function ArticlesGuard({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const role = getSessionRole(claimsData?.claims ?? null);
  if (role === "technician") {
    redirect("/dashboard");
  }
  return <>{children}</>;
}

export default function ArticlesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <ArticlesGuard>{children}</ArticlesGuard>
    </Suspense>
  );
}
