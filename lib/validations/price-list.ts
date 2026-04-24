import { z } from "zod";
import {
  isoDateSchema,
  isoTimestampSchema,
  nonNegativeChfAmountSchema,
  uuidSchema,
} from "./common";

// Mirrors `price_lists` (data-model-spec §5.3.2).

export const priceListNameValues = [
  "helsana",
  "sanitas",
  "visana",
  "kpt",
  "private",
] as const;
export const priceListNameSchema = z.enum(priceListNameValues);

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

export type PriceList = z.infer<typeof priceListSchema>;
export type PriceListCreate = z.infer<typeof priceListCreateSchema>;
export type PriceListUpdate = z.infer<typeof priceListUpdateSchema>;
