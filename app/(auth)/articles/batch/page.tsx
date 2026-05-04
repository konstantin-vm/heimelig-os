// Story 3.6 — S-015 Sammelregistrierung page (`/articles/batch`).
//
// Server component. Reads the optional `?articleId=...` query param to
// preselect the article in the form, falling back to a free-form pick.
// Page-level role guard returns 404 for technician — defense-in-depth on top
// of the article-devices-card hide that already keeps the entry-point
// invisible for that role.

import { Suspense } from "react";
import { notFound } from "next/navigation";

import { BatchRegisterForm } from "@/components/composed/batch-register-form";
import { PageShell } from "@/components/composed/page-shell";
import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/supabase/session";
import { uuidSchema } from "@/lib/validations/common";

export const metadata = {
  title: "Sammelregistrierung",
};

export default async function BatchRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ articleId?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawArticleId = Array.isArray(params.articleId)
    ? params.articleId[0]
    : params.articleId;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const role = getSessionRole(claimsData?.claims ?? null);

  // Technician + unauthenticated land here only via direct URL — surface a
  // 404 rather than 403 so the route's existence isn't enumerable.
  if (role === null || role === "technician") {
    notFound();
  }

  const preselectedArticleId =
    rawArticleId && uuidSchema.safeParse(rawArticleId).success
      ? rawArticleId
      : null;

  return (
    <Suspense
      fallback={
        <p className="py-8 text-center text-sm text-muted-foreground">
          Daten werden geladen…
        </p>
      }
    >
      <PageShell
        title="Sammelregistrierung"
        subtitle="Mehrere Geräte eines Artikels in einem transaktionalen Schritt anlegen."
        backHref={
          preselectedArticleId ? `/articles/${preselectedArticleId}` : "/articles"
        }
      >
        <BatchRegisterForm preselectedArticleId={preselectedArticleId} />
      </PageShell>
    </Suspense>
  );
}
