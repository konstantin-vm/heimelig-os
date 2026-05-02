"use client";

import { ExternalLink, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ADDRESS_TYPE_LABELS } from "@/lib/constants/address";
import type { CustomerAddress } from "@/lib/validations/customer";

import { AddressTypeBadge } from "./address-type-badge";

export type AddressRowProps = {
  address: CustomerAddress;
  /** Display label for screen-reader hints, e.g. "Huber, Margrit". */
  customerLabel?: string;
  onEdit: (addressId: string) => void;
  onDelete: (addressId: string) => void;
  className?: string;
};

const ACCESS_NOTES_TRUNCATE = 120;

function formatAddressLine(address: CustomerAddress): string {
  const street = [address.street, address.street_number]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" ");
  const cityZip = [address.zip, address.city]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" ");
  const parts = [street, cityZip].filter(Boolean);
  if (address.country && address.country !== "CH") {
    parts.push(address.country);
  }
  return parts.join(", ");
}

function formatFloorElevator(address: CustomerAddress): string | null {
  const parts: string[] = [];
  if (address.floor) parts.push(address.floor);
  if (address.has_elevator === "ja") parts.push("mit Lift");
  else if (address.has_elevator === "nein") parts.push("ohne Lift");
  else if (address.has_elevator === "unbekannt") parts.push("Lift unbekannt");
  return parts.length > 0 ? parts.join(" · ") : null;
}

function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: `${s.slice(0, max).trimEnd()}…`, truncated: true };
}

export function AddressRow({
  address,
  customerLabel,
  onEdit,
  onDelete,
  className,
}: AddressRowProps) {
  const isPrimary = address.address_type === "primary";
  const addressLine = formatAddressLine(address);
  const floorLine = formatFloorElevator(address);
  const recipient = address.recipient_name?.trim() || null;
  const accessNotes = address.access_notes?.trim() || null;
  const truncatedNotes = accessNotes ? truncate(accessNotes, ACCESS_NOTES_TRUNCATE) : null;

  // Map link uses lat/lng directly (no PII via referrer leak). When lat/lng
  // are missing, no link is rendered — the user has to use the geocoder via
  // the edit dialog first. CLAUDE.md "Data Residency" rule.
  const mapHref =
    address.lat !== null && address.lng !== null
      ? `https://www.google.com/maps/?q=${address.lat},${address.lng}`
      : null;

  const labelHint = customerLabel?.trim() ? ` von ${customerLabel.trim()}` : "";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border border-transparent px-2 py-2 hover:border-border hover:bg-muted/30",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <AddressTypeBadge type={address.address_type} />
          {!isPrimary && address.is_default_for_type ? (
            <span className="text-[11px] font-medium uppercase tracking-wide text-primary">
              Standard für {ADDRESS_TYPE_LABELS[address.address_type]}
            </span>
          ) : null}
          {recipient ? (
            <span className="truncate text-xs italic text-muted-foreground">
              z. Hd. {recipient}
            </span>
          ) : null}
        </div>
        <span className="truncate text-sm font-medium text-foreground" title={addressLine}>
          {addressLine || "—"}
        </span>
        {floorLine ? (
          <span className="text-xs text-muted-foreground">{floorLine}</span>
        ) : null}
        {truncatedNotes ? (
          <span
            className="truncate text-xs text-muted-foreground"
            title={truncatedNotes.truncated ? accessNotes ?? "" : undefined}
          >
            {truncatedNotes.text}
          </span>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {mapHref ? (
            <a
              href={mapHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
            >
              Auf Karte zeigen
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
          {isPrimary ? (
            <span className="text-xs text-muted-foreground">
              Über „Bearbeiten“ ändern
            </span>
          ) : null}
        </div>
      </div>

      {isPrimary ? null : (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Adresse ${addressLine} bearbeiten${labelHint}`}
            title="Bearbeiten"
            onClick={() => onEdit(address.id)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Adresse ${addressLine} löschen${labelHint}`}
            title="Löschen"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(address.id)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
