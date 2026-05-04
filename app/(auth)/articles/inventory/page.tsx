"use client";

// /articles/inventory — Story 3.4 inventory grid (S-010 NEW route).
//
// Sibling page to the Story-3.1 `/articles` catalog table. The
// `app/(auth)/articles/layout.tsx` route guard from Story 3.1 already
// redirects technician → /dashboard, so no separate layout is needed.
//
// Threshold edits route through the existing `<ArticleEditForm>` (Story
// 3.1) — opened by the modal coordinator in `<InventoryPageBody>`. No
// new edit UI in 3.4.

import { Suspense, useState } from "react";

import {
  ArticleEditForm,
  InventoryFilters,
  InventoryGrid,
  PageHeader,
  PageShell,
} from "@/components/composed";
import { useInventoryTotalCount } from "@/lib/queries/inventory";

type ThresholdModalState =
  | { mode: "closed" }
  | { mode: "edit"; articleId: string };

export default function InventoryPage() {
  return (
    <PageShell title="Inventar">
      <Suspense
        fallback={
          <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
            Lade Inventar…
          </p>
        }
      >
        <InventoryPageBody />
      </Suspense>
    </PageShell>
  );
}

function InventoryPageBody() {
  const [modal, setModal] = useState<ThresholdModalState>({ mode: "closed" });
  const [searchTerm, setSearchTerm] = useState("");
  const { data: totalCount } = useInventoryTotalCount();

  const handleOpenChange = (open: boolean) => {
    if (!open) setModal({ mode: "closed" });
  };

  return (
    <>
      <PageHeader title="Inventar" count={totalCount ?? null} />

      <InventoryFilters
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
      />

      <InventoryGrid
        searchTerm={searchTerm}
        onClearSearchTerm={() => setSearchTerm("")}
        onConfigureThresholds={(articleId) =>
          setModal({ mode: "edit", articleId })
        }
      />

      {modal.mode === "edit" ? (
        <ArticleEditForm
          key={modal.articleId}
          mode="edit"
          articleId={modal.articleId}
          open
          onOpenChange={handleOpenChange}
        />
      ) : null}
    </>
  );
}
