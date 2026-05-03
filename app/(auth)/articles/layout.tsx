import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/supabase/session";

// Defense-in-depth: sidebar already excludes technician from /articles, but
// a deep-linked URL must not leak an empty-state catalog (RLS denies the
// SELECT silently → 0 rows). The technician_articles view exists for a
// future role-aware reader (Story 3.2), so we redirect here rather than
// switching the query source. Admin / office / warehouse stay on the page.
export default async function ArticlesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const role = getSessionRole(claimsData?.claims ?? null);
  if (role === "technician") {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
