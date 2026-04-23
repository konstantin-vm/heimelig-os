import { z } from "zod";
import {
  bexioIdSchema,
  emailSchema,
  isoTimestampSchema,
  nonNegativeChfAmountSchema,
  phoneSchema,
  uuidSchema,
} from "./common";

// Mirrors `partner_insurers` (data-model-spec §5.2.5).

export const partnerInsurerCodeSchema = z.string().regex(/^[a-z_]+$/, {
  error: "Code darf nur Kleinbuchstaben und Unterstriche enthalten",
});

export const partnerInsurerSchema = z.object({
  id: uuidSchema,
  code: partnerInsurerCodeSchema,
  name: z.string().min(1, { error: "Name ist erforderlich" }),
  max_monthly_reimbursement: nonNegativeChfAmountSchema,
  bexio_contact_id: bexioIdSchema.nullable(),
  billing_street: z.string().nullable(),
  billing_street_number: z.string().nullable(),
  billing_zip: z.string().nullable(),
  billing_city: z.string().nullable(),
  contact_email: emailSchema.nullable(),
  contact_phone: phoneSchema.nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
});

export const partnerInsurerCreateSchema = partnerInsurerSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
  })
  .extend({
    is_active: z.boolean().default(true),
    max_monthly_reimbursement: nonNegativeChfAmountSchema.default(81.10),
  });

export const partnerInsurerUpdateSchema = partnerInsurerCreateSchema.partial();

export type PartnerInsurer = z.infer<typeof partnerInsurerSchema>;
export type PartnerInsurerCreate = z.infer<typeof partnerInsurerCreateSchema>;
export type PartnerInsurerUpdate = z.infer<typeof partnerInsurerUpdateSchema>;
