"use client";

import { FileText, Pencil, Plus, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCustomer } from "@/lib/queries/customers";
import { formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

export type CustomerProfileHeaderProps = {
  customerId: string;
  /** Header click handler — opens the shared <CustomerEditForm> modal. */
  onEdit: () => void;
};

const TOOLTIP_RUECKGABE_ID = "customer-profile-action-rueckgabe";
const TOOLTIP_NEUER_AUFTRAG_ID = "customer-profile-action-neuer-auftrag";
const TOOLTIP_RECHNUNG_ID = "customer-profile-action-rechnung";

export function CustomerProfileHeader({
  customerId,
  onEdit,
}: CustomerProfileHeaderProps) {
  const { data: customer, isLoading } = useCustomer(customerId);

  const fullName =
    customer?.customer_type === "private"
      ? [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
        "—"
      : customer?.company_name ?? "—";

  const isActive = customer?.is_active ?? true;
  // Resolved decision 4 — Sprint 1 collapses status to Aktiv/Inaktiv binary.
  // "Verstorben" depends on a death-tracking column not present today
  // (Story 5.3 introduces it).
  const statusLabel = isActive ? "Aktiv" : "Inaktiv";
  const statusVariant = isActive ? "default" : "secondary";

  const since = customer?.created_at ? formatDate(customer.created_at) : "—";
  const sinceLabel =
    customer?.customer_type === "private"
      ? customer.salutation === "frau"
        ? `Kundin seit ${since}`
        : `Kunde seit ${since}`
      : `Kunde seit ${since}`;

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="truncate text-2xl font-bold tracking-tight text-primary">
          {isLoading ? "…" : fullName}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{sinceLabel}</span>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>
      </div>
      <div
        className="flex flex-wrap items-center gap-2 sm:justify-end"
        role="group"
        aria-label="Schnellaktionen"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          aria-disabled="true"
          aria-describedby={TOOLTIP_RUECKGABE_ID}
          title="Verfügbar mit Epic 5"
        >
          <Undo2 className="h-4 w-4" aria-hidden />
          Rückgabe
        </Button>
        <Button
          type="button"
          size="sm"
          disabled
          aria-disabled="true"
          aria-describedby={TOOLTIP_NEUER_AUFTRAG_ID}
          title="Verfügbar mit Epic 4"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Neuer Auftrag
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          aria-disabled="true"
          aria-describedby={TOOLTIP_RECHNUNG_ID}
          title="Verfügbar mit Epic 6"
        >
          <FileText className="h-4 w-4" aria-hidden />
          Rechnung
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          aria-label="Kundendaten bearbeiten"
        >
          <Pencil className="h-4 w-4" aria-hidden />
          Bearbeiten
        </Button>
      </div>
      <span id={TOOLTIP_RUECKGABE_ID} className={cn("sr-only")}>
        Verfügbar mit Epic 5 — Mietverträge &amp; Geräte-Rückgabe
      </span>
      <span id={TOOLTIP_NEUER_AUFTRAG_ID} className={cn("sr-only")}>
        Verfügbar mit Epic 4 — Auftragserfassung
      </span>
      <span id={TOOLTIP_RECHNUNG_ID} className={cn("sr-only")}>
        Verfügbar mit Epic 6 — Rechnungswesen
      </span>
    </header>
  );
}
