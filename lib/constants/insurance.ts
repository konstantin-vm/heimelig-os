// Insurance enum catalog — single source of truth for insurance_type values,
// German labels, and partner-KK identifiers.
// Story 2.3 — derived from data-model-spec §5.2.3 (insurance_type) + §5.2.5
// (partner_insurers seed).

import type { insuranceTypeSchema } from "@/lib/validations/customer";
import type { z } from "zod";

export type InsuranceType = z.infer<typeof insuranceTypeSchema>;

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export type InsuranceTypeConfig = {
  value: InsuranceType;
  label: string;
  badgeVariant: BadgeVariant;
};

export const INSURANCE_TYPES: ReadonlyArray<InsuranceTypeConfig> = [
  { value: "grund", label: "Grund", badgeVariant: "default" },
  { value: "zusatz", label: "Zusatz", badgeVariant: "secondary" },
] as const;

const TYPE_CONFIG_MAP: Record<InsuranceType, InsuranceTypeConfig> =
  INSURANCE_TYPES.reduce(
    (acc, t) => {
      acc[t.value] = t;
      return acc;
    },
    {} as Record<InsuranceType, InsuranceTypeConfig>,
  );

export function getInsuranceTypeConfig(type: InsuranceType): InsuranceTypeConfig {
  return TYPE_CONFIG_MAP[type];
}

// Partner-KK seed codes — UI hint logic only. Billing decisions go through
// `partner_insurer_id` FK references; never compare strings against this list
// for revenue-relevant routing.
export const PARTNER_INSURER_CODES = [
  "helsana",
  "sanitas",
  "visana",
  "kpt",
] as const;

export type PartnerInsurerCode = (typeof PARTNER_INSURER_CODES)[number];
