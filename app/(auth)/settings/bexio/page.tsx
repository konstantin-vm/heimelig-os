import { Suspense } from "react";
import { redirect } from "next/navigation";

import { BexioStatusCard } from "./_components/bexio-status-card";
import { PageShell } from "@/components/composed";
import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/supabase/session";
import { logError } from "@/lib/utils/error-log";
import {
  bexioCredentialsStatusSchema,
  type BexioCredentialsStatus,
} from "@/lib/validations/bexio-credentials";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function BexioSettingsPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<BexioSkeleton />}>
      <BexioSettingsBody searchParams={searchParams} />
    </Suspense>
  );
}

async function BexioSettingsBody({ searchParams }: PageProps) {
  const supabase = await createClient();

  // Defense in depth — middleware already gates /settings/* to admins, but
  // re-verify here so a future routing change can't accidentally widen access.
  const { data: claimsData } = await supabase.auth.getClaims();
  const role = getSessionRole(claimsData?.claims ?? null);
  if (role !== "admin") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const flash = (() => {
    if (params.connected === "1") return { type: "connected" as const };
    const errParam = params.error;
    if (typeof errParam === "string" && errParam.length > 0) {
      return { type: "error" as const, code: errParam };
    }
    return null;
  })();

  let status: BexioCredentialsStatus | null = null;
  const { data, error } = await supabase.rpc(
    "bexio_credentials_status_for_admin",
  );

  if (error) {
    await logError(
      {
        errorType: "DB_FUNCTION",
        severity: "error",
        source: "settings-bexio",
        message: `bexio_credentials_status_for_admin failed: ${error.message}`,
        details: { actor_system: "other", code: error.code ?? null },
      },
      supabase,
    );
  } else if (data && data.length > 0) {
    const parsed = bexioCredentialsStatusSchema.safeParse(data[0]);
    if (parsed.success) {
      status = parsed.data;
    } else {
      await logError(
        {
          errorType: "VALIDATION",
          severity: "warning",
          source: "settings-bexio",
          message: "bexio_credentials_status row failed schema validation",
          details: { actor_system: "other" },
        },
        supabase,
      );
    }
  }

  return (
    <PageShell title="bexio-Verbindung" backHref="/settings">
      <BexioStatusCard status={status} flash={flash} />
    </PageShell>
  );
}

function BexioSkeleton() {
  return (
    <PageShell title="bexio-Verbindung" backHref="/settings">
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Wird geladen…
      </div>
    </PageShell>
  );
}
