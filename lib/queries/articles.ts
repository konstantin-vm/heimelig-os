import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import {
  ARTICLE_LIST_DEFAULT_SORT,
  ARTICLE_LIST_PAGE_SIZE,
  type ArticleListSortColumn,
  type ArticleListSortDir,
} from "@/lib/constants/article";
import { logError } from "@/lib/utils/error-log";
import type {
  Article,
  ArticleCreate,
  ArticleUpdate,
} from "@/lib/validations/article";
import type { PriceListNameValue } from "@/lib/validations/price-list";

// ---------------------------------------------------------------------------
// Filter shape — mirrors Story 2.5's `CustomerListFilters` pattern.
// ---------------------------------------------------------------------------

export type ArticleStatusFilter = "active" | "inactive";

export type ArticleListFilters = {
  search?: string;
  category?: Article["category"] | null;
  type?: Article["type"] | null;
  isRentable?: boolean | null;
  isSellable?: boolean | null;
  status?: ArticleStatusFilter | null;
  sort?: ArticleListSortColumn;
  dir?: ArticleListSortDir;
  page?: number;
  pageSize?: number;
};

export const articleKeys = {
  all: ["articles"] as const,
  totalCount: () => [...articleKeys.all, "total-count"] as const,
  lists: () => [...articleKeys.all, "list"] as const,
  list: (filters: ArticleListFilters) =>
    [...articleKeys.lists(), filters] as const,
  details: () => [...articleKeys.all, "detail"] as const,
  detail: (id: string) => [...articleKeys.details(), id] as const,
};

// ---------------------------------------------------------------------------
// List row shape — joins the currently-active Privat price for the column.
// ---------------------------------------------------------------------------

export type ArticleListRow = Pick<
  Article,
  | "id"
  | "article_number"
  | "name"
  | "description"
  | "category"
  | "type"
  | "is_rentable"
  | "is_sellable"
  | "vat_rate"
  | "unit"
  | "variant_label"
  | "is_active"
  | "created_at"
> & {
  /** Currently-active Privat price, in CHF (numeric column). null if not maintained. */
  current_private_price: number | null;
};

export type ArticleListResult = {
  rows: ArticleListRow[];
  total: number;
};

// ---------------------------------------------------------------------------
// Sorting helper — same pattern as customer list.
// ---------------------------------------------------------------------------

function applyArticleSort<
  Q extends {
    order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => Q;
  },
>(query: Q, sort: ArticleListSortColumn, dir: ArticleListSortDir): Q {
  const ascending = dir === "asc";
  switch (sort) {
    case "article_number":
      return query
        .order("article_number", { ascending })
        .order("id", { ascending });
    case "name":
      return query
        .order("name", { ascending, nullsFirst: false })
        .order("id", { ascending });
    case "category":
      return query
        .order("category", { ascending })
        .order("article_number", { ascending });
    case "created_at":
      return query
        .order("created_at", { ascending })
        .order("id", { ascending });
    default:
      return query.order("article_number", { ascending: true });
  }
}

// ---------------------------------------------------------------------------
// useArticlesList — server-side filter / sort / pagination.
// ---------------------------------------------------------------------------

