import { Suspense } from "react";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/composed";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/utils/error-log";
import { uuidSchema } from "@/lib/validations/common";

import { DeviceProfileShell } from "./_components/device-profile-shell";

type RouteParams = Promise<{ id: string }>;

export default function DeviceProfilePage({ params }: { params: RouteParams }) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <DeviceProfileBody params={params} />
    </Suspense>
  );
}

async function DeviceProfileBody({ params }: { params: RouteParams }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    notFound();
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("devices")
    .select(
      "id, serial_number, article_id, articles(article_number, name, variant_label)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    await logError(
      {
        errorType: "DB_FUNCTION",
        severity: "error",
        source: "device-profile",
        message: "device profile load failed",
        details: {
          device_id: id,
          operation: "load",
          code: error.code ?? null,
        },
        entity: "devices",
        entityId: id,
      },
      supabase,
    );
    throw new Error("Gerät konnte nicht geladen werden.");
  }

  if (!data) {
    notFound();
  }

  // PostgREST types embedded selects as arrays; the FK is many-to-one so we
  // unwrap to the first element. Both array and single-object shapes have
  // been observed depending on supabase-js codegen.
  const articleRaw = data.articles as
    | { article_number: string; name: string; variant_label: string | null }
    | { article_number: string; name: string; variant_label: string | null }[]
    | null;
  const article = Array.isArray(articleRaw) ? articleRaw[0] ?? null : articleRaw;
  const articleLabel = article
    ? [article.article_number, article.name, article.variant_label]
        .filter(Boolean)
        .join(" ")
    : "";
  const label = articleLabel
    ? `${data.serial_number} — ${articleLabel}`
    : data.serial_number;

  return (
    <PageShell title={label} backHref={`/articles/${data.article_id}`}>
      <DeviceProfileShell deviceId={data.id} label={label} />
    </PageShell>
  );
}

function ProfileSkeleton() {
  return (
    <PageShell title="Gerät">
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Daten werden geladen…
      </div>
    </PageShell>
  );
}
