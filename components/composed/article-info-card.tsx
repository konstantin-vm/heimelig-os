"use client";

import { useEffect, useId } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  articleCategoryLabels,
  articleTypeLabels,
  articleUnitLabels,
  articleVatRateLabels,
} from "@/lib/constants/article";
import { useAppRole } from "@/lib/hooks/use-app-role";
import { articleKeys, useArticle } from "@/lib/queries/articles";
import { createClient } from "@/lib/supabase/client";
import { formatChf } from "@/lib/utils/format";

import { DefinitionRow } from "./definition-row";

export type ArticleInfoCardProps = {
  articleId: string;
  /** Click handler — opens the shared <ArticleEditForm> modal in edit mode. */
  onEdit: () => void;
};

export function ArticleInfoCard({ articleId, onEdit }: ArticleInfoCardProps) {
  const { data: article, isLoading, isError } = useArticle(articleId);
  const { data: role } = useAppRole();
  const queryClient = useQueryClient();
  const channelSuffix = useId();

  // Realtime — invalidate this article's detail cache on any matching row
  // mutation. Mirrors the customer-info-card pattern.
  useEffect(() => {
    if (!articleId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`articles:detail:${articleId}:${channelSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "articles",
          filter: `id=eq.${articleId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: articleKeys.detail(articleId),
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [articleId, channelSuffix, queryClient]);

  const isWarehouse = role === "warehouse";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle>Artikelinformationen</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Artikel bearbeiten"
          title="Artikel bearbeiten"
          onClick={onEdit}
        >
          <Pencil aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">
            Daten werden geladen…
          </p>
        ) : isError || !article ? (
          <p className="py-4 text-sm text-destructive">
            Artikeldaten konnten nicht geladen werden.
          </p>
        ) : (
          <>
            <DefinitionRow label="Name" value={article.name} />
            <DefinitionRow
              label="Beschreibung"
              value={article.description}
              preserveWhitespace
            />
            <DefinitionRow
              label="Kategorie"
              value={articleCategoryLabels[article.category]}
            />
            <DefinitionRow
              label="Typ"
              value={articleTypeLabels[article.type]}
            />
            <DefinitionRow
              label="Verwendung"
              value={
                article.type === "service"
                  ? "Dienstleistung"
                  : [
                      article.is_rentable ? "Vermietbar" : null,
                      article.is_sellable ? "Verkaufbar" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"
              }
            />
            <DefinitionRow
              label="Einheit"
              value={articleUnitLabels[article.unit]}
            />
            <DefinitionRow label="Hersteller" value={article.manufacturer} />
            <DefinitionRow
              label="Hersteller-Ref."
              value={article.manufacturer_ref}
            />
            <DefinitionRow
              label="Gewicht"
              value={
                // PostgREST serialises numeric as string; coerce explicitly
                // so .toFixed() never crashes on a runtime string value.
                article.weight_kg !== null
                  ? `${Number(article.weight_kg).toFixed(2).replace(".", ",")} kg`
                  : null
              }
              emptyPlaceholder="—"
            />
            <DefinitionRow
              label="Maße (L × B × H)"
              value={
                // Use explicit `!= null` so a legitimate 0 isn't dropped to
                // "—". (Zod blocks 0 for integer dimensions, but defense in
                // depth: render exactly what the DB sent.)
                article.length_cm != null
                || article.width_cm != null
                || article.height_cm != null
                  ? `${article.length_cm ?? "—"} × ${
                      article.width_cm ?? "—"
                    } × ${article.height_cm ?? "—"} cm`
                  : null
              }
              emptyPlaceholder="—"
            />
            {/* Einkaufspreis: admin/office only — defense-in-depth. RLS already
                filters this column for technicians via the technician_articles
                view; warehouse can read it but UI hides per role policy. */}
            {!isWarehouse ? (
              <DefinitionRow
                label="Einkaufspreis"
                value={formatChf(article.purchase_price)}
                emptyPlaceholder="—"
              />
            ) : null}
            <DefinitionRow
              label="MwSt"
              value={
                articleVatRateLabels[
                  article.vat_rate as keyof typeof articleVatRateLabels
                ] ?? "—"
              }
            />
            {article.is_rentable ? (
              <>
                <DefinitionRow
                  label="Min. Lager"
                  value={article.min_stock !== null ? String(article.min_stock) : null}
                  emptyPlaceholder="—"
                />
                <DefinitionRow
                  label="Krit. Lager"
                  value={
                    article.critical_stock !== null
                      ? String(article.critical_stock)
                      : null
                  }
                  emptyPlaceholder="—"
                />
              </>
            ) : null}
            <DefinitionRow
              label="Notizen"
              value={article.notes}
              preserveWhitespace
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
