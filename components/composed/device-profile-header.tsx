"use client";

// <DeviceProfileHeader> — Story 3.2.
//
// Mirrors `<ArticleProfileHeader>` (Story 3.1):
//   * Title: `<serial> — <article_number> <name> <variant_label>`
//   * Two badges (status + condition) via the extended `<StatusBadge>`
//   * Bearbeiten action — opens `<DeviceEditForm mode='edit'>` via the parent
//   * Löschen action — admin-only (RLS enforces too); soft-delete via
//     `useDeviceSoftDelete` (`retired_at = today/CET`)

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Pencil, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAppRole } from "@/lib/hooks/use-app-role";
import { useDevice, useDeviceSoftDelete } from "@/lib/queries/devices";

import { ConfirmDialog } from "./confirm-dialog";
import { DeviceStatusTransitionDialog } from "./device-status-transition-dialog";
import { QrLabelPreviewDialog } from "./qr-label-preview-dialog";
import { StatusBadge } from "./status-badge";

export type DeviceProfileHeaderProps = {
  deviceId: string;
  /** Click handler — opens the shared `<DeviceEditForm>` in edit mode. */
  onEdit: () => void;
};

export function DeviceProfileHeader({
  deviceId,
  onEdit,
}: DeviceProfileHeaderProps) {
  const router = useRouter();
  const { data: device, isLoading } = useDevice(deviceId);
  const { data: role } = useAppRole();
  const isAdmin = role === "admin";
  // Admin / office / warehouse can transition status. Technician + anyone
  // without a resolved role is hidden from the action — the SECURITY DEFINER
  // RPC re-validates as the authoritative gate (raises 42501 for any other
  // role) per Story 3.3 AC7.
  const canTransitionStatus =
    role === "admin" || role === "office" || role === "warehouse";
  // Same role gate for QR label print (Story 3.7 AC1 + AC-RLS).
  const canPrintLabel = canTransitionStatus;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const softDelete = useDeviceSoftDelete({
    onSuccess: (data) => {
      toast.success("Gerät ausgemustert.");
      setDeleteOpen(false);
      // Send the user back to the article so they don't stare at a now-retired
      // device. Article id resolves from the mutation result.
      if (data?.article_id) {
        router.push(`/articles/${data.article_id}`);
      }
    },
    onError: (err) => {
      toast.error("Gerät konnte nicht ausgemustert werden", {
        description: err.message,
      });
      setDeleteOpen(false);
    },
  });

  const articleLabel = device
    ? [
        device.articles?.article_number,
        device.articles?.name,
        device.articles?.variant_label,
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const title = device
    ? `${device.serial_number}${articleLabel ? ` — ${articleLabel}` : ""}`
    : "—";

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="truncate text-2xl font-bold tracking-tight text-primary">
          {isLoading ? "…" : title}
        </h1>
        {device ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge entity="device" status={device.status} />
            <StatusBadge entity="device-condition" status={device.condition} />
          </div>
        ) : null}
      </div>
      <div
        className="flex flex-wrap items-center gap-2 sm:justify-end"
        role="group"
        aria-label="Geräteaktionen"
      >
        {canTransitionStatus ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTransitionOpen(true)}
            aria-label="Status ändern"
            disabled={isLoading || !device}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden />
            Status ändern
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          aria-label="Gerät bearbeiten"
          disabled={isLoading || !device}
        >
          <Pencil className="h-4 w-4" aria-hidden />
          Bearbeiten
        </Button>
        {canPrintLabel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPrintOpen(true)}
            aria-label="Etikett drucken"
            disabled={isLoading || !device}
          >
            <Printer className="h-4 w-4" aria-hidden />
            Etikett drucken
          </Button>
        ) : null}
        {isAdmin ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            aria-label="Gerät ausmustern"
            className="text-destructive hover:text-destructive"
            disabled={isLoading || !device}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Ausmustern
          </Button>
        ) : null}
      </div>

      {device && canTransitionStatus ? (
        <DeviceStatusTransitionDialog
          device={{
            id: device.id,
            status: device.status,
            article_id: device.article_id,
            serial_number: device.serial_number,
          }}
          open={transitionOpen}
          onOpenChange={setTransitionOpen}
        />
      ) : null}

      {device && canPrintLabel ? (
        <QrLabelPreviewDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          mode="single"
          deviceIds={[device.id]}
          articleId={device.article_id}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Gerät ausmustern?"
        description={
          device
            ? `Das Gerät ${device.serial_number} wird mit dem heutigen Datum als ausgemustert markiert (retired_at). Es bleibt in den Daten erhalten, ist aber für neue Aufträge nicht mehr verfügbar.`
            : null
        }
        confirmLabel="Ausmustern"
        variant="destructive"
        onConfirm={async () => {
          await softDelete.mutateAsync({ id: deviceId });
        }}
      />
    </header>
  );
}
