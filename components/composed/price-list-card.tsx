"use client";

import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { priceListNameLabels } from "@/lib/constants/article";
import { useAppRole } from "@/lib/hooks/use-app-role";
import { useActivePriceListDefinitions } from "@/lib/queries/price-list-definitions";
import {
  priceListKeys,
  usePriceListForArticle,
} from "@/lib/queries/price-lists";
import { createClient } from "@/lib/supabase/client";
import type { PriceListNameValue } from "@/lib/validations/price-list";

import { PriceListEditDialog } from "./price-list-edit-dialog";
import { PriceDisplay } from "./price-display";

export type PriceListCardProps = {
  articleId: string;
};

export function PriceListCard({ articleId }: PriceListCardProps) {
  const { data: rows, isLoading, isError } = usePriceListForArticle(articleId);
  const { data: definitions } = useActivePriceListDefinitions();
  const { data: role } = useAppRole();
  const queryClient = useQueryClient();
  const channelSuffix = useId();
  const [editingList, setEditingList] = useState<PriceListNameValue | null>(null);

  // Realtime — fire on any price_lists row change for this article so a
  // concurrent edit (or the post-RPC settled refetch) reflects immediately.
  useEffect(() => {
    if (!articleId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`price_lists:article:${articleId}:${channelSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "price_lists",
          filter: `article_id=eq.${articleId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: priceListKeys.forArticle(articleId),
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [articleId, channelSuffix, queryClient]);

  // Defense-in-depth: warehouse + technician should never see this card.
  // RLS denies SELECT on price_lists for those roles, but the parent page
  // also gates rendering. This guard avoids a confusing "Zugriff verweigert"
  // toast if the card mounts under a misconfigured layout.
  if (role === "warehouse" || role === "technician") {
    return null;
  }

  const byName = new Map((rows ?? []).map((r) => [r.list_name, r]));

  // Iterate dynamically over active price-list definitions (Story 3.1.1).
  // Fall back to the historical 5-slug ordering while definitions are still
  // loading so the card never renders empty.
  const slots: ReadonlyArray<{ slug: string; label: string }> = (() => {
    if (definitions && definitions.length > 0) {
      return definitions.map((d) => ({ slug: d.slug, label: d.name }));
    }
    const FALLBACK: ReadonlyArray<{ slug: string; label: string }> = [
      { slug: "private", label: priceListNameLabels.private },
      { slug: "helsana", label: priceListNameLabels.helsana },
      { slug: "sanitas", label: priceListNameLabels.sanitas },
      { slug: "visana", label: priceListNameLabels.visana },
      { slug: "kpt", label: priceListNameLabels.kpt },
    ];
    return FALLBACK;
  })();

  return (
    <Card>
      <CardHeader className="space-y-0 pb-2">
        <CardTitle>Preislisten</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">
            Preise werden geladen…
          </p>
        ) : isError ? (
          <p className="py-4 text-sm text-destructive">
            Preise konnten nicht geladen werden.
          </p>
        ) : (
          <dl className="flex flex-col gap-1">
            {slots.map(({ slug, label }) => {
              const row = byName.get(slug);
              return (
                <div
                  key={slug}
                  className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-muted/30"
                >
                  <dt className="text-sm font-medium text-foreground">
                    {label}
                  </dt>
                  <dd className="flex items-center gap-2 text-sm">
                    {row && row.amount !== null ? (
                      <PriceDisplay amount={row.amount as unknown as number} />
                    ) : (
                      <span className="italic text-muted-foreground">
                        Nicht gepflegt
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${label}-Preis bearbeiten`}
                      title={`${label}-Preis bearbeiten`}
                      onClick={() => setEditingList(slug)}
                      className="h-7 w-7"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </CardContent>

      {editingList ? (() => {
        const row = byName.get(editingList);
        const rawAmount = row?.amount;
        const currentAmount =
          rawAmount === null || rawAmount === undefined ? null : Number(rawAmount);
        return (
          <PriceListEditDialog
            articleId={articleId}
            listName={editingList}
            currentAmount={Number.isFinite(currentAmount) ? currentAmount : null}
            currentNotes={row?.notes ?? null}
            open={editingList !== null}
            onOpenChange={(open) => {
              if (!open) setEditingList(null);
            }}
          />
        );
      })() : null}
    </Card>
  );
}
