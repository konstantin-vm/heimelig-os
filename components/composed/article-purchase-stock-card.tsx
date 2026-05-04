"use client";

// <ArticlePurchaseStockCard> — Story 3.2 / Epic AC2.
//
// Rendered inside `<ArticleProfileShell>` when the article is purchase-only
// (`is_sellable=true && !is_rentable`). The MVP does not track per-device
// inventory for purchase-only articles, so the card surfaces a single
// "Lagerbestand" row with an em-dash + a footnote pointing operators at
// bexio for stock visibility.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { DefinitionRow } from "./definition-row";

export type ArticlePurchaseStockCardProps = {
  /**
   * Reserved for future stock-source wiring (bexio pull). Accepted for API
   * stability — the MVP card body doesn't read from it yet.
   */
  articleId: string;
};

export function ArticlePurchaseStockCard(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _props: ArticlePurchaseStockCardProps,
) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Bestand</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <DefinitionRow label="Lagerbestand" value="—" emptyPlaceholder="—" />
        <p className="text-xs text-muted-foreground">
          Stückzahl wird im MVP nicht im System geführt — Bestandsübersicht
          via bexio.
        </p>
      </CardContent>
    </Card>
  );
}
