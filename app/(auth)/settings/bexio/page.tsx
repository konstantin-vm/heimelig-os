import { Suspense } from "react";
import { unstable_noStore as noStore } from "next/cache";
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

// Allowlist of OAuth error codes the callback / Edge Functions emit. Anything
// else is rendered with the generic German fallback to avoid arbitrary text
// in the URL bar leaking into the UI.
const KNOWN_ERROR_CODES = new Set([
  "consent",
  "exchange_failed",
  "encrypt_failed",
  "persist_failed",
  "state_invalid_or_expired",
]);

export default function BexioSettingsPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<BexioSkeleton />}>
      <BexioSettingsBody searchParams={searchParams} />
    </Suspense>
  );
}

async function BexioSettingsBody({ searchParams }: PageProps) {
  // The active credential status is admin-only metadata that must be a fresh
  // read on every render — never cached at the Vercel edge. Combined with
  // Next 16 cacheComponents this prevents stale "Nicht verbunden" after a
  // successful ?connected=1 redirect.
  noStore();

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
      const code = KNOWN_ERROR_CODES.has(errParam) ? errParam : "unknown";
      return { type: "error" as const, code };
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
        details: { code: error.code ?? null },
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
