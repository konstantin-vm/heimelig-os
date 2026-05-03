"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useCustomer,
  useLatestContactSyncError,
  useSyncCustomerToBexio,
} from "@/lib/queries/customers";
import { formatDate } from "@/lib/utils/format";

import { BexioSyncBadge } from "./bexio-sync-badge";
import { DefinitionRow } from "./definition-row";

export type BexioContactCardProps = {
  customerId: string;
};

/**
 * Customer-profile bexio card with the four design states from Pencil
 * S-004 §"Bexio card states":
 *
 *   * Synced     — green badge + last-synced timestamp, no action.
 *   * Pending    — orange badge + "Status prüfen" link triggering a
 *                  manual sync (cron is the safety net; this is the
 *                  user-facing override).
 *   * Failed     — red badge + latest error message from `error_log`
 *                  (entity=customers, source=contact-sync) + "Erneut
 *                  synchronisieren" button.
 *   * Never sync — muted badge + "In bexio anlegen" CTA.
 *
 * Story 2.6 AC11 / AC12.
 */
export function BexioContactCard({ customerId }: BexioContactCardProps) {
  const { data: customer, isLoading } = useCustomer(customerId);
  const status = customer?.bexio_sync_status ?? null;
  // Review round 1 — `'in_progress'` is the operational reservation flag
  // added by migration 00041; treat it like `'pending'` from the user's
  // perspective (Pencil S-004 has 4 states, not 5).
  const isPending = status === "pending" || status === "in_progress";
  const isFailed = status === "failed";
  const latestError = useLatestContactSyncError(isFailed ? customerId : null);
  const syncMutation = useSyncCustomerToBexio({
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Mit bexio synchronisiert");
      } else {
        toast.error(
          result.message ||
            "Synchronisation fehlgeschlagen — siehe Fehlerprotokoll",
        );
      }
    },
    onError: () => {
      toast.error(
        "Synchronisation fehlgeschlagen — siehe Fehlerprotokoll",
      );
    },
  });

  const handleSync = () => {
    if (syncMutation.isPending) return;
    syncMutation.mutate(customerId);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle>bexio</CardTitle>
        <BexioSyncBadge status={status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading || !customer ? (
          <p className="py-2 text-sm text-muted-foreground">
            Daten werden geladen…
          </p>
        ) : (
          <>
            <DefinitionRow
              label="bexio Kontakt-ID"
              value={
                customer.bexio_contact_id !== null
                  ? String(customer.bexio_contact_id)
                  : null
              }
              emptyPlaceholder="Nicht verknüpft"
            />
            <DefinitionRow
              label="Zuletzt synchronisiert"
              value={
                customer.bexio_synced_at
                  ? formatDate(customer.bexio_synced_at)
                  : null
              }
              emptyPlaceholder="—"
            />

            {/* State-driven affordances — exactly one of the four blocks renders. */}
            {isPending && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="text-xs text-muted-foreground">
                  Synchronisation läuft (max. 5 Min.)
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncMutation.isPending}
                >
                  {syncMutation.isPending ? "Prüfe…" : "Status prüfen"}
                </Button>
              </div>
            )}

            {status === "failed" && (
              <div className="flex flex-col gap-2 pt-1">
                <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                  {latestError.data?.message ??
                    "Letzter Synchronisationsversuch fehlgeschlagen."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncMutation.isPending}
                  className="self-start"
                >
                  {syncMutation.isPending
                    ? "Synchronisiere…"
                    : "Erneut synchronisieren"}
                </Button>
              </div>
            )}

            {customer.bexio_contact_id === null && !isPending &&
              status !== "failed" && (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncMutation.isPending}
                  className="self-start"
                >
                  {syncMutation.isPending
                    ? "Lege an…"
                    : "In bexio anlegen"}
                </Button>
              )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
