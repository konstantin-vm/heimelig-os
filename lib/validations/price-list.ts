import { z } from "zod";
import {
  isoDateSchema,
  isoTimestampSchema,
  nonNegativeChfAmountSchema,
  uuidSchema,
} from "./common";

// Mirrors `price_lists` (data-model-spec §5.3.2).
//
// Story 3.1.1 (migration 00056): the legacy CHECK enum on
// `price_lists.list_name` has been relaxed and validation now happens against
// the `price_list_definitions` table at the DB layer (RPCs validate the slug
// is active). The Zod schema mirrors the slug grammar from
// `price_list_definitions.slug` (`^[a-z0-9][a-z0-9_-]{0,63}$`).
//
// `priceListNameValues` is retained so the existing components and tests
// that hard-code the 5 system slugs (e.g. `<PriceListCard>` fallback ordering,
// `<ArticleEditForm>` create-mode price field labels) keep compiling without
// a sweeping refactor; the UI layer dynamically reads
// `price_list_definitions` at runtime via `useActivePriceListDefinitions()`.

export const priceListNameValues = [
  "helsana",
  "sanitas",
  "visana",
  "kpt",
  "private",
] as const;

export const priceListNameSchema = z
  .string()
  .min(1, "list_name darf nicht leer sein")
  .max(64, "list_name darf höchstens 64 Zeichen lang sein")
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,63}$/,
    "list_name nur Kleinbuchstaben, Ziffern, '-' und '_' (Start mit Buchstabe oder Ziffer)",
  );

export const priceListCurrencySchema = z.literal("CHF");

export const priceListSchema = z
  .object({
    id: uuidSchema,
    article_id: uuidSchema,
    list_name: priceListNameSchema,
    amount: nonNegativeChfAmountSchema,
    currency: priceListCurrencySchema,
    valid_from: isoDateSchema,
    valid_to: isoDateSchema.nullable(),
    notes: z.string().nullable(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    created_by: uuidSchema.nullable(),
    updated_by: uuidSchema.nullable(),
  })
  .refine(
    (v) => v.valid_to === null || v.valid_to > v.valid_from,
    {
      error: "valid_to muss nach valid_from liegen (gleiches Datum nicht erlaubt)",
      path: ["valid_to"],
    },
  );

export const priceListCreateSchema = z
  .object({
    article_id: uuidSchema,
    list_name: priceListNameSchema,
    amount: nonNegativeChfAmountSchema,
    currency: priceListCurrencySchema.default("CHF"),
    valid_from: isoDateSchema,
    valid_to: isoDateSchema.nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine(
    (v) => v.valid_to == null || v.valid_to > v.valid_from,
    {
      error: "valid_to muss nach valid_from liegen (gleiches Datum nicht erlaubt)",
      path: ["valid_to"],
    },
  );

export const priceListUpdateSchema = z
  .object({
    list_name: priceListNameSchema.optional(),
    amount: nonNegativeChfAmountSchema.optional(),
    valid_from: isoDateSchema.optional(),
    valid_to: isoDateSchema.nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .partial();

/**
 * Story 3.1.1 — `PriceListNameValue` was historically the union of the 5
 * system slugs. With the dynamic catalogue it widens to `string`, but the
 * canonical 5-slug constants are still exposed via `priceListNameValues` so
 * existing call-sites can keep using the literal (TypeScript narrows the
 * literal types correctly as `"private" | "helsana" | ...`).
 */
export type PriceListNameValue = string;

export type PriceList = z.infer<typeof priceListSchema>;
export type PriceListCreate = z.infer<typeof priceListCreateSchema>;
export type PriceListUpdate = z.infer<typeof priceListUpdateSchema>;
