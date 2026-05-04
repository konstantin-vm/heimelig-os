"use client";

// Story 3.7 — print-history table for /articles/labels (S-016).
//
// DataTable showing `qr_label_runs` rows. Per-row actions:
//   * Eye icon → mints a 60-second signed URL via the storage API and
//     opens the PDF in a new tab.
//   * Trash icon → admin-only soft-delete (RLS denies for non-admin too).
//
// Search filter: article_number / name (escapes the same wildcards as the
// rest of the app — Story 2.5 / 3.1 / 3.2 review carry-overs).

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppRole } from "@/lib/hooks/use-app-role";
import {
  qrLabelRunStatusValues,
  type QrLabelRunStatus,
} from "@/lib/validations/qr-label-run";
import {
  useArticleLabelRunDelete,
  useArticleLabelRunSignedUrl,
  useArticleLabelRunsList,
  useQrLabelRunsRealtime,
} from "@/lib/queries/qr-labels";

import { ConfirmDialog } from "./confirm-dialog";
import { StatusBadge } from "./status-badge";
import { TablePagination } from "./table-pagination";

const PAGE_SIZE = 25;

// Swiss display format (date+time): "DD.MM.YYYY HH:mm" in Europe/Zurich
// to avoid the 23:00→00:00 roll-over off-by-one that Story 3.2 hit.
const DATE_TIME_FMT_DE_CH_ZRH = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatRunCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return DATE_TIME_FMT_DE_CH_ZRH.format(d).replace(",", "");
}

function formatActor(profile: {
  first_name: string | null;
  last_name: string | null;
} | null): string {
  if (!profile) return "—";
  const label = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return label || "—";
}

export function ArticleLabelsHistoryTable() {
  const { data: role } = useAppRole();
  const isAdmin = role === "admin";

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | QrLabelRunStatus
  >("all");

  const filters = useMemo(
    () => ({
      search: searchInput,
      status:
        statusFilter === "all"
          ? undefined
          : ([statusFilter] as ReadonlyArray<QrLabelRunStatus>),
      page,
      pageSize: PAGE_SIZE,
    }),
    [searchInput, statusFilter, page],
  );

  const { data, isLoading, error } = useArticleLabelRunsList(filters);

  // Realtime: invalidate on any qr_label_runs change so a parallel print
  // session reflects in this table without a manual refresh.
  const realtimeKey = useId();
  useQrLabelRunsRealtime(null, realtimeKey);

  const signedUrl = useArticleLabelRunSignedUrl();
  const deleteRun = useArticleLabelRunDelete({
    onSuccess: () => {
      toast.success("Druck-Eintrag entfernt.");
    },
    onError: (err) => {
      toast.error("Eintrag konnte nicht entfernt werden", {
        description: err.message,
      });
    },
  });

  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    storage_path: string;
  } | null>(null);

  async function openPdf(storagePath: string) {
    try {
      const url = await signedUrl.mutateAsync(storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error("PDF konnte nicht geöffnet werden", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Artikel suchen (Nummer / Name)…"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            aria-label="Druckverlauf durchsuchen"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={statusFilter === "all" ? "default" : "outline"}
            onClick={() => {
              setStatusFilter("all");
              setPage(1);
            }}
          >
            Alle
          </Button>
          {qrLabelRunStatusValues.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
            >
              {s === "completed" ? "Erstellt" : "Fehlgeschlagen"}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Druckverlauf wird geladen…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Druckverlauf konnte nicht geladen werden.
        </div>
      ) : (data?.rows ?? []).length === 0 ? (
        <div className="rounded-md border bg-card px-3 py-6 text-sm text-muted-foreground">
          Noch keine QR-Etiketten gedruckt.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Erstellt am</th>
                <th className="px-3 py-2 font-medium">Artikel</th>
                <th className="px-3 py-2 font-medium">Geräte</th>
                <th className="px-3 py-2 font-medium">Erstellt von</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => {
                const articleLabel = row.articles
                  ? [
                      row.articles.article_number,
                      row.articles.name,
                      row.articles.variant_label,
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : row.article_id;
                return (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-2 align-middle whitespace-nowrap">
                      {formatRunCreatedAt(row.created_at)}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Link
                        href={`/articles/${row.article_id}`}
                        className="text-primary hover:underline"
                      >
                        {articleLabel}
                      </Link>
                    </td>
                    <td className="px-3 py-2 align-middle tabular-nums">
                      {row.device_count}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {formatActor(row.user_profiles)}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {/* M21: surface failure_reason inline so an admin can
                          troubleshoot without a DB query. The reason is a
                          structured code from the persist pipeline (e.g.
                          "pdf_render_failed", "rls_denied"). */}
                      <div className="flex items-center gap-2">
                        <StatusBadge
                          entity="qr-label-run"
                          status={row.status}
                        />
                        {row.status === "failed" && row.failure_reason ? (
                          <span
                            className="font-mono text-xs text-muted-foreground"
                            title={row.failure_reason}
                          >
                            {row.failure_reason}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => openPdf(row.storage_path)}
                          aria-label="Etikett-PDF öffnen"
                          className="h-9 w-9 text-muted-foreground hover:text-foreground"
                          disabled={signedUrl.isPending}
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </Button>
                        {isAdmin ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setConfirmDelete({
                                id: row.id,
                                storage_path: row.storage_path,
                              })
                            }
                            aria-label="Druck-Eintrag löschen"
                            className="h-9 w-9 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onPageChange={setPage}
            itemNoun="Druckläufe"
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmDelete(null);
        }}
        title="Druck-Eintrag löschen?"
        description="Der Audit-Eintrag und das zugehörige PDF werden entfernt. Diese Aktion ist nicht rückgängig zu machen."
        confirmLabel="Löschen"
        variant="destructive"
        onConfirm={async () => {
          if (!confirmDelete) return;
          try {
            await deleteRun.mutateAsync(confirmDelete);
          } finally {
            setConfirmDelete(null);
          }
        }}
      />
    </div>
  );
}
