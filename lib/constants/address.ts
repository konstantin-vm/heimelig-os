// Address-type catalog — single source of truth for address_type enum
// values, German display labels, and badge styling.
// Story 2.4 — derived from data-model-spec §5.2.2 (customer_addresses).

import type { addressTypeSchema } from "@/lib/validations/customer";
import type { z } from "zod";

export type AddressType = z.infer<typeof addressTypeSchema>;

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export type AddressTypeConfig = {
  value: AddressType;
  label: string;
  badgeVariant: BadgeVariant;
};

// Full enum → config map (used by AddressTypeBadge for all four types).
export const ADDRESS_TYPES: ReadonlyArray<AddressTypeConfig> = [
  { value: "primary", label: "Hauptadresse", badgeVariant: "default" },
  { value: "delivery", label: "Lieferadresse", badgeVariant: "secondary" },
  { value: "billing", label: "Rechnungsadresse", badgeVariant: "secondary" },
  { value: "other", label: "Andere", badgeVariant: "outline" },
] as const;

// Non-primary subset for the AddressDialog type picker — primary addresses
// are owned by Story 2.1's S-006 modal + atomic create/edit RPCs and must
// never be created via the AddressDialog.
export const ADDRESS_TYPE_OPTIONS_NON_PRIMARY: ReadonlyArray<AddressTypeConfig> =
  ADDRESS_TYPES.filter(
    (t): t is AddressTypeConfig => t.value !== "primary",
  );

// Convenience: enum → label map (e.g. for inline composition outside of a
// `<Badge>` element).
export const ADDRESS_TYPE_LABELS: Record<AddressType, string> =
  ADDRESS_TYPES.reduce(
    (acc, t) => {
      acc[t.value] = t.label;
      return acc;
    },
    {} as Record<AddressType, string>,
  );

const TYPE_CONFIG_MAP: Record<AddressType, AddressTypeConfig> =
  ADDRESS_TYPES.reduce(
    (acc, t) => {
      acc[t.value] = t;
      return acc;
    },
    {} as Record<AddressType, AddressTypeConfig>,
  );

export function getAddressTypeConfig(type: AddressType): AddressTypeConfig {
  return TYPE_CONFIG_MAP[type];
}
