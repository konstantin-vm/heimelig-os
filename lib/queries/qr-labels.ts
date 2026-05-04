"use client";

// Story 3.7 — QR Label Runs query layer.
//
// Mirrors `lib/queries/devices.ts` (Story 3.2):
//   - `qrLabelKeys` factory keeps every cache slot under one root.
//   - `useArticleLabelRuns` / `useArticleLabelRunsList` are server-side
//     filtered + paged.
//   - `usePrintLabels` orchestrates the device-side qr_code write-back +
//     PDF render + Storage upload + qr_label_runs insert in one mutation.
//   - `useArticleLabelRunDelete` is admin-only (UI hides + RLS denies).
//   - Realtime subscriptions invalidate the relevant cache slots on
//     postgres_changes events for `public.qr_label_runs` (joined the
//     publication in migration 00050).

import { useEffect } from "react";
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { z } from "zod";

import { renderQrLabelPdf, type QrLabelDeviceData } from "@/lib/qr-labels/render";
import { LABEL_FORMAT_60x40_PORTRAIT } from "@/lib/qr-labels/format";
import { persistAndOpen } from "@/lib/qr-labels/print";
import { encodeDevicePayload } from "@/lib/qr-labels/encode";
import { createClient } from "@/lib/supabase/client";
import { logError } from "@/lib/utils/error-log";
import { uuidSchema } from "@/lib/validations/common";
import {
  qrLabelRunStatusSchema,
  type QrLabelRunStatus,
} from "@/lib/validations/qr-label-run";

// Keep the same search-escape rules used by lib/queries/articles.ts +
// devices.ts — `%`, `_` are SQL LIKE wildcards; `,`, `(`, `)` are PostgREST
// `.or()` separators; `\` is the escape character itself.
const QR_LABEL_SEARCH_MAX_LEN = 100;

export type QrLabelRunsFilters = {
  search?: string;
  status?: ReadonlyArray<QrLabelRunStatus>;
  page?: number;
  pageSize?: number;
};

const QR_LABEL_RUNS_PAGE_SIZE = 25;

export const qrLabelKeys = {
  all: ["qr-label-runs"] as const,
  lists: () => [...qrLabelKeys.all, "list"] as const,
  list: (filters: QrLabelRunsFilters) =>
    [...qrLabelKeys.lists(), filters] as const,
  byArticle: (articleId: string, filters?: QrLabelRunsFilters) =>
    [...qrLabelKeys.all, "byArticle", articleId, filters ?? {}] as const,
  byArticleAll: (articleId: string) =>
    [...qrLabelKeys.all, "byArticle", articleId] as const,
  details: () => [...qrLabelKeys.all, "detail"] as const,
  detail: (id: string) => [...qrLabelKeys.details(), id] as const,
  signedUrl: (runId: string) =>
    [...qrLabelKeys.all, "signed-url", runId] as const,
};

// `articles!inner` so PostgREST treats the embed as an INNER JOIN; the
// `.or(... { foreignTable: "articles" })` filter below then actually
// eliminates parent rows (vs. a regular embed which only narrows the
// embedded payload, leaving every parent row in the result + count).
const QR_LABEL_RUN_LIST_SELECT = `
  id,
  article_id,
  batch_id,
  device_count,
  status,
  failure_reason,
  storage_path,
  created_at,
  created_by,
  articles!inner ( article_number, name, variant_label ),
  user_profiles!qr_label_runs_created_by_fkey (
    first_name, last_name
  )
`;

const qrLabelRunArticleJoinSchema = z
  .object({
    article_number: z.string(),
    name: z.string(),
    variant_label: z.string().nullable(),
  })
  .nullable();

const qrLabelRunUserProfileJoinSchema = z
  .object({
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  })
  .nullable();

export const qrLabelRunListRowSchema = z.object({
  id: uuidSchema,
  article_id: uuidSchema,
  batch_id: uuidSchema,
  device_count: z.number().int().nonnegative(),
  status: qrLabelRunStatusSchema,
  failure_reason: z.string().nullable(),
  storage_path: z.string(),
  created_at: z.string(),
  created_by: uuidSchema.nullable(),
  articles: qrLabelRunArticleJoinSchema,
  user_profiles: qrLabelRunUserProfileJoinSchema,
});

