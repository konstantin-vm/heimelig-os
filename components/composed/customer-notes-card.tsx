"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { customerKeys, useCustomer } from "@/lib/queries/customers";
import { logError } from "@/lib/utils/error-log";

export type CustomerNotesCardProps = {
  customerId: string;
};

/**
 * Story 2.5.1 — MTG-008 add-on. Two-section notes card:
 *
 *   * Backoffice — editable textarea wired to `customers.notes` (the existing
 *     freetext slot from Story 2.1; no new column needed). RLS gates the
 *     UPDATE to admin/office; the audit trigger (`trg_customers_audit` from
 *     migration 00014) records every change.
 *   * Monteur — read-only Epic-8 stub. Becomes a live feed of technician tour
 *     notes once the Monteur PWA lands.
 */
export function CustomerNotesCard({ customerId }: CustomerNotesCardProps) {
  const { data: customer, isLoading } = useCustomer(customerId);
  const queryClient = useQueryClient();
  // Track the upstream notes value so we can detect realtime updates while
  // the textarea is pristine — and re-sync the draft to match. Using a
  // derived state pattern (compare upstream snapshot during render) avoids
  // the react-hooks/set-state-in-effect lint that the equivalent useEffect
  // body would trigger.
  const upstream = customer?.notes ?? "";
  const [snapshot, setSnapshot] = useState<string>(upstream);
  const [draft, setDraft] = useState<string>(upstream);

  if (snapshot !== upstream) {
    // Upstream changed (realtime invalidation, save success, customer swap).
    // If the user hasn't typed yet, follow the new value; otherwise preserve
    // their in-flight edit and only update the snapshot reference.
    if (draft === snapshot) {
      setDraft(upstream);
    }
    setSnapshot(upstream);
  }

  const isDirty = draft !== upstream;

  const saveMutation = useMutation({
    mutationFn: async (notes: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("customers")
        .update({ notes: notes.length > 0 ? notes : null })
        .eq("id", customerId);
      if (error) {
        await logError(
          {
            errorType: "DB_FUNCTION",
            severity: "error",
            source: "customer-notes",
            message: error.message,
            details: {
              customer_id: customerId,
              operation: "update-notes",
              code: error.code ?? null,
            },
            entity: "customers",
            entityId: customerId,
          },
          supabase,
        );
        throw error;
      }
    },
    onSuccess: () => {
      // Realtime invalidation will refresh `customer.notes`; the
      // snapshot/draft sync above keeps the textarea in step.
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(customerId),
      });
      toast.success("Backoffice-Notizen gespeichert");
    },
    onError: () => {
      toast.error("Speichern fehlgeschlagen — bitte erneut versuchen");
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Notizen</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Backoffice section — editable, persists to customers.notes. */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Backoffice-Notizen
            </h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!isDirty || saveMutation.isPending || isLoading}
              onClick={() => saveMutation.mutate(draft)}
            >
              {saveMutation.isPending ? "Speichere…" : "Speichern"}
            </Button>
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Interne Notizen (nur Backoffice sichtbar)"
            rows={4}
            disabled={isLoading || saveMutation.isPending}
            aria-label="Backoffice-Notizen"
          />
        </section>

        {/* Monteur section — Epic-8 stub. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Monteur-Notizen
          </h3>
          {/* TODO(Epic 8) — wire technician tour notes from Monteur PWA. */}
          <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
            Verfügbar mit Epic 8 — Monteur-PWA
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