export function useArticlesList(filters: ArticleListFilters = {}) {
  return useQuery({
    queryKey: articleKeys.list(filters),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ArticleListResult> => {
      const supabase = createClient();
      const sort = filters.sort ?? ARTICLE_LIST_DEFAULT_SORT.col;
      const dir = filters.dir ?? ARTICLE_LIST_DEFAULT_SORT.dir;
      const pageSize = filters.pageSize ?? ARTICLE_LIST_PAGE_SIZE;
      const page = filters.page && filters.page > 0 ? filters.page : 1;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const search = filters.search?.trim() ?? "";
      const category = filters.category ?? null;
      const type = filters.type ?? null;
      const isRentable = filters.isRentable ?? null;
      const isSellable = filters.isSellable ?? null;
      const status = filters.status ?? null;

      let query = supabase
        .from("articles")
        .select(
          `
            id,
            article_number,
            name,
            description,
            category,
            type,
            is_rentable,
            is_sellable,
            vat_rate,
            unit,
            variant_label,
            is_active,
            created_at
          `,
          { count: "exact" },
        );

      if (status === "active") query = query.eq("is_active", true);
      else if (status === "inactive") query = query.eq("is_active", false);

      if (category) query = query.eq("category", category);
      if (type) query = query.eq("type", type);
      if (isRentable !== null) query = query.eq("is_rentable", isRentable);
      if (isSellable !== null) query = query.eq("is_sellable", isSellable);

      if (search.length > 0) {
        // Articles aren't PII — search strings can flow to error_log without
        // the customer-domain restriction. Still, the helper prefers a
        // structured PostgREST `.or(...)` for ILIKE substring across multiple
        // columns, which the trigram indexes from migration 00035 do not
        // accelerate (those are customer-domain). Article search is
        // expected to be O(few hundred rows) for the Sprint-1 catalog so
        // the seq-scan is acceptable.
        // Escape SQL LIKE wildcards (`%`, `_`) plus characters that have
        // special meaning to PostgREST `.or()` parsing (`,`, `(`, `)`,
        // `*`, `:` — the latter two added in Story 3.4 closing the
        // Story-3.2 review deferred-work line 249) and the backslash
        // itself. Cap the input at 100 chars to avoid PostgREST 414
        // (URI Too Long). Same regex shape used by `lib/queries/devices.ts`
        // and `lib/queries/inventory.ts`.
        const trimmed = search.slice(0, 100);
        const escaped = trimmed.replace(/[%_,()\\*:]/g, "\\$&");
        query = query.or(
          [
            `name.ilike.%${escaped}%`,
            `article_number.ilike.%${escaped}%`,
            `manufacturer.ilike.%${escaped}%`,
          ].join(","),
        );
      }

      query = applyArticleSort(query, sort, dir);
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "article-list",
            message: "article list query failed",
            details: {
              code: error.code ?? null,
              operation: "list",
              filterCount: [
                search ? "search" : null,
                category,
                type,
                isRentable,
                isSellable,
                status,
              ].filter((v) => v !== null && v !== undefined && v !== "").length,
            },
          },
          supabase,
        );
        throw error;
      }

      const rawRows = (data ?? []) as Array<
        Omit<ArticleListRow, "current_private_price">
      >;

      // Batch-fetch the currently-active Privat price for every visible
      // article in a single round-trip. RLS on `price_lists` denies
      // technician + warehouse roles → those callers receive an empty set
      // and the column renders `—`, which is the intended defense-in-depth
      // (technician is also blocked by the route guard in
      // app/(auth)/articles/layout.tsx). PostgREST serialises `numeric` as a
      // string; coerce explicitly via `Number()` rather than `typeof`.
      const ids = rawRows.map((r) => r.id);
      const priceMap = new Map<string, number | null>();
      if (ids.length > 0) {
        const { data: priceRows, error: priceError } = await supabase
          .from("price_lists")
          .select("article_id, amount")
          .in("article_id", ids)
          .eq("list_name", "private")
          .is("valid_to", null);

        if (priceError) {
          await logError(
            {
              errorType: "DB_FUNCTION",
              severity: "error",
              source: "article-list",
              message: "current price batch fetch failed",
              details: {
                code: priceError.code ?? null,
                operation: "list-prices",
                idCount: ids.length,
              },
            },
            supabase,
          );
          // Soft-fail: the list still renders, every Privat cell shows `—`.
        } else {
          for (const row of priceRows ?? []) {
            const n = Number(row.amount);
            priceMap.set(row.article_id, Number.isFinite(n) ? n : null);
          }
        }
      }

      const rows: ArticleListRow[] = rawRows.map((row) => ({
        ...row,
        current_private_price: priceMap.get(row.id) ?? null,
      }));

      return {
        rows,
        total: count ?? rows.length,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// useArticlesTotalCount — page-header badge (active articles only).
// ---------------------------------------------------------------------------

export function useArticlesTotalCount() {
  return useQuery({
    queryKey: articleKeys.totalCount(),
    queryFn: async (): Promise<number> => {
      const supabase = createClient();
      const { count, error } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "article-list",
            message: "article total-count query failed",
            details: { code: error.code ?? null, operation: "total-count" },
          },
          supabase,
        );
        throw error;
      }
      return count ?? 0;
    },
    staleTime: 1000 * 60 * 5,
  });
}

// ---------------------------------------------------------------------------
// useArticle — single-row read by id.
// ---------------------------------------------------------------------------

export function useArticle(id: string | null) {
  const enabled = id !== null && id.length > 0;
  return useQuery({
    // When disabled, use a dedicated sentinel so the placeholder query key
    // never collides with a real article id named "none". A future
    // `invalidateQueries({ queryKey: articleKeys.detail("none") })` would
    // otherwise unintentionally match this slot.
    queryKey: enabled
      ? articleKeys.detail(id)
      : [...articleKeys.all, "detail-disabled"],
    queryFn: enabled
      ? async (): Promise<Article | null> => {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("articles")
            .select("*")
            .eq("id", id)
            .maybeSingle();

          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "error",
                source: "article-detail",
                message: "article detail read failed",
                details: {
                  article_id: id,
                  operation: "read",
                  code: error.code ?? null,
                },
                entity: "articles",
                entityId: id,
              },
              supabase,
            );
            throw error;
          }
          return (data as Article | null) ?? null;
        }
      : skipToken,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type CreateArticleInput = {
  article: ArticleCreate;
  /** Sparse 5-list of starting prices; only entries with non-null amount are inserted. */
  prices?: Array<{
    list_name: PriceListNameValue;
    amount: number | null;
    notes?: string | null;
  }>;
};

