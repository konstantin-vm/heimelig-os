"use client";

// Story 3.1.1 — admin table on /settings/price-lists.

import { useState } from "react";
import { Pencil, Plus, PowerOff } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useDeactivatePriceListDefinition,
  usePriceListDefinitions,
} from "@/lib/queries/price-list-definitions";
import type { PriceListDefinition } from "@/lib/validations/price-list-definition";

import { PriceListDefinitionForm } from "./price-list-definition-form";
import { ConfirmDialog } from "./confirm-dialog";
import { RowActions, type RowActionItem } from "./row-actions";

type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; definition: PriceListDefinition };

export function PriceListDefinitionsTable() {
  const { data: rows, isLoading, isError } = usePriceListDefinitions();
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [confirmDeactivate, setConfirmDeactivate] =
    useState<PriceListDefinition | null>(null);

  const deactivate = useDeactivatePriceListDefinition({
    onSuccess: () => {
      toast.success("Preisliste deaktiviert.");
      setConfirmDeactivate(null);
    },
    onError: (err) => {
      toast.error("Deaktivieren fehlgeschlagen", { description: err.message });
    },
  });

  return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            System-Preislisten sind dauerhaft (Slug nicht änderbar). Eigene
            Preislisten können angelegt, umbenannt und deaktiviert werden.
          </p>
          <Button onClick={() => setModal({ mode: "create" })}>
            <Plus className="h-4 w-4" />
            Neue Preisliste
          </Button>
        </div>

        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Slug</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Sortierung</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Typ</th>
                <th className="px-3 py-2 text-right font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    Wird geladen…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-destructive">
                    Preislisten konnten nicht geladen werden.
                  </td>
                </tr>
              ) : (rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    Keine Preislisten vorhanden.
                  </td>
                </tr>
              ) : (
                (rows ?? []).map((row) => {
                  const items: RowActionItem[] = [
                    {
                      label: "Bearbeiten",
                      icon: <Pencil className="h-4 w-4" aria-hidden />,
                      onSelect: () =>
                        setModal({ mode: "edit", definition: row }),
                    },
                  ];
                  if (row.is_system) {
                    items.push({
                      label: "Deaktivieren (System-Preisliste gesperrt)",
                      icon: <PowerOff className="h-4 w-4" aria-hidden />,
                      onSelect: () => {},
                      disabled: true,
                    });
                  } else if (row.is_active) {
                    items.push({
                      label: "Deaktivieren",
                      icon: <PowerOff className="h-4 w-4" aria-hidden />,
                      onSelect: () => setConfirmDeactivate(row),
                      destructive: true,
                    });
                  }
                  return (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{row.slug}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 tabular-nums">{row.sort_order}</td>
                      <td className="px-3 py-2">
                        {row.is_active ? (
                          <Badge variant="secondary">Aktiv</Badge>
                        ) : (
                          <Badge variant="outline">Inaktiv</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.is_system ? (
                          <Badge variant="outline" className="text-xs">
                            System
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Eigene
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <RowActions
                          triggerAriaLabel={`Aktionen für ${row.name}`}
                          items={items}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {modal.mode !== "closed" ? (
          <PriceListDefinitionForm
            mode={modal.mode}
            definition={modal.mode === "edit" ? modal.definition : null}
            open
            onOpenChange={(open) => {
              if (!open) setModal({ mode: "closed" });
            }}
          />
        ) : null}

        {confirmDeactivate ? (
          <ConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setConfirmDeactivate(null);
            }}
            title={`"${confirmDeactivate.name}" deaktivieren?`}
            description="Deaktivierte Preislisten erscheinen nicht mehr auf neuen Artikeln und Aufträgen. Bestehende Preise und Verträge bleiben erhalten."
            confirmLabel="Deaktivieren"
            variant="destructive"
            onConfirm={async () => {
              await deactivate.mutateAsync({ id: confirmDeactivate.id });
            }}
          />
        ) : null}
      </div>
  );
}
