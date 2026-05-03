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

export const salutationValues = [
  "herr",
  "frau",
  "divers",
  // Story 2.1.1 / MTG-009 — final invoice after death of the contract holder
  // is addressed to the heirs ("Erbengemeinschaft"). Auto-switch on
  // Rückgabegrund=Todesfall is owned by Story 5.3; this enum entry is the
  // data-side prerequisite.
  "erbengemeinschaft",
] as const;
export const salutationSchema = z.enum(salutationValues);

export const SALUTATION_LABELS: Record<(typeof salutationValues)[number], string> = {
  herr: "Herr",
  frau: "Frau",
  divers: "Divers",
  erbengemeinschaft: "Erbengemeinschaft",
};

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
  "in_progress",
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
  // Story 2.1.1 — IV (Invalidenversicherung) marker + dossier reference.
  // Coupled at the DB layer via CHECK (iv_marker = false OR iv_dossier_number IS NOT NULL).
  iv_marker: z.boolean(),
  iv_dossier_number: z.string().nullable(),
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
    iv_marker: z.boolean().default(false),
    iv_dossier_number: z.string().trim().min(1).nullable().optional(),
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
  )
  // Story 2.1.1 — IV-Dossiernummer required when iv_marker=true. Mirrors the
  // DB CHECK `customers_iv_dossier_required`; surfaced inline so the form can
  // attach the message to the dossier-number input.
  .refine(
    (value) =>
      !value.iv_marker ||
      (typeof value.iv_dossier_number === "string" &&
        value.iv_dossier_number.trim() !== ""),
    {
      error: "IV-Dossiernummer ist Pflicht, wenn der Kunde als IV markiert ist.",
      path: ["iv_dossier_number"],
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
    // Story 2.1.1 — when iv_marker is being set to true in the patch, the
    // patch must also carry a non-empty iv_dossier_number. Patches that only
    // touch other fields skip this check (DB CHECK still guards a stale
    // marker-without-dossier state).
    if (patch.iv_marker === true) {
      const dossier = patch.iv_dossier_number;
      if (dossier === undefined || dossier === null || dossier.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["iv_dossier_number"],
          message: "IV-Dossiernummer ist Pflicht, wenn der Kunde als IV markiert ist.",
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

// Form-level schema for the AddressDialog (Story 2.4 — non-primary
// addresses only: 'delivery' / 'billing' / 'other'). Drives both add + edit
// modes via a single FormValues shape, mirroring the
// `customerInsuranceDialogSchema` pattern from Story 2.3 (review-1).
//
// Refinements:
//   (a) `address_type !== 'primary'` — the dialog never creates primary
//       addresses (Story 2.1 owns those via the atomic create/edit RPCs).
//       Defense-in-depth: the type picker excludes 'primary'.
//   (b) `recipient_name` is optional but, when present, must be at least one
//       non-whitespace character — empty strings are coerced to null at
//       submit time, but a string of only spaces should fail validation.
//   (c) `street`, `zip`, `city` required — already enforced by the row
//       schema; mirrored here so RHF surfaces the inline errors.
//   (d) Country / floor / has_elevator enums — inherited from the row schema.
//
// The dialog's submit handler trims and null-coerces empty `recipient_name`,
// `street_number`, `floor`, `has_elevator`, `access_notes` BEFORE calling
// the create / update mutation; the row schema accepts those nulls.
export const customerAddressDialogSchema = z
  .object({
    address_type: addressTypeSchema,
    recipient_name: z.string(),
    street: z.string().trim().min(1, { error: "Strasse ist erforderlich" }),
    street_number: z.string(),
    zip: z.string().trim().min(1, { error: "PLZ ist erforderlich" }),
    city: z.string().trim().min(1, { error: "Ort ist erforderlich" }),
    country: z.enum(countryValues),
    // floor / has_elevator: Select binds to "" for "no value" (the
    // empty-state placeholder); valid enum values pass through
    // floorSchema / elevatorSchema. Round-2 review: previously
    // `z.string()` with submit-time coercion silently dropped tampered
    // input; now Zod surfaces the inline error.
    floor: z.union([floorSchema, z.literal("")]),
    has_elevator: z.union([elevatorSchema, z.literal("")]),
    access_notes: z.string(),
    // Round-2 review: bind lat/lng to the geographic-bounds schemas (was
    // unbounded `z.number().nullable()`). Defense-in-depth: tampered
    // values like lat=95 now fail at form-validation time instead of
    // sneaking through to a `numeric(9,6)` column that happens to fit
    // the precision but is geographically impossible.
    lat: latitudeSchema.nullable(),
    lng: longitudeSchema.nullable(),
    geocoded_at: z.string().nullable(),
    is_default_for_type: z.boolean(),
    bypass_geocoding: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.address_type === "primary") {
      ctx.addIssue({
        code: "custom",
        path: ["address_type"],
        message:
          "Hauptadresse wird über „Kunde bearbeiten“ verwaltet, nicht über diesen Dialog.",
      });
    }
    // recipient_name optional, but if non-null/non-empty must contain at
    // least one non-whitespace character.
    if (value.recipient_name !== "" && value.recipient_name.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["recipient_name"],
        message: "Empfängername darf nicht nur aus Leerzeichen bestehen.",
      });
    }
    // Cross-field invariant: lat/lng/geocoded_at are all-or-nothing.
    // A partial state (one set, others null) means the geocode result is
    // inconsistent and should be rejected before reaching the row schema.
    // Round-2 review.
    const coordsSet = [value.lat !== null, value.lng !== null, value.geocoded_at !== null];
    const setCount = coordsSet.filter(Boolean).length;
    if (setCount !== 0 && setCount !== 3) {
      ctx.addIssue({
        code: "custom",
        path: ["lat"],
        message:
          "Koordinaten müssen vollständig sein (lat + lng + geocoded_at) oder vollständig leer.",
      });
    }
  });

export type CustomerAddressDialogValues = z.infer<
  typeof customerAddressDialogSchema
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

// Form-level schema for the InsuranceDialog — validates the dialog's
// FormValues shape directly so zodResolver can fire on blur/change. The
// Krankenkasse Select uses a single `insurer_choice` field (partner_insurer_id
// uuid | "" | "__andere__") that the submit handler maps onto the row schema.
// Refinements (Story 2.3 AC7):
//   (a) `insurer_choice` must be set;
//   (b) `insurer_name_freetext` required when "Andere" is picked;
//   (c) `insurance_number` required when a partner KK is picked (partner-KK
//       billing routing in Epic 6 needs it);
//   (d) `valid_to >= valid_from` when both dates are set.
// PII-safety: messages reference field labels only, never user-entered values.
const ANDERE_FORM_VALUE = "__andere__";

export const customerInsuranceDialogSchema = z
  .object({
    insurer_choice: z.string(),
    insurer_name_freetext: z.string(),
    insurance_type: insuranceTypeSchema,
    insurance_number: z.string(),
    valid_from: z.string(),
    valid_to: z.string(),
    is_primary: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.insurer_choice === "") {
      ctx.addIssue({
        code: "custom",
        path: ["insurer_choice"],
        message: "Bitte Krankenkasse wählen.",
      });
      return;
    }
    const isAndere = value.insurer_choice === ANDERE_FORM_VALUE;
    if (isAndere) {
      if (value.insurer_name_freetext.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["insurer_name_freetext"],
          message: "Name der Versicherung angeben",
        });
      }
    } else {
      // Partner KK selected — Versicherten-Nr. is required.
      if (value.insurance_number.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["insurance_number"],
          message: "Versicherten-Nr. der Partnerkasse ist erforderlich",
        });
      }
    }
    if (
      value.valid_from !== "" &&
      value.valid_to !== "" &&
      value.valid_to < value.valid_from
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["valid_to"],
        message: "Gültig bis muss nach Gültig von liegen",
      });
    }
  });

