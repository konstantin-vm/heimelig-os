"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCustomer } from "@/lib/queries/customers";
import { formatDate } from "@/lib/utils/format";

import { BexioSyncBadge } from "./bexio-sync-badge";
import { DefinitionRow } from "./definition-row";

export type BexioContactCardProps = {
  customerId: string;
};

/**
 * Read-only Sprint-1 view of the customer's bexio contact link. Reads
 * `bexio_contact_id`, `bexio_sync_status`, `bexio_synced_at` from the existing
 * `customers` row (no extra query — pulls from `useCustomer` cache).
 *
 * **No resync action** — Story 2.6 owns the bexio sync flow and adds the
 * "Erneut synchronisieren" button + `bexio-contact-sync` Edge Function. When
 * `bexio_contact_id` is null, this card surfaces a muted helper note pointing
 * forward to 2.6.
 */
export function BexioContactCard({ customerId }: BexioContactCardProps) {
  const { data: customer, isLoading } = useCustomer(customerId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle>bexio</CardTitle>
        <BexioSyncBadge status={customer?.bexio_sync_status ?? null} />
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
            {customer.bexio_contact_id === null ? (
              <p className="rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                Synchronisierung wird mit Story 2.6 verfügbar.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
