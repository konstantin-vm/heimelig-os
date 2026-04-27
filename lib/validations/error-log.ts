import { z } from "zod";

import { isoTimestampSchema, uuidSchema } from "./common";

// Zod schemas for public.error_log (Story 1.5 / data-model-spec §5.9.4).
// Enums must stay in lock-step with the CHECK constraints in Migration 00013.

// CHECK: error_type in ('BEXIO_API','RLS_VIOLATION','VALIDATION',
//        'EDGE_FUNCTION','DB_FUNCTION','REALTIME','AUTH','MIGRATION',
//        'TOUR_PLANNING','INVENTORY','MAIL_PROVIDER','EXTERNAL_API','OTHER')
export const errorTypeValues = [
  "BEXIO_API",
  "RLS_VIOLATION",
  "VALIDATION",
  "EDGE_FUNCTION",
  "DB_FUNCTION",
  "REALTIME",
  "AUTH",
  "MIGRATION",
  "TOUR_PLANNING",
  "INVENTORY",
  "MAIL_PROVIDER",
  "EXTERNAL_API",
  "OTHER",
] as const;
export const errorTypeSchema = z.enum(errorTypeValues);
export type ErrorType = z.infer<typeof errorTypeSchema>;

// CHECK: severity in ('critical','error','warning','info')
export const severityValues = ["critical", "error", "warning", "info"] as const;
export const severitySchema = z.enum(severityValues);
export type Severity = z.infer<typeof severitySchema>;

const jsonObjectSchema = z.record(z.string(), z.unknown()).nullable();

export const errorLogEntrySchema = z.object({
  id: uuidSchema,
  error_type: errorTypeSchema,
  severity: severitySchema,
  source: z.string().min(1),
  message: z.string().min(1),
  details: jsonObjectSchema,
  user_id: uuidSchema.nullable(),
  entity: z.string().nullable(),
  entity_id: uuidSchema.nullable(),
  request_id: z.string().nullable(),
  resolved_at: isoTimestampSchema.nullable(),
  resolved_by: uuidSchema.nullable(),
  resolution_notes: z.string().nullable(),
  created_at: isoTimestampSchema,
});
export type ErrorLogEntry = z.infer<typeof errorLogEntrySchema>;

// Arguments for log_error(...) RPC / logError() helper. Matches the SQL
// signature in Migration 00013.
//
// nDSG rule: `details` MUST NOT contain raw customer PII (names, addresses,
// insurance numbers, emails). Pass IDs + structured error codes only. The
// rule is enforced by reviewers — the schema stays permissive.
export const logErrorArgsSchema = z.object({
  errorType: errorTypeSchema,
  severity: severitySchema.default("error"),
  source: z.string().min(1).max(64),
  message: z.string().min(1).max(500),
  details: jsonObjectSchema.optional(),
  entity: z.string().min(1).max(64).nullable().optional(),
  entityId: uuidSchema.nullable().optional(),
  requestId: z.string().min(1).max(128).nullable().optional(),
});
export type LogErrorArgs = z.infer<typeof logErrorArgsSchema>;
