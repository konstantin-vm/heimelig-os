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

// Story 3.1 (migration 00043) collapsed the historical
// `('rental','purchase','service')` mutex to `('physical','service')` and
// added orthogonal `is_rentable` / `is_sellable` flags. See data-model-spec
// §5.3.1.
export const articleTypeValues = ["physical", "service"] as const;
export const articleTypeSchema = z.enum(articleTypeValues);

// Schweizer MWST 2024+ (8.1% / 2.6% / 3.8%). Display-only — bexio mapping
// to `tax_id` is owned by Epic 6 (Story 6.2 invoice generation).
export const articleVatRateValues = [
  "standard",
  "reduced",
  "accommodation",
] as const;
export const articleVatRateSchema = z.enum(articleVatRateValues);

export const articleUnitValues = [
  "Mte",
  "Stk.",
  "Std.",
  "Paar",
  "Pauschal",
] as const;
export const articleUnitSchema = z.enum(articleUnitValues);

// Cross-column invariants enforced via .superRefine — when `type='physical'`
// at least one of the rentable/sellable flags must be true; when
// `type='service'` both flags must be false. The DB doesn't enforce this with
// a CHECK because cross-column CHECKs interact with the create-RPC's UPSERT
// path (data-model-spec §5.3.1). Zod is the SSOT for this rule.
const articleTypeFlagsRefine = (
  data: { type: string; is_rentable: boolean; is_sellable: boolean },
  ctx: z.RefinementCtx,
) => {
  if (data.type === "physical" && !data.is_rentable && !data.is_sellable) {
    // Surface the error on BOTH switches so it is visible regardless of
    // which control the user looks at.
    ctx.addIssue({
      code: "custom",
      message: "Physische Artikel müssen mindestens 'Vermietbar' oder 'Verkaufbar' sein",
      path: ["is_rentable"],
    });
    ctx.addIssue({
      code: "custom",
      message: "Physische Artikel müssen mindestens 'Vermietbar' oder 'Verkaufbar' sein",
      path: ["is_sellable"],
    });
  }
  if (data.type === "service" && data.is_rentable) {
    ctx.addIssue({
      code: "custom",
      message: "Dienstleistungen können nicht vermietet werden",
      path: ["is_rentable"],
    });
  }
  if (data.type === "service" && data.is_sellable) {
    ctx.addIssue({
      code: "custom",
      message: "Dienstleistungen können nicht verkauft werden",
      path: ["is_sellable"],
    });
  }
};

export const articleSchema = z
  .object({
    id: uuidSchema,
    article_number: z.string().min(1, { error: "Artikelnummer ist erforderlich" }),
    name: z.string().min(1, { error: "Artikelname ist erforderlich" }),
    description: z.string().nullable(),
    category: articleCategorySchema,
    type: articleTypeSchema,
    is_rentable: z.boolean(),
    is_sellable: z.boolean(),
    vat_rate: articleVatRateSchema,
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
    critical_stock: z.int().nonnegative().nullable(),
    is_serialized: z.boolean(),
    is_active: z.boolean(),
    bexio_article_id: bexioIdSchema.nullable(),
    notes: z.string().nullable(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    created_by: uuidSchema.nullable(),
    updated_by: uuidSchema.nullable(),
  })
  .superRefine(articleTypeFlagsRefine);

export const articleCreateSchema = z
  .object({
    article_number: z.string().min(1, { error: "Artikelnummer ist erforderlich" }),
    name: z.string().min(1, { error: "Artikelname ist erforderlich" }),
    description: z.string().nullable(),
    category: articleCategorySchema,
    type: articleTypeSchema,
    is_rentable: z.boolean().default(false),
    is_sellable: z.boolean().default(false),
    vat_rate: articleVatRateSchema.default("standard"),
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
    critical_stock: z.int().nonnegative().nullable(),
    is_active: z.boolean().default(true),
    bexio_article_id: bexioIdSchema.nullable(),
    notes: z.string().nullable(),
    // `is_serialized` is populated by the BEFORE INSERT trigger when NULL;
    // clients may still override by passing an explicit boolean.
    is_serialized: z.boolean().nullable().optional(),
  })
  .superRefine(articleTypeFlagsRefine);

export const articleUpdateSchema = z
  .object({
    article_number: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    category: articleCategorySchema.optional(),
    type: articleTypeSchema.optional(),
    is_rentable: z.boolean().optional(),
    is_sellable: z.boolean().optional(),
    vat_rate: articleVatRateSchema.optional(),
    unit: articleUnitSchema.optional(),
    variant_of_id: uuidSchema.nullable().optional(),
    variant_label: z.string().nullable().optional(),
    manufacturer: z.string().nullable().optional(),
    manufacturer_ref: z.string().nullable().optional(),
    weight_kg: positiveWeightKgSchema.nullable().optional(),
    length_cm: z.int().positive().nullable().optional(),
    width_cm: z.int().positive().nullable().optional(),
    height_cm: z.int().positive().nullable().optional(),
    purchase_price: nonNegativeChfAmountSchema.nullable().optional(),
    min_stock: z.int().nonnegative().nullable().optional(),
    critical_stock: z.int().nonnegative().nullable().optional(),
    is_serialized: z.boolean().optional(),
    is_active: z.boolean().optional(),
    bexio_article_id: bexioIdSchema.nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  // The flags-vs-type refine only runs when all three fields are present in
  // the partial update payload. If only one of them changes, the DB-side
  // existing row + the client-side dirty-form composite still need to be
  // consistent — the form layer is responsible for re-asserting this when
  // committing a partial change.
  .superRefine((data, ctx) => {
    if (
      data.type !== undefined
      && data.is_rentable !== undefined
      && data.is_sellable !== undefined
    ) {
      articleTypeFlagsRefine(
        { type: data.type, is_rentable: data.is_rentable, is_sellable: data.is_sellable },
        ctx,
      );
    }
  });

export type Article = z.infer<typeof articleSchema>;
export type ArticleCreate = z.infer<typeof articleCreateSchema>;
export type ArticleUpdate = z.infer<typeof articleUpdateSchema>;
