import { Suspense } from "react";
import { notFound } from "next/navigation";

import {
  CustomerAddressesCard,
  CustomerContactsCard,
  CustomerInsuranceCard,
  PageShell,
} from "@/components/composed";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/utils/error-log";

// Story 2.2 stub. Story 2.5 will replace the body with the full S-004 layout
// (info, insurance, bexio, devices, orders cards). The Kontakte card stays
// as-is.

type RouteParams = Promise<{ id: string }>;

export default function CustomerProfilePage({
  params,
}: {
  params: RouteParams;
}) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <CustomerProfileBody params={params} />
    </Suspense>
  );
}

async function CustomerProfileBody({ params }: { params: RouteParams }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, company_name, customer_type")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    await logError(
      {
        errorType: "DB_FUNCTION",
        severity: "error",
        source: "customer-profile",
        message: error.message,
        details: {
          customer_id: id,
          operation: "load",
          code: error.code ?? null,
        },
        entity: "customers",
        entityId: id,
      },
      supabase,
    );
    throw error;
  }

  if (!data) {
    notFound();
  }

  const fullName =
    data.customer_type === "private"
      ? [data.last_name, data.first_name].filter(Boolean).join(", ") ||
        "Kunde"
      : data.company_name || "Kunde";

  return (
    <PageShell title={fullName} backHref="/customers">
      <div className="flex flex-col gap-6">
        <CustomerContactsCard customerId={data.id} customerLabel={fullName} />
        <CustomerInsuranceCard customerId={data.id} customerLabel={fullName} />
        <CustomerAddressesCard customerId={data.id} customerLabel={fullName} />
      </div>
    </PageShell>
  );
}

function ProfileSkeleton() {
  return (
    <PageShell title="Kunde" backHref="/customers">
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Daten werden geladen…
      </div>
    </PageShell>
  );
}
