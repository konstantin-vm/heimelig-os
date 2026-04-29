// Contact-person role catalog — single source of truth for role enum values,
// German display labels, badge styling, and avatar tints.
// Story 2.2 — derived from data-model-spec §5.2.4 (7-role enum).

import type { contactRoleSchema } from "@/lib/validations/customer";
import type { z } from "zod";

export type ContactRole = z.infer<typeof contactRoleSchema>;

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export type ContactRoleConfig = {
  value: ContactRole;
  label: string;
  badgeVariant: BadgeVariant;
  /** Tailwind background class for the 40px contact avatar circle. */
  avatarTint: string;
  /** Tailwind text class for the avatar initials (paired with avatarTint). */
  avatarText: string;
};

export const CONTACT_ROLES: ReadonlyArray<ContactRoleConfig> = [
  {
    value: "angehoerige",
    label: "Angehörige",
    badgeVariant: "secondary",
    avatarTint: "bg-blue-100",
    avatarText: "text-blue-900",
  },
  {
    value: "spitex",
    label: "Spitex",
    badgeVariant: "secondary",
    avatarTint: "bg-amber-100",
    avatarText: "text-amber-900",
  },
  {
    value: "sozialdienst",
    label: "Sozialdienst",
    badgeVariant: "secondary",
    avatarTint: "bg-purple-100",
    avatarText: "text-purple-900",
  },
  {
    value: "arzt",
    label: "Arzt",
    badgeVariant: "secondary",
    avatarTint: "bg-emerald-100",
    avatarText: "text-emerald-900",
  },
  {
    value: "heim",
    label: "Heim",
    badgeVariant: "secondary",
    avatarTint: "bg-rose-100",
    avatarText: "text-rose-900",
  },
  {
    value: "therapeut",
    label: "Therapeut",
    badgeVariant: "secondary",
    avatarTint: "bg-cyan-100",
    avatarText: "text-cyan-900",
  },
  {
    value: "sonstige",
    label: "Sonstige",
    badgeVariant: "outline",
    avatarTint: "bg-muted",
    avatarText: "text-muted-foreground",
  },
] as const;

const ROLE_CONFIG_MAP: Record<ContactRole, ContactRoleConfig> =
  CONTACT_ROLES.reduce(
    (acc, role) => {
      acc[role.value] = role;
      return acc;
    },
    {} as Record<ContactRole, ContactRoleConfig>,
  );

export function getContactRoleConfig(role: ContactRole): ContactRoleConfig {
  return ROLE_CONFIG_MAP[role];
}
