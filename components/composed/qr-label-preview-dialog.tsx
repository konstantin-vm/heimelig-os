"use client";

// Story 3.7 — QR label preview / print / save dialog.
//
// Wraps the entire print flow (qr_code write-back → render → upload →
// signed URL → optional browser print) inside a single Dialog. Three
// footer actions; ALL persist first (audit trail is the source of truth):
//
//   * Speichern         primary; persists, closes, sonner.success
//   * Drucken           persists; opens signed URL in a new tab and triggers
//                       window.print() so the user picks the OS-level label
//                       printer
//   * Herunterladen     persists; downloads via signed URL <a download>
//
// Note: an earlier draft of the AC2 hand-off for Story 3.6 added an
// `autoOpen` prop here. The dialog has no per-device selection step
// (that lives in `<PrintLabelsBatchDialog>`), so the prop was a no-op
// and was removed (L7). If Story 3.6 wires the post-batch-register
// auto-print path later, re-introduce it as part of that change so the
// contract is consumed in the same diff that adds it.

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Download, Loader2, Printer, Save, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useArticleDevices, useDevice } from "@/lib/queries/devices";
import { usePrintLabels } from "@/lib/queries/qr-labels";
import { LABEL_FORMAT_60x40_PORTRAIT } from "@/lib/qr-labels/format";
import {
  prepareQrPayloads,
  type QrLabelDeviceData,
  type QrLabelPayload,
} from "@/lib/qr-labels/render";
import { uuidSchema } from "@/lib/validations/common";

// D2 — live PDF preview. `<PDFViewer>` from `@react-pdf/renderer` is
// browser-only; even with `"use client"` the import gets walked during
// Next's RSC serialization pass, so we wrap it in `next/dynamic({ ssr:
// false })`. `<QrLabelDocument>` is dynamic for the same reason — it
// imports React-PDF primitives at the module level.
const PDFViewer = dynamic(
  () =>
    import("@react-pdf/renderer").then((mod) => ({ default: mod.PDFViewer })),
  { ssr: false },
);
const QrLabelDocument = dynamic(
  () =>
    import("./qr-label-document").then((mod) => ({
      default: mod.QrLabelDocument,
    })),
  { ssr: false },
);

export type QrLabelPreviewDialogMode = "single" | "batch";

export type QrLabelPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: QrLabelPreviewDialogMode;
  /** Device id(s) to print. For mode='single' must contain exactly one id. */
  deviceIds: string[];
  /** Required for both modes — the article that owns these devices (drives
   *  the Storage path's first segment). For mode='single' this can be
   *  derived from useDevice; for batch the caller MUST pass it explicitly. */
  articleId: string | null;
};

