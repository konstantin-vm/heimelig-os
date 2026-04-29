import { z } from "zod";
import {
  bexioIdSchema,
  countrySchema,
  countryValues,
  emailSchema,
  isoDateSchema,
  isoTimestampSchema,
  languageSchema,
  languageValues,
  latitudeSchema,
  longitudeSchema,
  phoneSchema,
  uuidSchema,
} from "./common";

// Mirrors Customer Domain (data-model-spec §5.2):
//   - customers
//   - customer_addresses
//   - customer_insurance
//   - contact_persons

// -------------------- Enums ----------------------

export const customerTypeValues = ["private", "institution"] as const;
export const customerTypeSchema = z.enum(customerTypeValues);

export const salutationValues = ["herr", "frau", "divers"] as const;
export const salutationSchema = z.enum(salutationValues);

export const acquisitionChannelValues = [
  "spitex",
  "sozialdienst_spital",
  "google",
  "ki",
  "empfehlung",
  "wiederholer",
  "arzt_therapeut",
  "shopify",
  "sonstige",
] as const;
export const acquisitionChannelSchema = z.enum(acquisitionChannelValues);

export const bexioSyncStatusValues = [
  "pending",
  "synced",
  "failed",
  "local_only",
] as const;
export const bexioSyncStatusSchema = z.enum(bexioSyncStatusValues);

export const addressTypeValues = [
  "primary",
  "delivery",
  "billing",
  "other",
] as const;
export const addressTypeSchema = z.enum(addressTypeValues);

export const floorValues = [
  "UG",
  "EG",
  "1.OG",
  "2.OG",
  "3.OG",
  "4.OG",
  "5.OG+",
] as const;
export const floorSchema = z.enum(floorValues);

export const elevatorValues = ["ja", "nein", "unbekannt"] as const;
export const elevatorSchema = z.enum(elevatorValues);

export const insuranceTypeValues = ["grund", "zusatz"] as const;
export const insuranceTypeSchema = z.enum(insuranceTypeValues);

export const contactRoleValues = [
  "angehoerige",
  "spitex",
  "sozialdienst",
  "arzt",
  "heim",
  "therapeut",
  "sonstige",
] as const;
export const contactRoleSchema = z.enum(contactRoleValues);

// -------------------- customers ------------------

export const customerSchema = z.object({
  id: uuidSchema,
  customer_number: z.string().min(1, { error: "Kundennummer ist erforderlich" }),
  customer_type: customerTypeSchema,
  salutation: salutationSchema.nullable(),
  title: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  company_name: z.string().nullable(),
  addressee_line: z.string().nullable(),
  email: emailSchema.nullable(),
  // P18 (Round 3) — DB column is nullable (institutions, legacy imports). The
  // form-level "Telefon required" rule from AC1 lives in `customer-edit-form`
  // via RHF `rules: { required }` and does not belong in the row schema. AC4
  // is amended accordingly in the story spec.
  phone: phoneSchema.nullable(),
  mobile: phoneSchema.nullable(),
  date_of_birth: isoDateSchema.nullable(),
  height_cm: z.int().positive().lt(260).nullable(),
  weight_kg: z
    .number()
    .positive({ error: "Gewicht muss positiv sein" })
    .lt(350, { error: "Ungültiges Gewicht" })
    .nullable(),
  language: languageSchema,
  marketing_consent: z.boolean(),
  acquisition_channel: acquisitionChannelSchema.nullable(),
  bexio_contact_id: bexioIdSchema.nullable(),
  bexio_sync_status: bexioSyncStatusSchema,
  bexio_synced_at: isoTimestampSchema.nullable(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
});

export const customerCreateSchema = customerSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
  })
  .extend({
    // customer_number defaults to the DB-side generator
    // (`gen_next_customer_number()`); the form must not send a value.
    customer_number: z.string().min(1).optional(),
    customer_type: customerTypeSchema.default("private"),
    language: z.enum(languageValues).default("de"),
    marketing_consent: z.boolean().default(false),
    bexio_sync_status: bexioSyncStatusSchema.default("pending"),
    is_active: z.boolean().default(true),
  })
  .refine(
    (value) =>
      (value.customer_type === "private" && value.last_name !== null && value.last_name !== undefined && value.last_name !== "") ||
      (value.customer_type === "institution" &&
        value.company_name !== null &&
        value.company_name !== undefined &&
        value.company_name !== ""),
    {
      error:
        "Bei Privatkunden ist der Nachname Pflicht, bei Institutionen der Firmenname.",
      path: ["customer_type"],
    },
  );

