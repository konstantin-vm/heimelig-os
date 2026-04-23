import { z } from "zod";
import {
  bexioIdSchema,
  isoTimestampSchema,
  nonNegativeChfAmountSchema,
  uuidSchema,
} from "./common";

// Weight validator matching the DB CHECK (`weight_kg > 0`). Distinct from the
// CHF-amount validator to avoid leaking "CHF-Betrag" error copy into weights,
// and to enforce the strict-positive lower bound (Zod >=0 would pass 0 and
// then trip the 23514 constraint error at insert time).
const positiveWeightKgSchema = z
  .number({ error: "Ungültiges Gewicht" })
  .positive({ error: "Gewicht muss grösser als 0 sein" })
  .refine(
    (value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6,
    { error: "Maximal 2 Nachkommastellen" },
  );

// Mirrors `articles` (data-model-spec §5.3.1).

export const articleCategoryValues = [
  "pflegebetten",
  "mobilitaet",
  "matratzen",
  "zubehoer",
  "moebel",
] as const;
export const articleCategorySchema = z.enum(articleCategoryValues);

export const articleTypeValues = ["rental", "purchase", "service"] as const;
export const articleTypeSchema = z.enum(articleTypeValues);

export const articleUnitValues = [
  "Mte",
  "Stk.",
  "Std.",
  "Paar",
  "Pauschal",
] as const;
export const articleUnitSchema = z.enum(articleUnitValues);

export const articleSchema = z.object({
  id: uuidSchema,
  article_number: z.string().min(1, { error: "Artikelnummer ist erforderlich" }),
  name: z.string().min(1, { error: "Artikelname ist erforderlich" }),
  description: z.string().nullable(),
  category: articleCategorySchema,
  type: articleTypeSchema,
  unit: articleUnitSchema,
  variant_of_id: uuidSchema.nullable(),
  variant_label: z.string().nullable(),
  manufacturer: z.string().nullable(),
  manufacturer_ref: z.string().nullable(),
  weight_kg: positiveWeightKgSchema.nullable(),
  length_cm: z.int().positive().nullable(),
  width_cm: z.int().positive().nullable(),
  height_cm: z.int().positive().nullable(),
  purchase_price: nonNegativeChfAmountSchema.nullable(),
  min_stock: z.int().nonnegative().nullable(),
  is_serialized: z.boolean(),
  is_active: z.boolean(),
  bexio_article_id: bexioIdSchema.nullable(),
  notes: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
});

export const articleCreateSchema = articleSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
    is_serialized: true,
  })
  .extend({
    is_active: z.boolean().default(true),
    // `is_serialized` is populated by a BEFORE INSERT trigger when NULL;
    // clients may still override by passing an explicit boolean.
    is_serialized: z.boolean().nullable().optional(),
  });

export const articleUpdateSchema = articleCreateSchema.partial();

export type Article = z.infer<typeof articleSchema>;
export type ArticleCreate = z.infer<typeof articleCreateSchema>;
export type ArticleUpdate = z.infer<typeof articleUpdateSchema>;
