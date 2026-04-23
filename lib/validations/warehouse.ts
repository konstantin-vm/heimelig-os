import { z } from "zod";
import {
  countrySchema,
  countryValues,
  isoTimestampSchema,
  latitudeSchema,
  longitudeSchema,
  uuidSchema,
} from "./common";

// Mirrors `warehouses` (data-model-spec §5.4.2).

export const warehouseCodeSchema = z
  .string()
  .min(1, { error: "Lagercode ist erforderlich" })
  .max(32, { error: "Lagercode ist zu lang" });

export const warehouseSchema = z.object({
  id: uuidSchema,
  code: warehouseCodeSchema,
  name: z.string().min(1, { error: "Lagername ist erforderlich" }),
  description: z.string().nullable(),
  street: z.string().nullable(),
  street_number: z.string().nullable(),
  zip: z.string().nullable(),
  city: z.string().nullable(),
  country: countrySchema,
  lat: latitudeSchema.nullable(),
  lng: longitudeSchema.nullable(),
  is_active: z.boolean(),
  is_default_outbound: z.boolean(),
  is_default_inbound: z.boolean(),
  notes: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
});

export const warehouseCreateSchema = warehouseSchema
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
    is_default_outbound: z.boolean().default(false),
    is_default_inbound: z.boolean().default(false),
  });

export const warehouseUpdateSchema = warehouseCreateSchema.partial();

export type Warehouse = z.infer<typeof warehouseSchema>;
export type WarehouseCreate = z.infer<typeof warehouseCreateSchema>;
export type WarehouseUpdate = z.infer<typeof warehouseUpdateSchema>;
