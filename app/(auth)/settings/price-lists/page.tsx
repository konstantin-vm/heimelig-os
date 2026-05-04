import { Suspense } from "react";
import { redirect } from "next/navigation";

import { PageShell } from "@/components/composed";
import { PriceListDefinitionsTable } from "@/components/composed/price-list-definitions-table";
import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/supabase/session";

// Next 16 / cacheComponents: getClaims() reads the request cookie and is
// uncached dynamic data — must sit inside a Suspense boundary so the
// prerender pass does not abort. Same shape as settings/bexio/page.tsx.
async function PriceListsBody() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const role = getSessionRole(claimsData?.claims ?? null);
  if (role !== "admin") {
    redirect("/dashboard");
  }
  return <PriceListDefinitionsTable />;
}

export default function PriceListsSettingsPage() {
  return (
    <PageShell
      title="Preislisten"
      subtitle="Eigene Preislisten anlegen, umbenennen, deaktivieren. System-Preislisten (Privat, Helsana, Sanitas, Visana, KPT) sind dauerhaft."
      backHref="/settings"
    >
      <Suspense fallback={null}>
        <PriceListsBody />
      </Suspense>
    </PageShell>
  );
}