export type QrLabelRunListRow = z.infer<typeof qrLabelRunListRowSchema>;

export type QrLabelRunsResult = {
  rows: QrLabelRunListRow[];
  total: number;
};

function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ---------------------------------------------------------------------------
// useArticleLabelRunsList — global list across all articles (S-016).
// ---------------------------------------------------------------------------

export function useArticleLabelRunsList(filters: QrLabelRunsFilters = {}) {
  return useQuery({
    queryKey: qrLabelKeys.list(filters),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<QrLabelRunsResult> => {
      const supabase = createClient();
      const pageSize = filters.pageSize ?? QR_LABEL_RUNS_PAGE_SIZE;
      const page = filters.page && filters.page > 0 ? filters.page : 1;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from("qr_label_runs")
        .select(QR_LABEL_RUN_LIST_SELECT, { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);

      if (filters.status && filters.status.length > 0) {
        query = query.in("status", filters.status as string[]);
      }

      const search = filters.search?.trim() ?? "";
      if (search.length > 0) {
        const trimmed = search.slice(0, QR_LABEL_SEARCH_MAX_LEN);
        const escaped = trimmed.replace(/[%_,()\\]/g, "\\$&");
        // Search across the joined article columns via PostgREST's
        // resource embedding filter syntax. `articles.name` and
        // `articles.article_number` are the user-meaningful identifiers
        // for a print run.
        query = query.or(
          [
            `name.ilike.%${escaped}%`,
            `article_number.ilike.%${escaped}%`,
          ].join(","),
          { foreignTable: "articles" },
        );
      }

      const { data, error, count } = await query;

      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "qr-label-runs-list",
            message: "qr_label_runs list query failed",
            details: { operation: "list", code: error.code ?? null },
            entity: "qr_label_runs",
          },
          supabase,
        );
        throw error;
      }

      const normalised = (data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          ...r,
          articles: unwrapEmbed(r.articles as unknown),
          user_profiles: unwrapEmbed(r.user_profiles as unknown),
        };
      });

      const parsed = z.array(qrLabelRunListRowSchema).safeParse(normalised);
      if (!parsed.success) {
        await logError(
          {
            errorType: "VALIDATION",
            severity: "warning",
            source: "qr-label-runs-list",
            message: "qr_label_runs list shape drift",
            details: {
              operation: "list",
              issueCount: parsed.error.issues.length,
            },
            entity: "qr_label_runs",
          },
          supabase,
        );
        return {
          rows: normalised as unknown as QrLabelRunListRow[],
          total: count ?? normalised.length,
        };
      }

      return { rows: parsed.data, total: count ?? parsed.data.length };
    },
  });
}

// ---------------------------------------------------------------------------
// useArticleLabelRuns — scoped to a single article (article-detail card).
// ---------------------------------------------------------------------------

export function useArticleLabelRuns(
  articleId: string | null,
  filters: QrLabelRunsFilters = {},
) {
  const enabled = !!articleId && uuidSchema.safeParse(articleId).success;
  return useQuery({
    queryKey: enabled
      ? qrLabelKeys.byArticle(articleId!, filters)
      : [...qrLabelKeys.all, "byArticle-disabled"],
    placeholderData: keepPreviousData,
    queryFn: enabled
      ? async (): Promise<QrLabelRunsResult> => {
          const supabase = createClient();
          const pageSize = filters.pageSize ?? QR_LABEL_RUNS_PAGE_SIZE;
          const page = filters.page && filters.page > 0 ? filters.page : 1;
          const from = (page - 1) * pageSize;
          const to = from + pageSize - 1;

          let query = supabase
            .from("qr_label_runs")
            .select(QR_LABEL_RUN_LIST_SELECT, { count: "exact" })
            .eq("article_id", articleId!)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to);

          if (filters.status && filters.status.length > 0) {
            query = query.in("status", filters.status as string[]);
          }

          const { data, error, count } = await query;

          if (error) {
            await logError(
              {
                errorType: "DB_FUNCTION",
                severity: "error",
                source: "qr-label-runs-by-article",
                message: "qr_label_runs by-article query failed",
                details: {
                  article_id: articleId,
                  operation: "list",
                  code: error.code ?? null,
                },
                entity: "qr_label_runs",
              },
              supabase,
            );
            throw error;
          }

          const normalised = (data ?? []).map((row) => {
            const r = row as Record<string, unknown>;
            return {
              ...r,
              articles: unwrapEmbed(r.articles as unknown),
              user_profiles: unwrapEmbed(r.user_profiles as unknown),
            };
          });

          const parsed = z
            .array(qrLabelRunListRowSchema)
            .safeParse(normalised);
          if (!parsed.success) {
            return {
              rows: normalised as unknown as QrLabelRunListRow[],
              total: count ?? normalised.length,
            };
          }

          return { rows: parsed.data, total: count ?? parsed.data.length };
        }
      : skipToken,
  });
}

