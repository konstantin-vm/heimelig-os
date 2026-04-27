import { z } from "zod";

import { isoTimestampSchema, uuidSchema } from "./common";

// Zod schemas for public.audit_log (Story 1.5 / data-model-spec §5.9.3).
// Row shape mirrors Database['public']['Tables']['audit_log']['Row'] —
// if the two drift, the generated type wins; update the schema to match.

export const actorSystemValues = [
  "pg_cron",
  "billing_run",
  "payment_sync",
  "contact_sync",
  "dunning_run",
  "migration",
  "other",
] as const;
export const actorSystemSchema = z.enum(actorSystemValues);
export type ActorSystem = z.infer<typeof actorSystemSchema>;

// snake_case action names — matches the convention used by log_activity()
// and the generic audit_trigger_fn (`<table>_created`, `<table>_updated`,
// `device_rented`, etc.).
export const auditActionSchema = z
  .string()
  .min(1, { error: "Action darf nicht leer sein" })
  .max(64, { error: "Action ist zu lang" })
  .regex(/^[a-z][a-z0-9_]*$/, {
    error: "Action muss snake_case sein (a-z, 0-9, _)",
  });

// jsonb columns come in as arbitrary json. Keep the Zod shape permissive —
// enforcement lives in the writing code paths (log_activity / logError).
const jsonObjectSchema = z.record(z.string(), z.unknown()).nullable();

export const auditLogEntrySchema = z.object({
  id: uuidSchema,
  action: auditActionSchema,
  entity: z.string().min(1),
  entity_id: uuidSchema,
  actor_user_id: uuidSchema.nullable(),
  actor_system: actorSystemSchema.nullable(),
  before_values: jsonObjectSchema,
  after_values: jsonObjectSchema,
  details: jsonObjectSchema,
  // inet column — Supabase types as `unknown`; we accept a string (e.g.
  // "192.0.2.1") or null.
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  request_id: z.string().nullable(),
  created_at: isoTimestampSchema,
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

// Arguments for the log_activity(...) RPC. Matches the SQL signature in
// Migration 00012. Kept deliberately permissive on the jsonb payloads — the
// DB is the source of truth for structure.
export const logActivityArgsSchema = z.object({
  action: auditActionSchema,
  entity: z.string().min(1),
  entityId: uuidSchema,
  before: jsonObjectSchema.optional(),
  after: jsonObjectSchema.optional(),
  details: jsonObjectSchema.optional(),
});
export type LogActivityArgs = z.infer<typeof logActivityArgsSchema>;
