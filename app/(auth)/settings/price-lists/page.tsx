import { redirect } from "next/navigation";

import { PageShell } from "@/components/composed";
import { PriceListDefinitionsTable } from "@/components/composed/price-list-definitions-table";
import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/supabase/session";

// Story 3.1.1 — admin-only price-list catalogue management.
// David's kickoff wish (16.04.): "Ich kann selbst eine Preisliste hinzufügen,
// relativ einfach." Middleware (`lib/supabase/proxy.ts`) already gates
// /settings/* to admin via ROLE_ALLOWED_PATHS; the role re-check below is
// defense-in-depth so a future routing change cannot accidentally widen
// access.

export default async function PriceListsSettingsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const role = getSessionRole(claimsData?.claims ?? null);
  if (role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <PageShell
      title="Preislisten"
      subtitle="Eigene Preislisten anlegen, umbenennen, deaktivieren. System-Preislisten (Privat, Helsana, Sanitas, Visana, KPT) sind dauerhaft."
      backHref="/settings"
    >
      <PriceListDefinitionsTable />
    </PageShell>
  );
}
