"use client";

import { Suspense, use } from "react";
import { useRouter } from "next/navigation";

import { ArticleEditForm, PageShell } from "@/components/composed";

type RouteParams = Promise<{ id: string }>;

// Convenience deep-link to the edit form for a specific article id.

export default function EditArticlePage({ params }: { params: RouteParams }) {
  return (
    <Suspense fallback={<EditFallback />}>
      <EditArticleBody params={params} />
    </Suspense>
  );
}

function EditArticleBody({ params }: { params: RouteParams }) {
  const { id } = use(params);
  const router = useRouter();

  return (
    <PageShell title="Artikel bearbeiten" backHref={`/articles/${id}`}>
      <ArticleEditForm
        mode="edit"
        articleId={id}
        open
        onOpenChange={(open) => {
          if (!open) router.push(`/articles/${id}`);
        }}
      />
    </PageShell>
  );
}

function EditFallback() {
  return (
    <PageShell title="Artikel bearbeiten" backHref="/articles">
      <p className="text-sm text-muted-foreground">Daten werden geladen…</p>
    </PageShell>
  );
}