// ---------------------------------------------------------------------------
// useArticleLabelRunSignedUrl — mutation that mints a 60s signed URL.
// ---------------------------------------------------------------------------

export function useArticleLabelRunSignedUrl() {
  return useMutation({
    mutationFn: async (storagePath: string): Promise<string> => {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("qr-labels")
        .createSignedUrl(storagePath, 60);
      if (error || !data?.signedUrl) {
        await logError(
          {
            errorType: "OTHER",
            severity: "warning",
            source: "qr-label-signed-url",
            message: "signed URL generation failed",
            details: { operation: "sign", code: "signed_url_failed" },
            entity: "qr_label_runs",
          },
          supabase,
        );
        throw new Error(
          error?.message ?? "Signed URL konnte nicht erstellt werden.",
        );
      }
      return data.signedUrl;
    },
  });
}

// ---------------------------------------------------------------------------
// useArticleLabelRunDelete — admin-only soft-cancel via DELETE.
// ---------------------------------------------------------------------------

export function useArticleLabelRunDelete(
  options?: UseMutationOptions<{ id: string; storage_path: string }, Error, { id: string; storage_path: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, storage_path }) => {
      const supabase = createClient();

      // Disambiguate "row already gone" (admin race or stale cache) from
      // "RLS denied" (non-admin caller). PostgREST returns a successful
      // 204 + empty data on RLS-denied DELETE, NOT a PGRST116 — so probe
      // the row first via SELECT (admin can read any row; non-admin is
      // denied by RLS and gets `data === null` without an error).
      const { data: probe, error: probeError } = await supabase
        .from("qr_label_runs")
        .select("id")
        .eq("id", id)
        .maybeSingle();

      if (probeError) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "qr-label-run-delete",
            message: "qr_label_runs delete probe failed",
            details: {
              run_id: id,
              operation: "delete-probe",
              code: probeError.code ?? null,
            },
            entity: "qr_label_runs",
            entityId: id,
          },
          supabase,
        );
        throw new Error("Löschung fehlgeschlagen.");
      }

      if (!probe) {
        // Either the row was already deleted, or RLS hides it from this
        // role. Both states map to the same user-facing message because
        // the UI already gates the delete button on admin role
        // (defense-in-depth) — if a non-admin somehow triggers this we
        // shouldn't leak the existence of the row.
        throw new Error(
          "Eintrag nicht mehr vorhanden — bitte Tabelle aktualisieren.",
        );
      }

      const { data, error } = await supabase
        .from("qr_label_runs")
        .delete()
        .eq("id", id)
        .select("id")
        .single();

      if (error || !data) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "qr-label-run-delete",
            message: "qr_label_runs delete failed",
            details: {
              run_id: id,
              operation: "delete",
              code: error?.code ?? null,
            },
            entity: "qr_label_runs",
            entityId: id,
          },
          supabase,
        );
        // Row was visible to SELECT but the DELETE returned no row —
        // RLS denies DELETE for office/warehouse (admin-only policy).
        throw new Error(
          "Löschung fehlgeschlagen — möglicherweise fehlt die Berechtigung.",
        );
      }

      // Best-effort: also delete the PDF blob. RLS for admin DELETE on
      // storage.objects is already in 00019. Failure is logged but
      // doesn't fail the row delete (the audit row is already gone).
      const remove = await supabase.storage
        .from("qr-labels")
        .remove([storage_path]);
      if (remove.error) {
        await logError(
          {
            errorType: "OTHER",
            severity: "warning",
            source: "qr-label-run-delete",
            message: "qr-label PDF blob delete failed (orphan)",
            details: { run_id: id, operation: "blob-remove" },
            entity: "qr_label_runs",
            entityId: id,
          },
          supabase,
        );
      }

      return { id, storage_path };
    },
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: qrLabelKeys.all });
      return options?.onSuccess?.(...args);
    },
  });
}