// superRefine catches the common failure mode: flipping `customer_type`
// without providing the matching required name field. Full-row validation
// (e.g. "private customer already lacks last_name, PATCH doesn't touch either
// field") still needs an app-layer guard that merges the patch with the
// current row before validating.
export const customerUpdateSchema = customerSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
  })
  .partial()
  .superRefine((patch, ctx) => {
    if (patch.customer_type === "private") {
      if (
        patch.last_name !== undefined &&
        (patch.last_name === null || patch.last_name === "")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["last_name"],
          message: "Bei Privatkunden ist der Nachname Pflicht.",
        });
      }
    } else if (patch.customer_type === "institution") {
      if (
        patch.company_name !== undefined &&
        (patch.company_name === null || patch.company_name === "")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["company_name"],
          message: "Bei Institutionen ist der Firmenname Pflicht.",
        });
      }
    }
  });

// -------------------- customer_addresses ----------

export const customerAddressSchema = z.object({
  id: uuidSchema,
  customer_id: uuidSchema,
  address_type: addressTypeSchema,
  is_default_for_type: z.boolean(),
  recipient_name: z.string().nullable(),
  street: z.string().min(1, { error: "Strasse ist erforderlich" }),
  street_number: z.string().nullable(),
  zip: z.string().min(1, { error: "PLZ ist erforderlich" }),
  city: z.string().min(1, { error: "Ort ist erforderlich" }),
  country: countrySchema,
  floor: floorSchema.nullable(),
  has_elevator: elevatorSchema.nullable(),
  access_notes: z.string().nullable(),
  lat: latitudeSchema.nullable(),
  lng: longitudeSchema.nullable(),
  geocoded_at: isoTimestampSchema.nullable(),
  is_active: z.boolean(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
});

export const customerAddressCreateSchema = customerAddressSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
  })
  .extend({
    country: z.enum(countryValues).default("CH"),
    is_default_for_type: z.boolean().default(true),
    is_active: z.boolean().default(true),
  });

export const customerAddressUpdateSchema =
  customerAddressCreateSchema.partial();

// Form-side variant for the create+edit modal — `customer_id` is supplied by
// the RPC (create) or the mutation (update), so the form never owns it.
// Avoids the placeholder-UUID hack in customer-edit-form.tsx.
export const customerAddressUserInputSchema = customerAddressCreateSchema.omit({
  customer_id: true,
});

export type CustomerAddressUserInput = z.infer<
  typeof customerAddressUserInputSchema
>;

// -------------------- customer_insurance ---------

