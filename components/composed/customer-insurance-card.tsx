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
import {
  customerKeys,
  useCustomerInsurances,
  useSoftDeleteCustomerInsurance,
} from "@/lib/queries/customers";

import { ConfirmDialog } from "./confirm-dialog";
import {
  InsuranceDialog,
  type InsuranceDialogMode,
} from "./insurance-dialog";
import { InsuranceRow } from "./insurance-row";

export type CustomerInsuranceCardProps = {
  customerId: string;
  /** Display label used in the delete-confirm body, e.g. "Huber, Margrit". */
  customerLabel?: string;
};

function pluralize(grund: number, zusatz: number): string {
  const total = grund + zusatz;
  if (total === 0) return "Noch keine Versicherungen";
  const parts: string[] = [];
  if (grund > 0) parts.push(`${grund}× Grund`);
  if (zusatz > 0) parts.push(`${zusatz}× Zusatz`);
  return parts.join(" · ");
}

export function CustomerInsuranceCard({
  customerId,
  customerLabel,
}: CustomerInsuranceCardProps) {
  const { data: insurances = [], isLoading } = useCustomerInsurances(customerId);
  const queryClient = useQueryClient();
  const channelSuffix = useId();

  const [dialogState, setDialogState] = useState<{
    open: boolean;
    mode: InsuranceDialogMode;
    insuranceId?: string;
  }>({ open: false, mode: "add" });

  const dialogInsurance = useMemo(() => {
    if (!dialogState.insuranceId) return undefined;
    return insurances.find((i) => i.id === dialogState.insuranceId);
  }, [insurances, dialogState.insuranceId]);

  const [rowDelete, setRowDelete] = useState<{ id: string } | null>(null);
  const rowDeleteInsurance = rowDelete
    ? insurances.find((i) => i.id === rowDelete.id)
    : null;

  const softDeleteMutation = useSoftDeleteCustomerInsurance();

  useEffect(() => {
    if (!customerId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`customer_insurance:${customerId}:${channelSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customer_insurance",
          filter: `customer_id=eq.${customerId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: customerKeys.insurance(customerId),
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerId, queryClient, channelSuffix]);

  const grundCount = insurances.filter(
    (i) => i.insurance_type === "grund",
  ).length;
  const zusatzCount = insurances.filter(
    (i) => i.insurance_type === "zusatz",
  ).length;

  function openAdd() {
    setDialogState({ open: true, mode: "add" });
  }

  function openEdit(insuranceId: string) {
    const i = insurances.find((row) => row.id === insuranceId);
    if (!i) return;
    setDialogState({ open: true, mode: "edit", insuranceId });
  }

  function openRowDelete(insuranceId: string) {
    setRowDelete({ id: insuranceId });
  }

  async function confirmRowDelete() {
    if (!rowDelete) return;
    const target = rowDelete;
    try {
      await softDeleteMutation.mutateAsync({
        customerId,
        insuranceId: target.id,
      });
      setRowDelete(null);
      toast.success("Versicherung gelöscht.", {
        action: {
          label: "Rückgängig",
          onClick: () => {
            softDeleteMutation.mutate(
              {
                customerId,
                insuranceId: target.id,
                restore: true,
              },
              {
                onSuccess: () => {
                  toast.success("Versicherung wiederhergestellt.");
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Versicherung</CardTitle>
          <p className="text-xs text-muted-foreground">
            {pluralize(grundCount, zusatzCount)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Versicherung hinzufügen"
          title="Versicherung hinzufügen"
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
        ) : insurances.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Noch keine Versicherung erfasst.
            </p>
            <Button type="button" variant="outline" onClick={openAdd}>
              Versicherung hinzufügen
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {insurances.map((insurance) => (
              <InsuranceRow
                key={insurance.id}
                insurance={insurance}
                onEdit={openEdit}
                onDelete={openRowDelete}
              />
            ))}
          </div>
        )}
      </CardContent>

      <InsuranceDialog
        open={dialogState.open}
        onOpenChange={(next) =>
          setDialogState((prev) => ({ ...prev, open: next }))
        }
        mode={dialogState.mode}
        customerId={customerId}
        customerLabel={customerLabel}
        insurance={dialogInsurance}
      />

      <ConfirmDialog
        open={rowDelete !== null}
        onOpenChange={(next) => {
          if (!next) setRowDelete(null);
        }}
        title="Versicherung löschen?"
        description={(() => {
          if (!rowDeleteInsurance) return null;
          const insurer =
            rowDeleteInsurance.partner_insurers?.name ??
            rowDeleteInsurance.insurer_name_freetext ??
            "—";
          const typeLabel =
            rowDeleteInsurance.insurance_type === "grund" ? "Grund" : "Zusatz";
          const customerHint = customerLabel?.trim()
            ? ` ${customerLabel.trim()}`
            : "";
          return `${insurer} (${typeLabel}) wird vom Kunden${customerHint} entfernt. Bestehende Verträge mit KK-Split bleiben unverändert.`;
        })()}
        confirmLabel="Löschen"
        variant="standard"
        onConfirm={confirmRowDelete}
      />
    </Card>
  );
}
