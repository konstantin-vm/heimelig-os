// Zod schemas for `price_list_definitions` (Story 3.1.1 — migration 00056).
// Mirrors data-model-spec §5.3.3 (added 2026-05-04).

import { z } from "zod";

import { isoTimestampSchema, uuidSchema } from "./common";

// Slug rules mirror the DB CHECK constraint
// `^[a-z0-9][a-z0-9_-]{0,63}$` — lowercase + digits + `_` + `-`, 1..64 chars.
export const priceListDefinitionSlugSchema = z
  .string()
  .min(1, "Slug darf nicht leer sein")
  .max(64, "Slug darf höchstens 64 Zeichen lang sein")
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,63}$/,
    "Slug nur Kleinbuchstaben, Ziffern, '-' und '_' (Start mit Buchstabe oder Ziffer)",
  );

export const priceListDefinitionSchema = z.object({
  id: uuidSchema,
  slug: priceListDefinitionSlugSchema,
  name: z.string().min(1, "Name darf nicht leer sein"),
  sort_order: z.number().int(),
  is_active: z.boolean(),
  is_system: z.boolean(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
});

export const priceListDefinitionCreateSchema = z.object({
  slug: priceListDefinitionSlugSchema,
  name: z.string().min(1, "Name darf nicht leer sein"),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

export const priceListDefinitionUpdateSchema = z
  .object({
    slug: priceListDefinitionSlugSchema.optional(),
    name: z.string().min(1, "Name darf nicht leer sein").optional(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .partial();

export type PriceListDefinition = z.infer<typeof priceListDefinitionSchema>;
export type PriceListDefinitionCreate = z.infer<
  typeof priceListDefinitionCreateSchema
>;
export type PriceListDefinitionUpdate = z.infer<
  typeof priceListDefinitionUpdateSchema
>;

/**
 * Derive a default slug from a free-text name (lowercase + replace
 * non-allowed chars with `-`, collapse repeats, trim leading/trailing `-`).
 * The user can override the auto-derived value in the form.
 */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
