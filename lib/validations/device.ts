import { z } from "zod";
import {
  isoDateSchema,
  isoTimestampSchema,
  nonNegativeChfAmountSchema,
  uuidSchema,
} from "./common";

// Mirrors `devices` (data-model-spec §5.4.1). FK constraint for
// `current_contract_id` is deferred to Story 5.x when `rental_contracts`
// is introduced; schema already carries the uuid column.

export const deviceStatusValues = [
  "available",
  "rented",
  "cleaning",
  "repair",
  "sold",
] as const;
export const deviceStatusSchema = z.enum(deviceStatusValues);

export const deviceConditionValues = [
  "gut",
  "gebrauchsspuren",
  "reparaturbeduerftig",
] as const;
export const deviceConditionSchema = z.enum(deviceConditionValues);

export const deviceSchema = z.object({
  id: uuidSchema,
  serial_number: z
    .string()
    .min(1, { error: "Seriennummer ist erforderlich" }),
  article_id: uuidSchema,
  qr_code: z.string().nullable(),
  status: deviceStatusSchema,
  condition: deviceConditionSchema,
  current_warehouse_id: uuidSchema.nullable(),
  current_contract_id: uuidSchema.nullable(),
  supplier_id: uuidSchema.nullable(),
  inbound_date: isoDateSchema.nullable(),
  outbound_date: isoDateSchema.nullable(),
  acquired_at: isoDateSchema.nullable(),
  acquisition_price: nonNegativeChfAmountSchema.nullable(),
  reserved_for_customer_id: uuidSchema.nullable(),
  reserved_at: isoTimestampSchema.nullable(),
  retired_at: isoDateSchema.nullable(),
  notes: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
});

export const deviceCreateSchema = deviceSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
    // Status transitions go through `transition_device_status` (Story 3.3);
    // until then admins may seed the starting status directly.
  })
  .extend({
    status: deviceStatusSchema.default("available"),
    condition: deviceConditionSchema.default("gut"),
  });

// Direct status updates are not permitted after Story 3.3 — use the
// transition function. We keep the field in the schema for seed/import flows.
export const deviceUpdateSchema = deviceCreateSchema.partial();

export type Device = z.infer<typeof deviceSchema>;
export type DeviceCreate = z.infer<typeof deviceCreateSchema>;
export type DeviceUpdate = z.infer<typeof deviceUpdateSchema>;