export function QrLabelPreviewDialog({
  open,
  onOpenChange,
  mode,
  deviceIds,
  articleId,
}: QrLabelPreviewDialogProps) {
  // Resolve the device payloads. For 'single' use useDevice; for 'batch'
  // the caller's selection might span filters/pagination, so fetch the
  // article-wide list and filter by deviceIds. Both paths land at the
  // same `QrLabelDeviceData[]` shape that <QrLabelDocument> expects.
  const singleId = mode === "single" ? deviceIds[0] ?? null : null;
  const isValidSingle =
    !!singleId && uuidSchema.safeParse(singleId).success;
  const singleQuery = useDevice(isValidSingle ? singleId : null);

  const batchQuery = useArticleDevices(
    mode === "batch" && articleId ? articleId : null,
    {
      includeRetired: true,
      pageSize: 1000,
      page: 1,
    },
  );

  const devices = useMemo<QrLabelDeviceData[]>(() => {
    if (mode === "single") {
      const d = singleQuery.data;
      if (!d) return [];
      const article = d.articles;
      return [
        {
          id: d.id,
          serial_number: d.serial_number,
          qr_code: d.qr_code,
          article_number: article?.article_number ?? "",
          name: article?.name ?? "",
          variant_label: article?.variant_label ?? null,
        },
      ];
    }
    const idSet = new Set(deviceIds);
    return (batchQuery.data?.rows ?? [])
      .filter((row) => idSet.has(row.id))
      .map<QrLabelDeviceData>((row) => ({
        id: row.id,
        serial_number: row.serial_number,
        qr_code: row.qr_code,
        article_number: row.articles?.article_number ?? "",
        name: row.articles?.name ?? "",
        variant_label: row.articles?.variant_label ?? null,
      }));
  }, [mode, singleQuery.data, batchQuery.data, deviceIds]);

  const isLoading =
    (mode === "single" && singleQuery.isLoading) ||
    (mode === "batch" && batchQuery.isLoading);

  const resolvedArticleId = articleId ?? singleQuery.data?.article_id ?? null;

  // D2 — compute the QR PNG data-URLs once `devices` resolves so the live
  // <PDFViewer> can render the same tree the persist path will produce.
  // Re-encodes when the device list changes (Realtime tick → new qr_code).
  const [qrPayloads, setQrPayloads] = useState<QrLabelPayload[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || devices.length === 0) {
      // Don't reset state synchronously in the effect body — let the
      // next successful encode (or the dialog re-open) overwrite it.
      // The render branch `qrPayloads === null` guards against stale
      // values via the dialog-closed path (no rendering happens).
      return;
    }
    let cancelled = false;
    prepareQrPayloads(devices)
      .then((payloads) => {
        if (!cancelled) {
          setQrPayloads(payloads);
          setPreviewError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewError(
          err instanceof Error ? err.message : "QR-Codes konnten nicht erzeugt werden.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, devices]);

  const printMutation = usePrintLabels();

  // Track which action the user clicked so the loading state lights up the
  // right button (Speichern / Drucken / Herunterladen).
  const [pendingAction, setPendingAction] = useState<
    null | "save" | "print" | "download"
  >(null);

  // pendingAction is reset by every handler in its `finally`-equivalent path
  // (we always call setPendingAction(null) before returning), and the
  // dialog can't close while `busy === true` (onOpenChange is gated below).
  // No effect is needed to mirror the open prop.

  async function persist(): Promise<{ signedUrl: string } | null> {
    if (!resolvedArticleId) {
      toast.error("Artikel-Kontext fehlt — bitte Seite neu laden.");
      return null;
    }
    if (devices.length === 0) {
      toast.error("Keine Geräte zum Drucken.");
      return null;
    }
    try {
      const result = await printMutation.mutateAsync({
        articleId: resolvedArticleId,
        devices,
      });
      return { signedUrl: result.signedUrl };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // M20: route RLS-deny to a distinct, longer-lived toast so the user
      // notices and re-authenticates rather than retrying blindly.
      if (/Berechtigung|RLS|policy|42501|rls_denied/i.test(msg)) {
        toast.error("Berechtigung verweigert — bitte Login prüfen.", {
          duration: 6000,
        });
      } else {
        toast.error("Etiketten konnten nicht erzeugt werden.", {
          description: msg || undefined,
        });
      }
      return null;
    }
  }

  async function handleSave() {
    setPendingAction("save");
    const persisted = await persist();
    setPendingAction(null);
    if (!persisted) return;
    toast.success(
      devices.length === 1 ? "Etikett gespeichert." : "Etiketten gespeichert.",
    );
    onOpenChange(false);
  }

  async function handlePrint() {
    setPendingAction("print");
    const persisted = await persist();
    setPendingAction(null);
    if (!persisted) return;
    // M1 + M12: cross-origin signed URLs block `win.print()` (SecurityError)
    // and the call silently fails. Drop the .print() attempt entirely; tell
    // the user to use the OS shortcut. Detect popup-blocker so the toast
    // doesn't lie about success.
    const win = window.open(persisted.signedUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      toast.error(
        "Popup blockiert — bitte Etiketten manuell aus dem Audit-Verlauf öffnen.",
      );
      return;
    }
    toast.success("Etiketten gespeichert.", {
      description: "PDF im neuen Tab geöffnet — bitte mit ⌘P / Strg-P drucken.",
      duration: 6000,
    });
    onOpenChange(false);
  }

  async function handleDownload() {
    setPendingAction("download");
    const persisted = await persist();
    setPendingAction(null);
    if (!persisted) return;
    // M13: signed URLs are cross-origin so `<a download>` is ignored by the
    // browser (Storage serves Content-Disposition: inline). Append Supabase
    // Storage's `?download=` query param to force the attachment header.
    const downloadName = `qr-labels-${devices.length}.pdf`;
    const sep = persisted.signedUrl.includes("?") ? "&" : "?";
    const downloadUrl = `${persisted.signedUrl}${sep}download=${encodeURIComponent(downloadName)}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = downloadName;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("Etiketten gespeichert. Download startet.");
    onOpenChange(false);
  }

  const busy = pendingAction !== null;
  const titleSuffix =
    devices.length === 1 ? "1 Gerät" : `${devices.length} Geräte`;

  return (
    <Dialog open={open} onOpenChange={busy ? () => {} : onOpenChange}>
      <DialogContent
        className="sm:max-w-[1008px]"
        // M11: Radix's outside-click + Escape close paths are NOT routed
        // through onOpenChange, so the busy gate above doesn't catch them.
        // Block them explicitly while a mutation is in flight.
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>QR-Etiketten drucken</DialogTitle>
          <DialogDescription>
            {`Erzeugt ein PDF (60 × 40 mm pro Etikett) für ${titleSuffix} und speichert es im Audit-Verlauf.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Geräte werden geladen…
            </div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Geräte zum Drucken.
            </p>
          ) : previewError ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {`Vorschau konnte nicht erzeugt werden: ${previewError}`}
            </p>
          ) : qrPayloads === null ? (
            <div className="flex h-64 items-center justify-center gap-2 rounded-md border bg-muted/40 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {`Erzeuge Vorschau für ${devices.length} ${devices.length === 1 ? "Etikett" : "Etiketten"}…`}
            </div>
          ) : (
            <div
              className="overflow-hidden rounded-md border bg-muted/40"
              aria-label="PDF-Vorschau der Etiketten"
            >
              <PDFViewer
                showToolbar
                style={{ width: "100%", height: "60vh", border: 0 }}
              >
                <QrLabelDocument
                  devices={qrPayloads}
                  format={LABEL_FORMAT_60x40_PORTRAIT}
                />
              </PDFViewer>
              {/* Fallback list for screen-reader users — <PDFViewer>
                  renders an iframe whose contents are opaque to AT. */}
              <ul className="sr-only">
                {devices.map((d) => (
                  <li key={d.id}>
                    {d.serial_number} · {d.article_number} {d.name}
                    {d.variant_label ? ` ${d.variant_label}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Hinweis: Nach dem Speichern wird die PDF in einem neuen Tab
            geöffnet — so kann der Etikettendrucker direkt im OS-Druck-Dialog
            gewählt werden.
          </p>
          {/* M19 / AC-PERF — long batches get a "still working" hint;
              @react-pdf/renderer v4.5 has no per-page progress hook. */}
          {busy && devices.length > 200 ? (
            <p
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {`Erstelle ${devices.length} Etiketten… (kann bis zu 60 Sekunden dauern)`}
            </p>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" aria-hidden />
            Abbrechen
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={busy || devices.length === 0}
              onClick={handleDownload}
            >
              {pendingAction === "download" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              Herunterladen
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || devices.length === 0}
              onClick={handlePrint}
            >
              {pendingAction === "print" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Printer className="h-4 w-4" aria-hidden />
              )}
              Drucken
            </Button>
            <Button
              type="button"
              disabled={busy || devices.length === 0}
              onClick={handleSave}
            >
              {pendingAction === "save" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              Speichern
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