export const customerInsuranceSchema = z
  .object({
    id: uuidSchema,
    customer_id: uuidSchema,
    partner_insurer_id: uuidSchema.nullable(),
    insurer_name_freetext: z.string().nullable(),
    insurance_type: insuranceTypeSchema,
    insurance_number: z.string().nullable(),
    is_primary: z.boolean(),
    valid_from: isoDateSchema.nullable(),
    valid_to: isoDateSchema.nullable(),
    is_active: z.boolean(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    created_by: uuidSchema.nullable(),
    updated_by: uuidSchema.nullable(),
  })
  .refine(
    (v) => {
      const hasPartner = v.partner_insurer_id !== null;
      const hasFreetext = (v.insurer_name_freetext?.trim() ?? "") !== "";
      return hasPartner !== hasFreetext;
    },
    {
      error:
        "Genau eines muss gesetzt sein: Partner-Versicherer ODER Freitext-Name (nicht beides).",
      path: ["partner_insurer_id"],
    },
  );

export const customerInsuranceCreateSchema = z
  .object({
    customer_id: uuidSchema,
    partner_insurer_id: uuidSchema.nullable().optional(),
    insurer_name_freetext: z.string().trim().min(1).nullable().optional(),
    insurance_type: insuranceTypeSchema.default("grund"),
    insurance_number: z.string().nullable().optional(),
    is_primary: z.boolean().default(true),
    valid_from: isoDateSchema.nullable().optional(),
    valid_to: isoDateSchema.nullable().optional(),
    is_active: z.boolean().default(true),
  })
  .refine(
    (v) => {
      const hasPartner = (v.partner_insurer_id ?? null) !== null;
      const hasFreetext = (v.insurer_name_freetext ?? "") !== "";
      return hasPartner !== hasFreetext;
    },
    {
      error:
        "Genau eines muss gesetzt sein: Partner-Versicherer ODER Freitext-Name (nicht beides).",
      path: ["partner_insurer_id"],
    },
  );

export const customerInsuranceUpdateSchema = z
  .object({
    partner_insurer_id: uuidSchema.nullable().optional(),
    insurer_name_freetext: z.string().trim().nullable().optional(),
    insurance_type: insuranceTypeSchema.optional(),
    insurance_number: z.string().nullable().optional(),
    is_primary: z.boolean().optional(),
    valid_from: isoDateSchema.nullable().optional(),
    valid_to: isoDateSchema.nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .partial();

// -------------------- contact_persons ------------

export const contactPersonSchema = z.object({
  id: uuidSchema,
  customer_id: uuidSchema,
  role: contactRoleSchema,
  salutation: salutationSchema.nullable(),
  title: z.string().nullable(),
  first_name: z.string().min(1, { error: "Vorname ist erforderlich" }),
  last_name: z.string().min(1, { error: "Nachname ist erforderlich" }),
  organization: z.string().nullable(),
  phone: phoneSchema.nullable(),
  email: emailSchema.nullable(),
  notes: z.string().nullable(),
  is_primary_contact: z.boolean(),
  is_active: z.boolean(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
});

export const contactPersonCreateSchema = contactPersonSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
  })
  .extend({
    is_primary_contact: z.boolean().default(false),
    is_active: z.boolean().default(true),
  });

export const contactPersonUpdateSchema = contactPersonCreateSchema.partial();

// Form-level variant — Telefon required (UX), DB column stays nullable so legacy
// Blue-Office migration data without phone numbers remains editable.
// See Story 2.2 AC1 + AC6 + decision #3 (2026-04-28).
export const contactPersonFormCreateSchema = contactPersonCreateSchema.superRefine(
  (value, ctx) => {
    if (value.phone === null || value.phone === undefined || value.phone === "") {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Telefon ist erforderlich",
      });
    }
  },
);

export const contactPersonFormUpdateSchema = contactPersonUpdateSchema.superRefine(
  (value, ctx) => {
    if (value.phone !== undefined && (value.phone === null || value.phone === "")) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Telefon ist erforderlich",
      });
    }
  },
);

// -------------------- Types ----------------------

export type Customer = z.infer<typeof customerSchema>;
export type CustomerCreate = z.infer<typeof customerCreateSchema>;
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;

export type CustomerAddress = z.infer<typeof customerAddressSchema>;
export type CustomerAddressCreate = z.infer<typeof customerAddressCreateSchema>;
export type CustomerAddressUpdate = z.infer<typeof customerAddressUpdateSchema>;

export type CustomerInsurance = z.infer<typeof customerInsuranceSchema>;
export type CustomerInsuranceCreate = z.infer<typeof customerInsuranceCreateSchema>;
export type CustomerInsuranceUpdate = z.infer<typeof customerInsuranceUpdateSchema>;

export type ContactPerson = z.infer<typeof contactPersonSchema>;
export type ContactPersonCreate = z.infer<typeof contactPersonCreateSchema>;
export type ContactPersonUpdate = z.infer<typeof contactPersonUpdateSchema>;