// ---------------------------------------------------------------------------
// usePrintLabels — orchestrates qr_code write-back, render, persist.
// ---------------------------------------------------------------------------

export type PrintLabelsArgs = {
  articleId: string;
  /** Devices to print, in display order. Each must include the qr_code +
   *  serial_number so the encoder can decide what to embed. */
  devices: QrLabelDeviceData[];
};

export type PrintLabelsResult = {
  runId: string;
  storagePath: string;
  signedUrl: string;
  batchId: string;
};

export function usePrintLabels(
  options?: UseMutationOptions<PrintLabelsResult, Error, PrintLabelsArgs>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      articleId,
      devices,
    }: PrintLabelsArgs): Promise<PrintLabelsResult> => {
      const supabase = createClient();

      if (devices.length === 0) {
        throw new Error("Keine Geräte ausgewählt.");
      }

      // Step 1 — write back qr_code for any device whose qr_code is null.
      // Concurrency cap of 5 RPCs per chunk to avoid exhausting Supabase's
      // per-user pool. On per-device failure (22023 conflict), abort the
      // whole print — a partial print where some devices have stale
      // qr_code values is worse than no print.
      const needsWriteBack = devices.filter((d) => d.qr_code === null);
      if (needsWriteBack.length > 0) {
        const chunkSize = 5;
        for (let i = 0; i < needsWriteBack.length; i += chunkSize) {
          const chunk = needsWriteBack.slice(i, i + chunkSize);
          const results = await Promise.allSettled(
            chunk.map((device) =>
              supabase.rpc("set_device_qr_code", {
                p_device_id: device.id,
                p_qr_code: encodeDevicePayload(device),
              }),
            ),
          );
          for (let j = 0; j < results.length; j += 1) {
            const r = results[j]!;
            const targetDevice = chunk[j]!;
            if (r.status === "rejected") {
              await logError(
                {
                  errorType: "DB_FUNCTION",
                  severity: "error",
                  source: "qr-label-print",
                  message: "set_device_qr_code RPC failed",
                  details: {
                    device_id: targetDevice.id,
                    operation: "qr-code-write-back",
                    code: "rpc_rejected",
                  },
                  entity: "devices",
                  entityId: targetDevice.id,
                },
                supabase,
              );
              throw new Error(
                "QR-Code konnte nicht gespeichert werden — bitte erneut versuchen.",
              );
            }
            const rpcError = (r.value as { error?: { code?: string; message?: string } })
              .error;
            if (rpcError) {
              await logError(
                {
                  errorType: "DB_FUNCTION",
                  severity: "error",
                  source: "qr-label-print",
                  message: "set_device_qr_code RPC returned error",
                  details: {
                    device_id: targetDevice.id,
                    operation: "qr-code-write-back",
                    code: rpcError.code ?? null,
                  },
                  entity: "devices",
                  entityId: targetDevice.id,
                },
                supabase,
              );
              if (rpcError.code === "P0002") {
                // M17: RPC raises P0002 when the device doesn't exist
                // (e.g. hard-deleted between selection and print).
                throw new Error(
                  "Gerät nicht gefunden — bitte Auswahl aktualisieren.",
                );
              }
              if (rpcError.code === "22023") {
                throw new Error(
                  "QR-Code-Konflikt — bitte Gerät neu laden",
                );
              }
              if (rpcError.code === "42501") {
                throw new Error(
                  "Sie haben keine Berechtigung, QR-Codes zu setzen.",
                );
              }
              throw new Error(
                rpcError.message ?? "QR-Code konnte nicht gespeichert werden.",
              );
            }
          }
        }
      }

      // Step 2 + 3 — render PDF, upload, insert qr_label_runs row.
      // Wrapped in try/catch so a render or upload failure AFTER the
      // qr_code write-back (Step 1) still leaves a `failed` audit row
      // in `qr_label_runs` — otherwise the device's `qr_code` is
      // permanently mutated with no trail of why (M5).
      const batchId = crypto.randomUUID();
      try {
        const blob = await renderQrLabelPdf({
          devices,
          format: LABEL_FORMAT_60x40_PORTRAIT,
        });

        const persistResult = await persistAndOpen({
          blob,
          articleId,
          batchId,
          deviceIds: devices.map((d) => d.id),
          status: "completed",
          supabase,
        });

        return {
          runId: persistResult.runId,
          storagePath: persistResult.storagePath,
          signedUrl: persistResult.signedUrl,
          batchId,
        };
      } catch (err) {
        const failureCode =
          (err as { code?: string }).code ??
          (err instanceof Error ? err.message : "render_failed");
        // Best-effort failure-row insert. Never re-throws — we want to
        // surface the original error, not mask it with an audit-row
        // write failure (e.g. RLS or trigger reject).
        await supabase
          .from("qr_label_runs")
          .insert({
            article_id: articleId,
            batch_id: batchId,
            device_ids: devices.map((d) => d.id),
            storage_path: `qr-labels/${articleId}/${batchId}.pdf`,
            status: "failed",
            failure_reason: String(failureCode).slice(0, 255),
          })
          .then(({ error }) => {
            if (error) {
              return logError(
                {
                  errorType: "DB_FUNCTION",
                  severity: "warning",
                  source: "qr-label-print",
                  message:
                    "qr_label_runs failed-row insert failed (audit gap)",
                  details: {
                    article_id: articleId,
                    batch_id: batchId,
                    operation: "failed-row-insert",
                    code: error.code ?? null,
                  },
                  entity: "qr_label_runs",
                  entityId: articleId,
                },
                supabase,
              );
            }
            return undefined;
          });
        throw err;
      }
    },
    ...options,
    onSuccess: (...args) => {
      const [, vars] = args;
      queryClient.invalidateQueries({ queryKey: qrLabelKeys.all });
      queryClient.invalidateQueries({
        queryKey: qrLabelKeys.byArticleAll(vars.articleId),
      });
      // Invalidate device caches — qr_code may have been written back.
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      return options?.onSuccess?.(...args);
    },
  });
}

