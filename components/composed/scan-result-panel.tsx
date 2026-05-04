"use client";

// <ScanResultPanel> — Story 3.5.
//
// Three render branches for the post-scan flow:
//   * loading      → spinner + "Gerät wird gesucht…"
//   * not-found    → destructive alert + "Erneut scannen" CTA
//   * found        → device summary card + "Status ändern" button →
//                    opens <DeviceStatusTransitionDialog> (Story 3.3)
//
// After a successful transition the panel auto-clears 1.5s later so the
// worker can scan the next device without an extra tap. The 1.5s delay is
// long enough to read the success toast but short enough that a worker
// rebooking 5–10 devices in 30s does not feel rate-limited.
//
// Reuse, do not fork:
//   * `<DeviceStatusTransitionDialog>` (Story 3.3) handles all status-change
//     UI — including AC-AX tap-target sizes, the inline German error region,
//     and the destructive-confirm gate on `→ sold`. Wrap it as-is.

import { useEffect, useState } from "react";
import { Loader2, ScanLine } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppRole } from "@/lib/hooks/use-app-role";
import { useDeviceByQrPayload } from "@/lib/queries/devices";

import { DeviceStatusTransitionDialog } from "./device-status-transition-dialog";
import { StatusBadge } from "./status-badge";

const AUTO_CLEAR_DELAY_MS = 1500;

export type ScanResultPanelProps = {
  payload: string | null;
  onClear: () => void;
};

export function ScanResultPanel({ payload, onClear }: ScanResultPanelProps) {
  const role = useAppRole();
  const query = useDeviceByQrPayload(payload, {
    role: role.data,
    enabled: !role.isPending,
  });
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [autoClearArmed, setAutoClearArmed] = useState(false);

  // Schedule the auto-clear after a successful transition. Wired to the
  // dialog's `onSuccess` (Story 3.5 review): cancel-by-Escape no longer
  // yanks the worker back to the camera 1.5s later.
  useEffect(() => {
    if (!autoClearArmed) return;
    const timer = setTimeout(() => {
      setAutoClearArmed(false);
      onClear();
    }, AUTO_CLEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoClearArmed, onClear]);

  if (payload == null) return null;

  // `isPending` covers the initial fetch only — background refetches
  // triggered by `deviceKeys.all` invalidations (e.g. after a successful
  // status transition) keep the device card visible instead of flashing
  // back to the spinner mid-view.
  if (query.isPending) {
    return (
      <section
        role="region"
        aria-label="Scan-Ergebnis"
        aria-busy="true"
        className="flex flex-col items-center gap-3 rounded-lg border border-input bg-muted/30 p-6 text-sm text-muted-foreground"
      >
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span aria-live="polite">Gerät wird gesucht…</span>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section role="region" aria-label="Scan-Ergebnis">
        <Alert variant="destructive">
          <AlertTitle>Suche fehlgeschlagen</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>
              Die Geräteabfrage konnte nicht abgeschlossen werden. Bitte erneut
              versuchen.
            </span>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 self-start"
              onClick={onClear}
            >
              <ScanLine className="mr-2 h-4 w-4" aria-hidden />
              Erneut scannen
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const device = query.data;
  if (device == null) {
    return (
      <section role="region" aria-label="Scan-Ergebnis">
        <Alert variant="destructive">
          <AlertTitle>Gerät nicht gefunden</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>
              Der gescannte Code konnte keinem Gerät zugeordnet werden.
            </span>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 self-start"
              onClick={onClear}
            >
              <ScanLine className="mr-2 h-4 w-4" aria-hidden />
              Erneut scannen
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const articleName = device.articles?.name ?? "Unbekannter Artikel";
  const variantLabel = device.articles?.variant_label;
  const warehouseName = device.warehouses?.name ?? "—";

  return (
    <section role="region" aria-label="Scan-Ergebnis" className="flex flex-col gap-4">
      <article className="flex flex-col gap-3 rounded-lg border border-input bg-card p-4 shadow-sm">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold leading-tight">
            {articleName}
            {variantLabel ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {variantLabel}
              </span>
            ) : null}
          </h2>
          <p className="font-mono text-sm text-muted-foreground">
            {device.serial_number}
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <StatusBadge entity="device" status={device.status} />
          </dd>

          <dt className="text-muted-foreground">Zustand</dt>
          <dd className="flex items-center gap-2">
            <StatusBadge entity="device-condition" status={device.condition} />
            {device.is_new ? (
              <Badge variant="secondary" className="text-xs">
                Neu
              </Badge>
            ) : null}
          </dd>

          <dt className="text-muted-foreground">Standort</dt>
          <dd className="text-foreground">{warehouseName}</dd>
        </dl>

        <Button
          type="button"
          className="min-h-11"
          onClick={() => setTransitionOpen(true)}
        >
          Status ändern
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={onClear}
        >
          <ScanLine className="mr-2 h-4 w-4" aria-hidden />
          Nächstes Gerät scannen
        </Button>
      </article>

      <DeviceStatusTransitionDialog
        device={{
          id: device.id,
          status: device.status,
          article_id: device.article_id,
          serial_number: device.serial_number,
        }}
        open={transitionOpen}
        onOpenChange={setTransitionOpen}
        onSuccess={() => setAutoClearArmed(true)}
      />
    </section>
  );
}
