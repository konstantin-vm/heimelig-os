"use client";

import { Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CustomerInsuranceWithPartner } from "@/lib/queries/customers";

import { InsuranceTypeBadge } from "./insurance-type-badge";

export type InsuranceRowProps = {
  insurance: CustomerInsuranceWithPartner;
  onEdit: (insuranceId: string) => void;
  onDelete: (insuranceId: string) => void;
  className?: string;
};

function formatSwissDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return null;
  return `${d}.${m}.${y}`;
}

function formatValidityRange(
  validFrom: string | null,
  validTo: string | null,
): string {
  const from = formatSwissDate(validFrom);
  const to = formatSwissDate(validTo);
  if (from && to) return `Gültig ${from} – ${to}`;
  if (from) return `Gültig ab ${from}`;
  if (to) return `Gültig bis ${to}`;
  return "—";
}

function insurerDisplayName(insurance: CustomerInsuranceWithPartner): string {
  if (insurance.partner_insurers) return insurance.partner_insurers.name;
  if (insurance.insurer_name_freetext?.trim()) return insurance.insurer_name_freetext;
  return "—";
}

export function InsuranceRow({
  insurance,
  onEdit,
  onDelete,
  className,
}: InsuranceRowProps) {
  const insurer = insurerDisplayName(insurance);
  const isPartner = insurance.partner_insurer_id !== null;
  const validity = formatValidityRange(insurance.valid_from, insurance.valid_to);
  const insuranceNumber = insurance.insurance_number?.trim() || null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border border-transparent px-2 py-2 hover:border-border hover:bg-muted/30",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {insurer}
          </span>
          <InsuranceTypeBadge type={insurance.insurance_type} />
          {insurance.is_primary ? (
            <Badge variant="default">Hauptversicherung</Badge>
          ) : null}
          {isPartner ? (
            <span className="text-[11px] font-medium uppercase tracking-wide text-primary">
              Partnerkasse
            </span>
          ) : null}
        </div>
        {insuranceNumber ? (
          <span
            className="truncate text-xs text-muted-foreground"
            title={insuranceNumber}
          >
            Versicherten-Nr.: {insuranceNumber}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">{validity}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Versicherung ${insurer} bearbeiten`}
          title="Bearbeiten"
          onClick={() => onEdit(insurance.id)}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Versicherung ${insurer} löschen`}
          title="Löschen"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onDelete(insurance.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  );
}
