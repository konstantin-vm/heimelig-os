// Story 3.1.1 — TanStack Query hooks for `price_list_definitions`
// (migration 00056). The hooks back the /settings/price-lists admin UI plus
// the dynamic-iteration pattern in <PriceListCard> and <ArticleEditForm>.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import { logError } from "@/lib/utils/error-log";
import {
  priceListDefinitionSchema,
  type PriceListDefinition,
  type PriceListDefinitionCreate,
  type PriceListDefinitionUpdate,
} from "@/lib/validations/price-list-definition";
import { articleKeys } from "@/lib/queries/articles";
import { priceListKeys } from "@/lib/queries/price-lists";

// ---------------------------------------------------------------------------
// Key factory
// ---------------------------------------------------------------------------

export const priceListDefinitionKeys = {
  all: ["price_list_definitions"] as const,
  lists: () => [...priceListDefinitionKeys.all, "list"] as const,
  /** Active rows only — drives the price-list grid on article surfaces. */
  active: () => [...priceListDefinitionKeys.all, "active"] as const,
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Returns ALL definitions (active + inactive), sorted by sort_order then
 * name. Used in the admin /settings/price-lists table.
 */
export function usePriceListDefinitions() {
  return useQuery({
    queryKey: priceListDefinitionKeys.lists(),
    queryFn: async (): Promise<PriceListDefinition[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("price_list_definitions")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "price-list-definitions",
            message: "list query failed",
            details: { operation: "list", code: error.code ?? null },
            entity: "price_list_definitions",
          },
          supabase,
        );
        throw error;
      }
      const parsed: PriceListDefinition[] = [];
      for (const row of data ?? []) {
        const result = priceListDefinitionSchema.safeParse(row);
        if (result.success) parsed.push(result.data);
      }
      return parsed;
    },
  });
}

/**
 * Returns ACTIVE definitions only, sorted by sort_order. Drives the dynamic
 * price-list grid on <PriceListCard> and the create-mode price inputs on
 * <ArticleEditForm>. Has a long staleTime — definitions rarely change.
 */
export function useActivePriceListDefinitions() {
  return useQuery({
    queryKey: priceListDefinitionKeys.active(),
    staleTime: 1000 * 60 * 10,
    queryFn: async (): Promise<PriceListDefinition[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("price_list_definitions")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "price-list-definitions",
            message: "active list query failed",
            details: { operation: "list-active", code: error.code ?? null },
            entity: "price_list_definitions",
          },
          supabase,
        );
        throw error;
      }
      const parsed: PriceListDefinition[] = [];
      for (const row of data ?? []) {
        const result = priceListDefinitionSchema.safeParse(row);
        if (result.success) parsed.push(result.data);
      }
      return parsed;
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: priceListDefinitionKeys.all });
  // The price-list grid on the article detail + the article list rows both
  // depend on the active definitions — bust those caches too so newly added
  // / renamed lists appear without a manual refresh.
  queryClient.invalidateQueries({ queryKey: priceListKeys.all });
  queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
}

export function useCreatePriceListDefinition(
  options?: UseMutationOptions<
    PriceListDefinition,
    Error,
    PriceListDefinitionCreate
  >,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PriceListDefinitionCreate) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("price_list_definitions")
        .insert({
          slug: input.slug,
          name: input.name,
          sort_order: input.sort_order,
          is_active: input.is_active,
          is_system: false,
        })
        .select("*")
        .single();

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "price-list-definitions",
            message: "insert failed",
            details: {
              operation: "create",
              slug: input.slug,
              code: error.code ?? null,
            },
            entity: "price_list_definitions",
          },
          supabase,
        );
        if (error.code === "23505") {
          throw new Error(
            "Eine Preisliste mit diesem Slug existiert bereits — bitte anderen Slug wählen.",
          );
        }
        if (error.code === "42501") {
          throw new Error("Nur Admins dürfen Preislisten anlegen.");
        }
        if (error.code === "23514") {
          throw new Error("Slug oder Name verletzt das vorgegebene Format.");
        }
        throw new Error("Preisliste konnte nicht angelegt werden.");
      }
      const parsed = priceListDefinitionSchema.parse(data);
      return parsed;
    },
    ...options,
    onSuccess: (...args) => {
      invalidateAll(queryClient);
      return options?.onSuccess?.(...args);
    },
  });
}

export type UpdatePriceListDefinitionInput = {
  id: string;
  patch: PriceListDefinitionUpdate;
};

export function useUpdatePriceListDefinition(
  options?: UseMutationOptions<
    PriceListDefinition,
    Error,
    UpdatePriceListDefinitionInput
  >,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdatePriceListDefinitionInput) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("price_list_definitions")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "price-list-definitions",
            message: "update failed",
            details: {
              operation: "update",
              id,
              code: error.code ?? null,
            },
            entity: "price_list_definitions",
            entityId: id,
          },
          supabase,
        );
        if (error.code === "23505") {
          throw new Error(
            "Eine Preisliste mit diesem Slug existiert bereits — bitte anderen Slug wählen.",
          );
        }
        if (error.code === "42501") {
          // System rows: slug rename or delete is blocked by trigger; admin
          // gate also raises 42501.
          throw new Error(
            "Diese Änderung ist nicht erlaubt — System-Preislisten können nicht umbenannt werden, und nur Admins dürfen Preislisten ändern.",
          );
        }
        if (error.code === "PGRST116") {
          throw new Error(
            "Preisliste existiert nicht mehr oder Berechtigung fehlt.",
          );
        }
        throw new Error("Preisliste konnte nicht aktualisiert werden.");
      }
      const parsed = priceListDefinitionSchema.parse(data);
      return parsed;
    },
    ...options,
    onSuccess: (...args) => {
      invalidateAll(queryClient);
      return options?.onSuccess?.(...args);
    },
  });
}

/**
 * Soft "delete" — flips `is_active` to false. Hard DELETE on a custom
 * (`is_system=false`) row is blocked at the DB layer when any `price_lists`
 * row references it (FK ON DELETE RESTRICT) which is the safer default for
 * historical price preservation.
 */
export function useDeactivatePriceListDefinition(
  options?: UseMutationOptions<PriceListDefinition, Error, { id: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("price_list_definitions")
        .update({ is_active: false })
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "price-list-definitions",
            message: "deactivate failed",
            details: {
              operation: "deactivate",
              id,
              code: error.code ?? null,
            },
            entity: "price_list_definitions",
            entityId: id,
          },
          supabase,
        );
        if (error.code === "42501") {
          throw new Error("Nur Admins dürfen Preislisten deaktivieren.");
        }
        throw new Error("Preisliste konnte nicht deaktiviert werden.");
      }
      const parsed = priceListDefinitionSchema.parse(data);
      return parsed;
    },
    ...options,
    onSuccess: (...args) => {
      invalidateAll(queryClient);
      return options?.onSuccess?.(...args);
    },
  });
}
