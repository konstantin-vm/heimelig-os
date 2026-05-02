"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { ADDRESS_TYPE_LABELS } from "@/lib/constants/address";
import {
  customerKeys,
  useCustomerAddresses,
  useSoftDeleteCustomerAddress,
} from "@/lib/queries/customers";

import {
  AddressDialog,
  type AddressDialogMode,
} from "./address-dialog";
import { AddressRow, formatAddressLine } from "./address-row";
import { ConfirmDialog } from "./confirm-dialog";

export type CustomerAddressesCardProps = {
  customerId: string;
  /** Display label used in the delete-confirm body, e.g. "Huber, Margrit". */
  customerLabel?: string;
};

function pluralize(total: number, primary: number): string {
  if (total === 0) return "Noch keine Adressen erfasst";
  const extra = total - primary;
  if (primary > 0 && extra === 0) return "1 Hauptadresse";
  if (primary === 0) return `${extra}× zusätzliche Adresse${extra === 1 ? "" : "n"}`;
  return `1 Hauptadresse · ${extra}× zusätzliche Adresse${extra === 1 ? "" : "n"}`;
}

export function CustomerAddressesCard({
  customerId,
  customerLabel,
}: CustomerAddressesCardProps) {
  const { data: addresses = [], isLoading } = useCustomerAddresses(customerId);
  const queryClient = useQueryClient();
  const channelSuffix = useId();

  const [dialogState, setDialogState] = useState<{
    open: boolean;
    mode: AddressDialogMode;
    addressId?: string;
  }>({ open: false, mode: "add" });

  const dialogAddress = useMemo(() => {
    if (!dialogState.addressId) return undefined;
    return addresses.find((a) => a.id === dialogState.addressId);
  }, [addresses, dialogState.addressId]);

  const [rowDelete, setRowDelete] = useState<{ id: string } | null>(null);
  const rowDeleteAddress = rowDelete
    ? addresses.find((a) => a.id === rowDelete.id)
    : null;

  const softDeleteMutation = useSoftDeleteCustomerAddress();

  // Realtime subscription — invalidate the addresses cache on every change to
  // this customer's customer_addresses rows. Channel name includes useId()
  // suffix to avoid double-subscription under React strict mode + HMR
  // (Story 2.2 review patch).
  // Round-2 review: also invalidate `customerKeys.detail(customerId)` so a
  // cross-session change to a primary-address row refreshes the customer
  // detail header (which renders the primary address). Mutation hooks
  // already do this; Realtime now matches that contract.
  useEffect(() => {
    if (!customerId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`customer_addresses:${customerId}:${channelSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customer_addresses",
          filter: `customer_id=eq.${customerId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: customerKeys.addresses(customerId),
          });
          queryClient.invalidateQueries({
            queryKey: customerKeys.detail(customerId),
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerId, queryClient, channelSuffix]);

  const primaryCount = addresses.filter(
    (a) => a.address_type === "primary",
  ).length;

  function openAdd() {
    setDialogState({ open: true, mode: "add" });
  }

  function openEdit(addressId: string) {
    const a = addresses.find((row) => row.id === addressId);
    if (!a) return;
    setDialogState({ open: true, mode: "edit", addressId });
  }

  function openRowDelete(addressId: string) {
    setRowDelete({ id: addressId });
  }

  async function confirmRowDelete() {
    if (!rowDelete) return;
    const target = rowDelete;
    // Snapshot whether the row was a default at delete-time so the restore
    // toast can hint that the row will come back as non-default. Round-2
    // review: previously the restore toast was silent about the lost
    // default flag, leaving the user to discover the change on their own.
    const wasDefault =
      addresses.find((a) => a.id === target.id)?.is_default_for_type ??
      false;
    try {
      await softDeleteMutation.mutateAsync({
        customerId,
        addressId: target.id,
      });
      setRowDelete(null);
      toast.success("Adresse gelöscht.", {
        action: {
          label: "Rückgängig",
          onClick: () => {
            softDeleteMutation.mutate(
              {
                customerId,
                addressId: target.id,
                restore: true,
              },
              {
                onSuccess: () => {
                  toast.success(
                    "Adresse wiederhergestellt.",
                    wasDefault
                      ? {
                          description:
                            "Hinweis: Die Adresse kommt als Nicht-Hauptadresse zurück. Bitte bei Bedarf erneut als Hauptadresse markieren.",
                        }
                      : undefined,
                  );
                },
                onError: (err) => {
                  toast.error("Wiederherstellen fehlgeschlagen.", {
                    description: err instanceof Error ? err.message : undefined,
                  });
                },
              },
            );
          },
        },
      });
    } catch (err) {
      toast.error("Löschen fehlgeschlagen.", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const showPrimaryMissingHint = !isLoading && primaryCount === 0;
  // Round-2 review: empty-state should fire for the steady-state "primary
  // present, no extras" — post-Story-2.1 the primary always exists, so
  // gating on `addresses.length === 0` left the empty CTA unreachable. The
  // empty branch now considers only non-primary rows.
  const extrasCount = addresses.filter(
    (a) => a.address_type !== "primary",
  ).length;
  const showEmptyState = !isLoading && extrasCount === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Adressen</CardTitle>
          <p className="text-xs text-muted-foreground">
            {pluralize(addresses.length, primaryCount)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Adresse hinzufügen"
          title="Adresse hinzufügen"
          onClick={openAdd}
        >
          <Plus aria-hidden />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Daten werden geladen…
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {showPrimaryMissingHint ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Hauptadresse fehlt — über „Bearbeiten“ auf dem Kundenprofil
                ergänzen.
              </p>
            ) : null}
            {addresses.map((address) => (
              <AddressRow
                key={address.id}
                address={address}
                customerLabel={customerLabel}
                onEdit={openEdit}
                onDelete={openRowDelete}
              />
            ))}
            {showEmptyState ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Noch keine zusätzliche Adresse erfasst.
                </p>
                <Button type="button" variant="outline" onClick={openAdd}>
                  Adresse hinzufügen
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>

      <AddressDialog
        open={dialogState.open}
        onOpenChange={(next) =>
          setDialogState((prev) => ({ ...prev, open: next }))
        }
        mode={dialogState.mode}
        customerId={customerId}
        customerLabel={customerLabel}
        address={dialogAddress}
      />

      <ConfirmDialog
        open={rowDelete !== null}
        onOpenChange={(next) => {
          if (!next) setRowDelete(null);
        }}
        title="Adresse löschen?"
        description={(() => {
          if (!rowDeleteAddress) return null;
          // Round-2 review: use the shared `formatAddressLine` helper so
          // the delete-confirm body matches the AddressRow display for
          // foreign-country addresses (previously omitted country here).
          const addressLine = formatAddressLine(rowDeleteAddress) || "—";
          const recipient = rowDeleteAddress.recipient_name?.trim() || addressLine;
          const typeLabel = ADDRESS_TYPE_LABELS[rowDeleteAddress.address_type];
          const customerHint = customerLabel?.trim()
            ? ` ${customerLabel.trim()}`
            : "";
          return `${recipient} (${typeLabel}) wird vom Kunden${customerHint} entfernt. Bestehende Aufträge mit dieser Adresse bleiben unverändert.`;
        })()}
        confirmLabel="Löschen"
        variant="standard"
        onConfirm={confirmRowDelete}
      />
    </Card>
  );
}
