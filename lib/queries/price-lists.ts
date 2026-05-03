import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { articleKeys } from "@/lib/queries/articles";
import { createClient } from "@/lib/supabase/client";
import { logError } from "@/lib/utils/error-log";
import type {
  PriceList,
  PriceListNameValue,
} from "@/lib/validations/price-list";

// ---------------------------------------------------------------------------
// Key factory
// ---------------------------------------------------------------------------

export const priceListKeys = {
  all: ["price_lists"] as const,
  /** All currently-active rows for one article (5-row dl on the profile). */
  forArticle: (articleId: string) =>
    [...priceListKeys.all, "article", articleId] as const,
};

// ---------------------------------------------------------------------------
// usePriceListForArticle — returns the currently-active row per list_name.
// ---------------------------------------------------------------------------
// IMPORTANT — direct UPDATE on `price_lists.amount` is forbidden by
// convention (see CLAUDE.md anti-pattern + Story 3.1 Dev Notes). Price
// changes MUST flow through `replace_price_list_entry` so Bestandsschutz
// for Epic-5 contracts referencing `price_snapshot_source_id` is preserved.

export type ActivePriceRow = Pick<
  PriceList,
  "id" | "list_name" | "amount" | "valid_from" | "valid_to" | "notes"
>;

export function usePriceListForArticle(articleId: string | null) {
  const enabled = articleId !== null && articleId.length > 0;
  return useQuery({
    queryKey: enabled
      ? priceListKeys.forArticle(articleId)
      : priceListKeys.forArticle("none"),
    queryFn: enabled
      ? async (): Promise<ActivePriceRow[]> => {
          const supabase = createClient();
          // Single SELECT against `price_lists` filtered for currently-active
          // rows (`valid_from <= today AND (valid_to IS NULL OR valid_to >
          // today)`). Returns 0–5 rows; the UI fills missing list_names with
          // "Nicht gepflegt" rows.
          // Compute "today" in Europe/Zurich to match the server's
          // `current_date` semantics — UTC would flip the day around 23:00
          // CET and miss / leak rows.
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Zurich",
          }).format(new Date());
          const { data, error } = await supabase
            .from("price_lists")
            .select("id, list_name, amount, valid_from, valid_to, notes")
            .eq("article_id", articleId)
            .lte("valid_from", today)
            .or(`valid_to.is.null,valid_to.gt.${today}`);

          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "error",
                source: "price-list-card",
                message: "price list query failed",
                details: {
                  article_id: articleId,
                  operation: "list",
                  code: error.code ?? null,
                },
                entity: "price_lists",
              },
              supabase,
            );
            throw error;
          }
          return (data ?? []) as ActivePriceRow[];
        }
      : skipToken,
  });
}

// ---------------------------------------------------------------------------
// useReplacePriceListEntry — single-list-name atomic update.
// ---------------------------------------------------------------------------

export type ReplacePriceListEntryInput = {
  articleId: string;
  listName: PriceListNameValue;
  amount: number;
  validFrom?: string; // YYYY-MM-DD; defaults to today server-side
  notes?: string | null;
};

export function useReplacePriceListEntry(
  options?: UseMutationOptions<string, Error, ReplacePriceListEntryInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReplacePriceListEntryInput) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("replace_price_list_entry", {
        p_article_id: input.articleId,
        p_list_name: input.listName,
        p_amount: input.amount,
        // Pass `null` for validFrom when the caller didn't specify — the
        // RPC's `p_valid_from default current_date` resolves to the server
        // date in Europe/Zurich, sidestepping the client-side UTC midnight
        // edge case.
        p_valid_from: input.validFrom ?? null,
        p_notes: input.notes ?? null,
      });

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "price-list-dialog",
            // Drop `error.message` — Postgres frequently embeds row data
            // ("Key (article_id)=(...)" etc). Use the structured code only.
            message: "replace_price_list_entry failed",
            details: {
              article_id: input.articleId,
              list_name: input.listName,
              operation: "replace",
              code: error.code ?? null,
            },
            entity: "price_lists",
          },
          supabase,
        );
        // Map known PG error codes to friendly German messages.
        if (error.code === "42501") {
          throw new Error("Nur admin/office dürfen Preise ändern.");
        }
        if (error.code === "23P01") {
          throw new Error(
            "Es existiert bereits ein zukünftig gültiger Preis für diese Liste — bitte zuerst diesen Eintrag bearbeiten.",
          );
        }
        if (error.code === "23514") {
          throw new Error("Ungültiger Preis (muss ≥ 0 sein).");
        }
        if (error.code === "22023") {
          throw new Error("Ungültige Eingabe (Pflichtfeld fehlt oder Format fehlerhaft).");
        }
        if (error.code === "23503") {
          throw new Error("Artikel existiert nicht mehr.");
        }
        throw new Error("Preis konnte nicht gespeichert werden.");
      }
      if (typeof data !== "string") {
        throw new Error("replace_price_list_entry did not return an id");
      }
      return data;
    },
    ...options,
    onSuccess: (...args) => {
      const [, vars] = args;
      queryClient.invalidateQueries({
        queryKey: priceListKeys.forArticle(vars.articleId),
      });
      // Also invalidate article lists — the Privat price column reads from
      // price_lists and any change flips one cell.
      queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
      return options?.onSuccess?.(...args);
    },
  });
}
