import { z } from "zod";
import {
  bexioIdSchema,
  countrySchema,
  countryValues,
  emailSchema,
  isoTimestampSchema,
  phoneSchema,
  uuidSchema,
} from "./common";

// Mirrors `suppliers` (data-model-spec §5.4.3).

export const supplierSchema = z.object({
  id: uuidSchema,
  supplier_number: z.string().nullable(),
  name: z.string().min(1, { error: "Lieferantenname ist erforderlich" }),
  street: z.string().nullable(),
  street_number: z.string().nullable(),
  zip: z.string().nullable(),
  city: z.string().nullable(),
  country: countrySchema,
  phone: phoneSchema.nullable(),
  email: emailSchema.nullable(),
  website: z.url({ error: "Ungültige URL" }).nullable(),
  contact_person: z.string().nullable(),
  bexio_supplier_id: bexioIdSchema.nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
});

export const supplierCreateSchema = supplierSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
  })
  .extend({
    country: z.enum(countryValues).default("CH"),
    is_active: z.boolean().default(true),
  });

export const supplierUpdateSchema = supplierCreateSchema.partial();

export type Supplier = z.infer<typeof supplierSchema>;
export type SupplierCreate = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdate = z.infer<typeof supplierUpdateSchema>;