export type CustomerInsuranceDialogValues = z.infer<
  typeof customerInsuranceDialogSchema
>;

// Row-shape variants kept for direct API callers (not used by the dialog
// after the 2.3 review patch; the dialog now validates FormValues directly).
export const customerInsuranceFormCreateSchema =
  customerInsuranceCreateSchema.superRefine((value, ctx) => {
    const hasPartner = (value.partner_insurer_id ?? null) !== null;
    const freetext = (value.insurer_name_freetext ?? "").trim();
    if (hasPartner) {
      const num = (value.insurance_number ?? "").trim();
      if (num === "") {
        ctx.addIssue({
          code: "custom",
          path: ["insurance_number"],
          message: "Versicherten-Nr. der Partnerkasse ist erforderlich",
        });
      }
    } else if (freetext === "") {
      ctx.addIssue({
        code: "custom",
        path: ["insurer_name_freetext"],
        message: "Name der Versicherung angeben",
      });
    }
    if (value.valid_from && value.valid_to && value.valid_to < value.valid_from) {
      ctx.addIssue({
        code: "custom",
        path: ["valid_to"],
        message: "Gültig bis muss nach Gültig von liegen",
      });
    }
  });

export const customerInsuranceFormUpdateSchema =
  customerInsuranceUpdateSchema.superRefine((value, ctx) => {
    const partnerProvided = value.partner_insurer_id !== undefined;
    const hasPartner = partnerProvided && value.partner_insurer_id !== null;
    if (partnerProvided) {
      if (hasPartner) {
        // Partner KK now set: insurance_number must be present and non-empty.
        // Treating absent (undefined) as missing — flipping partner_insurer_id
        // without sending a Versicherten-Nr. would otherwise leave the row in
        // a partner-KK state with no number, breaking Epic 6 billing.
        const num = (value.insurance_number ?? "").trim();
        if (num === "") {
          ctx.addIssue({
            code: "custom",
            path: ["insurance_number"],
            message: "Versicherten-Nr. der Partnerkasse ist erforderlich",
          });
        }
      } else {
        // Partner cleared (set to null): freetext must be present.
        const freetext = (value.insurer_name_freetext ?? "").trim();
        if (freetext === "") {
          ctx.addIssue({
            code: "custom",
            path: ["insurer_name_freetext"],
            message: "Name der Versicherung angeben",
          });
        }
      }
    }
    if (value.valid_from && value.valid_to && value.valid_to < value.valid_from) {
      ctx.addIssue({
        code: "custom",
        path: ["valid_to"],
        message: "Gültig bis muss nach Gültig von liegen",
      });
    }
  });

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
