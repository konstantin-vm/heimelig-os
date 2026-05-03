"use client";

import { Suspense, useState } from "react";
import { Plus } from "lucide-react";

import {
  ArticleEditForm,
  ArticleListFilters,
  ArticleTable,
  PageHeader,
  PageShell,
} from "@/components/composed";
import { Button } from "@/components/ui/button";
import { useAppRole } from "@/lib/hooks/use-app-role";
import { useArticlesTotalCount } from "@/lib/queries/articles";

type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; articleId: string };

export default function ArticlesPage() {
  return (
    <PageShell title="Artikel">
      <Suspense
        fallback={
          <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
            Lade Artikel…
          </p>
        }
      >
        <ArticlesPageBody />
      </Suspense>
    </PageShell>
  );
}

function ArticlesPageBody() {
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [searchTerm, setSearchTerm] = useState("");
  const { data: totalCount } = useArticlesTotalCount();
  const { data: role } = useAppRole();

  const handleOpenChange = (open: boolean) => {
    if (!open) setModal({ mode: "closed" });
  };

  // Warehouse + technician roles do not own the article-catalog workflow
  // (Q1 — `docs/internal/open-questions/2026-04-28_weekly.md`). RLS allows
  // warehouse to INSERT/UPDATE for technical reasons, but the create CTA is
  // hidden to align the UI with documented role separation.
  // While `useAppRole` is loading (`role === undefined`), suppress the
  // button entirely — both `canCreate=false` (flash of nothing) and a
  // permissive default would be wrong. The header layout doesn't reserve
  // space for the action, so a brief absence is acceptable, while keeping
  // unauthorised users from seeing a pre-populated CTA.
  const canCreate = role === "admin" || role === "office";
  const showCreateButton = role !== undefined && canCreate;

  return (
    <>
      <PageHeader
        title="Artikel"
        count={totalCount ?? null}
        actions={
          showCreateButton ? (
            <Button onClick={() => setModal({ mode: "create" })}>
              <Plus className="h-4 w-4" />
              Neuer Artikel
            </Button>
          ) : null
        }
      />

      <ArticleListFilters
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
      />

      <ArticleTable
        searchTerm={searchTerm}
        onClearSearchTerm={() => setSearchTerm("")}
        onEdit={(articleId) => setModal({ mode: "edit", articleId })}
      />

      {modal.mode !== "closed" ? (
        <ArticleEditForm
          key={modal.mode === "edit" ? modal.articleId : "create"}
          mode={modal.mode}
          articleId={modal.mode === "edit" ? modal.articleId : null}
          open
          onOpenChange={handleOpenChange}
        />
      ) : null}
    </>
  );
}
