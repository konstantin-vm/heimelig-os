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
  // is_new: data-model-spec §5.4.1 line 571 + MTG-009 (2026-04-28). True until
  // first rental/sale completion in Epic 5 / Story 4.x flips it to false;
  // Story 3.2 only reads + offers a manual admin override.
  is_new: z.boolean(),
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
  })
  .extend({
    // Status defaults server-side to 'available' (00008 column default).
    // After Story 3.3 ships `transition_device_status`, status is read-only
    // in the form and the create path strips it before insert.
    status: deviceStatusSchema.default("available"),
    condition: deviceConditionSchema.default("gut"),
    is_new: z.boolean().default(true),
  });

// Direct status updates are forbidden by convention (CLAUDE.md anti-pattern
// "Direct UPDATE on status columns"). Story 3.3 ships `transition_device_status`
// as the SECURITY DEFINER RPC. Until then, `useDeviceUpdate` strips `status`
// from the patch and throws if a caller passes one; the `.superRefine` below
// is the defense-in-depth tripwire at the validation layer.
//
// IMPORTANT — built from `deviceSchema.partial()`, NOT `deviceCreateSchema.partial()`.
// `deviceCreateSchema` extends with `.default(...)` for status / condition / is_new;
// `.partial()` of that schema injects those defaults into every parsed payload,
// which would silently flip `is_new` back to `true` on every edit and re-introduce
// `status='available'` into update patches. Going through `deviceSchema` keeps
// every field optional without injecting defaults.
export const deviceUpdateSchema = deviceSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
    created_by: true,
    updated_by: true,
  })
  .partial()
  .superRefine((value, ctx) => {
    if ("status" in value) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Status-Änderungen erfolgen über die Transition-Funktion (Story 3.3)",
      });
    }
    // Date invariants. retire-relation handled by the .refine below.
    if (value.inbound_date && value.outbound_date) {
      if (value.outbound_date < value.inbound_date) {
        ctx.addIssue({
          code: "custom",
          path: ["outbound_date"],
          message: "Ausgang darf nicht vor Eingang liegen",
        });
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    if (value.acquired_at && value.acquired_at > today) {
      ctx.addIssue({
        code: "custom",
        path: ["acquired_at"],
        message: "Anschaffungsdatum darf nicht in der Zukunft liegen",
      });
    }
    if (value.retired_at && value.retired_at > today) {
      ctx.addIssue({
        code: "custom",
        path: ["retired_at"],
        message: "Ausmusterungsdatum darf nicht in der Zukunft liegen",
      });
    }
  })
  .refine(
    (value) =>
      value.retired_at == null ||
      value.status == null ||
      value.status === "sold",
    {
      // Soft semantic gate documenting spec intent. Note: `useDeviceUpdate`
      // strips `status` from patches, so this refine is a tripwire for
      // direct schema callers (tests, scripts) rather than the form path.
      path: ["retired_at"],
      message: "Außer Betrieb gesetzte Geräte sollten den Status 'Verkauft' tragen",
    },
  );

export type Device = z.infer<typeof deviceSchema>;
export type DeviceCreate = z.infer<typeof deviceCreateSchema>;
export type DeviceUpdate = z.infer<typeof deviceUpdateSchema>;
