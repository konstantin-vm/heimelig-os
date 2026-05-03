import { Suspense } from "react";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/composed";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/utils/error-log";
import { uuidSchema } from "@/lib/validations/common";

import { ArticleProfileShell } from "./_components/article-profile-shell";

type RouteParams = Promise<{ id: string }>;

export default function ArticleProfilePage({
  params,
}: {
  params: RouteParams;
}) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ArticleProfileBody params={params} />
    </Suspense>
  );
}

async function ArticleProfileBody({ params }: { params: RouteParams }) {
  const { id } = await params;
  // Validate the path param as a UUID before querying — otherwise PostgREST
  // raises 22P02 "invalid input syntax for type uuid" which would surface as
  // a server error instead of a clean 404.
  if (!uuidSchema.safeParse(id).success) {
    notFound();
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .select("id, article_number, name, variant_label, is_rentable")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    await logError(
      {
        errorType: "DB_FUNCTION",
        severity: "error",
        source: "article-profile",
        message: "article profile load failed",
        details: {
          article_id: id,
          operation: "load",
          code: error.code ?? null,
        },
        entity: "articles",
        entityId: id,
      },
      supabase,
    );
    // Avoid leaking the raw Postgres error message to the client error
    // boundary — `logError` already captured the technical detail.
    throw new Error("Artikel konnte nicht geladen werden.");
  }

  if (!data) {
    notFound();
  }

  const label = `${data.article_number} — ${data.name}${
    data.variant_label ? ` ${data.variant_label}` : ""
  }`;

  return (
    <PageShell title={label} backHref="/articles">
      <ArticleProfileShell
        articleId={data.id}
        label={label}
        isRentable={data.is_rentable}
      />
    </PageShell>
  );
}

function ProfileSkeleton() {
  return (
    <PageShell title="Artikel" backHref="/articles">
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Daten werden geladen…
      </div>
    </PageShell>
  );
}