// ---------------------------------------------------------------------------
// useQrLabelRunsRealtime — invalidates lists on postgres_changes events.
// ---------------------------------------------------------------------------

export function useQrLabelRunsRealtime(
  articleId: string | null,
  instanceKey: string,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const supabase = createClient();
    const channelName = articleId
      ? `qr-label-runs:byArticle:${articleId}:${instanceKey}`
      : `qr-label-runs:list:${instanceKey}`;
    const filter = articleId
      ? { event: "*" as const, schema: "public", table: "qr_label_runs", filter: `article_id=eq.${articleId}` }
      : { event: "*" as const, schema: "public", table: "qr_label_runs" };
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", filter, () => {
        queryClient.invalidateQueries({ queryKey: qrLabelKeys.all });
      })
      .subscribe((status, err) => {
        // M7: surface channel errors / timeouts. Without this, after a
        // Wi-Fi blip or JWT expiry the table goes stale silently and
        // a re-print from another session never appears here. On error
        // we both invalidate (forces a refetch fallback) and log to
        // error_log so ops can correlate with auth failures.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          void logError(
            {
              errorType: "OTHER",
              severity: "warning",
              source: "qr-label-runs-realtime",
              message: "qr_label_runs realtime channel dropped",
              details: {
                article_id: articleId,
                operation: "realtime-subscribe",
                code: status,
                error_message:
                  (err as { message?: string } | undefined)?.message ?? null,
              },
              entity: "qr_label_runs",
              entityId: articleId,
            },
            supabase,
          );
          queryClient.invalidateQueries({ queryKey: qrLabelKeys.all });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [articleId, instanceKey, queryClient]);
}
