"use client";

// Story 3.7 — Per-article batch print selection dialog.
//
// Opens from <ArticleDevicesCard>'s "Etiketten drucken" CTA. Shows a
// checkbox list of every active device for the article. Default: all
// selected. The user can deselect individual rows for a partial re-print.
// Retired devices are intentionally INCLUDED (re-print scenario — the
// admin explicitly opts out by deselecting them).
//
// When the selection size > 50 the user gets a <ConfirmDialog> "Druckt {n}
// Etiketten — fortfahren?" before <QrLabelPreviewDialog> opens.

import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useArticleDevices } from "@/lib/queries/devices";

import { ConfirmDialog } from "./confirm-dialog";
import { QrLabelPreviewDialog } from "./qr-label-preview-dialog";

const BATCH_CONFIRM_THRESHOLD = 50;

export type PrintLabelsBatchDialogProps = {
  articleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PrintLabelsBatchDialog({
  articleId,
  open,
  onOpenChange,
}: PrintLabelsBatchDialogProps) {
  const devicesQuery = useArticleDevices(articleId, {
    includeRetired: true,
    pageSize: 1000,
    page: 1,
  });

  const allDevices = useMemo(
    () => devicesQuery.data?.rows ?? [],
    [devicesQuery.data?.rows],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [userTouched, setUserTouched] = useState(false);

  // M8: default selection = all devices, but ONLY when the user hasn't
  // touched the selection yet. A Realtime tick that refreshes
  // `allDevices` while the dialog is open used to stomp on a manual
  // de-selection; `userTouched` blocks that.
  // userTouched persists across close/reopen of the same article — if a
  // user wants a fresh "all devices" selection they can hit "Alle
  // auswählen". Resetting userTouched here would require a setState
  // inside an effect (forbidden under react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    if (userTouched) return;
    setSelectedIds(new Set(allDevices.map((d) => d.id)));
  }, [open, allDevices, userTouched]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  function toggle(id: string) {
    setUserTouched(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setUserTouched(true);
    setSelectedIds(new Set(allDevices.map((d) => d.id)));
  }

  function clearAll() {
    setUserTouched(true);
    setSelectedIds(new Set());
  }

  function handlePreview() {
    if (selectedIds.size === 0) return;
    if (selectedIds.size > BATCH_CONFIRM_THRESHOLD) {
      setConfirmOpen(true);
      return;
    }
    setPreviewOpen(true);
  }

  const selectedCount = selectedIds.size;
  const totalCount = allDevices.length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Etiketten drucken</DialogTitle>
            <DialogDescription>
              {`${selectedCount} von ${totalCount} Geräten ausgewählt.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={selectAll}
              >
                Alle auswählen
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={clearAll}
              >
                Alle abwählen
              </Button>
            </div>
            {devicesQuery.isLoading ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Laden…
              </span>
            ) : null}
          </div>
          {/* M10: warn the user when the device list was truncated by the
              1000-row pageSize cap so they don't print silently-incomplete
              batches. Only Heimelig articles with > 1000 devices hit this
              path today, but defensive against future growth. */}
          {(devicesQuery.data?.total ?? 0) > allDevices.length ? (
            <p
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            >
              {`Nur die ersten ${allDevices.length} Geräte werden angezeigt (insgesamt ${devicesQuery.data?.total}). Bitte in mehreren Chargen drucken.`}
            </p>
          ) : null}

          <ul className="max-h-80 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2">
            {allDevices.length === 0 && !devicesQuery.isLoading ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">
                Keine Geräte vorhanden.
              </li>
            ) : (
              allDevices.map((d) => {
                const checked = selectedIds.has(d.id);
                return (
                  <li
                    key={d.id}
                    className="flex items-center gap-3 rounded px-2 py-1 hover:bg-muted/60"
                  >
                    <Checkbox
                      id={`batch-print-${d.id}`}
                      checked={checked}
                      onCheckedChange={() => toggle(d.id)}
                      aria-label={`${d.serial_number} auswählen`}
                    />
                    <label
                      htmlFor={`batch-print-${d.id}`}
                      className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-sm"
                    >
                      <span className="font-mono text-xs">
                        {d.serial_number}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {d.status}
                        {d.retired_at ? " · ausgemustert" : ""}
                      </span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>

          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              disabled={selectedCount === 0}
              onClick={handlePreview}
            >
              <Printer className="h-4 w-4" aria-hidden />
              Vorschau ({selectedCount})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Großer Druckauftrag"
        description={`Es werden ${selectedCount} Etiketten erzeugt. Fortfahren?`}
        confirmLabel="Vorschau öffnen"
        onConfirm={() => {
          setConfirmOpen(false);
          setPreviewOpen(true);
        }}
      />

      <QrLabelPreviewDialog
        open={previewOpen}
        onOpenChange={(next) => {
          setPreviewOpen(next);
          if (!next) {
            // Closing the preview also closes the batch dialog so the user
            // returns to the article-detail page after a successful save.
            onOpenChange(false);
          }
        }}
        mode="batch"
        deviceIds={Array.from(selectedIds)}
        articleId={articleId}
      />
    </>
  );
}
