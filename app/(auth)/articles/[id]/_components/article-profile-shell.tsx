"use client";

import { Suspense, useState } from "react";

import {
  ArticleDevicesCard,
  ArticleEditForm,
  ArticleInfoCard,
  ArticleProfileHeader,
  ArticlePurchaseStockCard,
  PriceListCard,
} from "@/components/composed";
import {
  PAGE_HEADER_PRIORITY,
  useSetPageHeader,
} from "@/lib/contexts/page-header-context";
import { useAppRole } from "@/lib/hooks/use-app-role";

export type ArticleProfileShellProps = {
  articleId: string;
  /** Title-line label (article_number — name [variant]) computed server-side. */
  label: string;
  isRentable: boolean;
  isSellable: boolean;
};

export function ArticleProfileShell({
  articleId,
  label,
  isRentable,
  isSellable,
}: ArticleProfileShellProps) {
  const [editOpen, setEditOpen] = useState(false);
  const { data: role } = useAppRole();
  const showPrices = role !== "warehouse" && role !== "technician";

  // Top bar: "Artikel / 1234 — Pflegebett (variant)" — entity label in the
  // current-page slot. The auto-resolver can't know the article identifier,
  // so the page provides the breadcrumb at override priority.
  useSetPageHeader(
    {
      breadcrumb: [
        { label: "Artikel", href: "/articles" },
        { label },
      ],
    },
    PAGE_HEADER_PRIORITY.override,
  );

  // Card selector — Story 3.2 epic AC1 + AC2:
  //   * Rentable (or dual-mode rentable+sellable) → `<ArticleDevicesCard>`.
  //     For dual-mode articles the rental tracking takes precedence; the
  //     sale path picks `is_new=true` devices per MTG-009.
  //   * Purchase-only (`is_sellable && !is_rentable`) → `<ArticlePurchaseStockCard>`.
  //   * Neither (e.g. service) → no inventory card.
  const inventoryCard = isRentable ? (
    <ArticleDevicesCard articleId={articleId} />
  ) : isSellable ? (
    <ArticlePurchaseStockCard articleId={articleId} />
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <ArticleProfileHeader
        articleId={articleId}
        onEdit={() => setEditOpen(true)}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <ArticleInfoCard articleId={articleId} onEdit={() => setEditOpen(true)} />
          {showPrices ? <PriceListCard articleId={articleId} /> : null}
        </div>
        <div className="flex flex-col gap-6">
          {/* `<ArticleDevicesCard>` reads the URL query via useSearchParams
              (filters, sort, pagination) — Next 16 cacheComponents requires
              that to live behind a Suspense boundary so the rest of the
              page can prerender independently. */}
          <Suspense
            fallback={
              <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
                Geräte werden geladen…
              </div>
            }
          >
            {inventoryCard}
          </Suspense>
        </div>
      </div>

      {editOpen ? (
        <ArticleEditForm
          mode="edit"
          articleId={articleId}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      ) : null}
    </div>
  );
}