export function useCreateArticle(
  options?: UseMutationOptions<string, Error, CreateArticleInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ article, prices }: CreateArticleInput) => {
      const supabase = createClient();
      const filteredPrices = (prices ?? [])
        .filter((p) => p.amount !== null && p.amount !== undefined)
        .map((p) => ({
          list_name: p.list_name,
          amount: p.amount,
          notes: p.notes ?? null,
        }));

      const { data, error } = await supabase.rpc(
        "create_article_with_prices",
        {
          p_article: article as unknown as Record<string, unknown>,
          p_prices: filteredPrices as unknown as Record<string, unknown>,
        },
      );

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "article-form",
            message: "create_article_with_prices RPC failed",
            details: { operation: "create", code: error.code ?? null },
            entity: "articles",
          },
          supabase,
        );
        if (error.code === "23505") {
          throw new Error(
            "Artikelnummer bereits vergeben — bitte andere Nummer wählen.",
          );
        }
        if (error.code === "42501") {
          throw new Error("Nur admin/office dürfen Artikel anlegen.");
        }
        throw error;
      }
      if (typeof data !== "string") {
        throw new Error("create_article_with_prices did not return an id");
      }
      return data;
    },
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: articleKeys.totalCount() });
      return options?.onSuccess?.(...args);
    },
  });
}

export type UpdateArticleInput = {
  id: string;
  patch: ArticleUpdate;
};

export function useUpdateArticle(
  options?: UseMutationOptions<Article, Error, UpdateArticleInput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateArticleInput) => {
      const supabase = createClient();
      // `.single()` (not `.maybeSingle()`) so a 0-row result becomes a
      // PGRST116 error rather than a silent null return — the latter
      // hides RLS denials behind the "data is null" branch and used to
      // surface as a generic "0 Zeilen" message after the fact.
      const { data, error } = await supabase
        .from("articles")
        .update(patch as unknown as Record<string, unknown>)
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "article-form",
            message: "article update failed",
            details: {
              article_id: id,
              operation: "update",
              code: error.code ?? null,
            },
            entity: "articles",
            entityId: id,
          },
          supabase,
        );
        if (error.code === "23505") {
          throw new Error(
            "Artikelnummer bereits vergeben — bitte andere Nummer wählen.",
          );
        }
        if (error.code === "PGRST116") {
          throw new Error(
            "Artikel-UPDATE betraf 0 Zeilen — möglicherweise fehlt die RLS-Berechtigung.",
          );
        }
        throw error;
      }
      return data as Article;
    },
    ...options,
    onSuccess: (...args) => {
      const [, vars] = args;
      queryClient.invalidateQueries({ queryKey: articleKeys.detail(vars.id) });
      queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
      return options?.onSuccess?.(...args);
    },
  });
}

export function useSoftDeleteArticle(
  options?: UseMutationOptions<void, Error, { id: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const supabase = createClient();
      // Use `.select('id').single()` so PostgREST raises PGRST116 when 0
      // rows are affected (RLS denial). A bare `.update()` would silently
      // "succeed" with no rows changed, leading to a false-positive toast.
      const { data, error } = await supabase
        .from("articles")
        .update({ is_active: false })
        .eq("id", id)
        .select("id")
        .single();

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "article-form",
            message: "article soft-delete failed",
            details: {
              article_id: id,
              operation: "soft-delete",
              code: error.code ?? null,
            },
            entity: "articles",
            entityId: id,
          },
          supabase,
        );
        if (error.code === "PGRST116") {
          throw new Error(
            "Artikel-Deaktivierung betraf 0 Zeilen — möglicherweise fehlt die RLS-Berechtigung.",
          );
        }
        throw error;
      }
      if (!data) {
        throw new Error("Artikel-Deaktivierung lieferte keine Zeile zurück.");
      }
    },
    ...options,
    onSuccess: (...args) => {
      const [, vars] = args;
      queryClient.invalidateQueries({ queryKey: articleKeys.detail(vars.id) });
      queryClient.invalidateQueries({ queryKey: articleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: articleKeys.totalCount() });
      return options?.onSuccess?.(...args);
    },
  });
}
