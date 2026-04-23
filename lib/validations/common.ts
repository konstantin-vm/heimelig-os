import { z } from "zod";

// Shared primitives aligned with the DB conventions in
// `docs/internal/data-model-spec.md` §Konventionen.
// German error messages are used on user-facing validators.

export const uuidSchema = z.uuid({ error: "Ungültige ID" });

export const emailSchema = z
  .string()
  .trim()
  .max(254, { error: "E-Mail-Adresse ist zu lang" })
  .pipe(z.email({ error: "Ungültige E-Mail-Adresse" }));

export const isoDateSchema = z.iso.date({ error: "Ungültiges Datum (YYYY-MM-DD)" });

export const isoTimestampSchema = z.iso.datetime({
  error: "Ungültiger Zeitstempel (ISO 8601)",
  offset: true,
});

// bexio / snapshot references are plain integers.
export const bexioIdSchema = z.int().positive({ error: "Ungültige bexio-ID" });

// numeric(10,2) columns are read by supabase-js as `number`, so schemas
// validate a number with up to two decimal places. The data-model spec's
// "money = string" convention is enforced at the service/boundary layer
// (future story); at the schema layer we align with the generated types.
// 2-decimal check uses a tolerance to avoid rejecting legitimate values that
// surface JS float noise (e.g. 0.1 + 0.2 ≈ 0.30000000000000004). A sub-cent
// tolerance still catches inputs like 1.234 (error ≥ 0.4).
export const chfAmountSchema = z
  .number({ error: "Ungültiger CHF-Betrag" })
  .refine((value) => Number.isFinite(value), {
    error: "Ungültiger CHF-Betrag",
  })
  .refine(
    (value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6,
    { error: "Maximal 2 Nachkommastellen" },
  );

export const nonNegativeChfAmountSchema = chfAmountSchema.refine(
  (value) => value >= 0,
  { error: "Betrag darf nicht negativ sein" },
);

// Minimal phone validator — Heimelig accepts Swiss & international free-form
// entry; we only guard length here so the UI layer stays flexible.
export const phoneSchema = z
  .string()
  .trim()
  .min(3, { error: "Telefonnummer zu kurz" })
  .max(30, { error: "Telefonnummer zu lang" });

export const languageValues = ["de", "fr", "it", "en"] as const;
export const languageSchema = z.enum(languageValues);
export type Language = z.infer<typeof languageSchema>;

export const countryValues = ["CH", "FL", "DE", "AT", "FR", "IT"] as const;
export const countrySchema = z.enum(countryValues);
export type Country = z.infer<typeof countrySchema>;

// Normalizes to lowercase so equality comparisons and union indexes don't miss
// case differences (`#ABCDEF` vs `#abcdef`).
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, {
    error: "Farbe muss im Hex-Format sein (z.B. #a1b2c3)",
  })
  .transform((value) => value.toLowerCase());

// Latitude/longitude snapshots from Google Geocoding. numeric(9,6) in DB.
export const latitudeSchema = z
  .number()
  .gte(-90, { error: "Breitengrad muss zwischen -90 und 90 liegen" })
  .lte(90, { error: "Breitengrad muss zwischen -90 und 90 liegen" });

export const longitudeSchema = z
  .number()
  .gte(-180, { error: "Längengrad muss zwischen -180 und 180 liegen" })
  .lte(180, { error: "Längengrad muss zwischen -180 und 180 liegen" });

// Helper for optional-nullable string fields (common across create schemas).
// Coerces empty strings to null so UI forms that submit "" for unset fields
// don't hit "String must contain at least 1 character".
export const optionalNullableString = z
  .preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().min(1).nullable().optional(),
  );
