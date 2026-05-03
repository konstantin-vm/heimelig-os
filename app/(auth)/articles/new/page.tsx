"use client";

import { useRouter } from "next/navigation";

import { ArticleEditForm, PageShell } from "@/components/composed";

// Convenience deep-link to the create form. The dialog's open state is local;
// closing it routes back to /articles. Mirrors the customer-domain shell
// conventions where create/edit deep-links are thin client wrappers.

export default function NewArticlePage() {
  const router = useRouter();

  return (
    <PageShell title="Neuer Artikel" backHref="/articles">
      <ArticleEditForm
        mode="create"
        open
        onOpenChange={(open) => {
          if (!open) router.push("/articles");
        }}
      />
    </PageShell>
  );
}
