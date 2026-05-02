import { z } from "zod";

import { isoTimestampSchema, uuidSchema } from "./common";

// Story 1.7 — Zod schemas for the admin-readable bexio_credentials_status_for_admin RPC.
// CHECK constraints in migration 00021:
//   environment   ∈ {'trial','production'}
//   status_label  ∈ {'valid','expiring_soon','expired'}   (computed in view)

export const bexioEnvironmentValues = ["trial", "production"] as const;
export const bexioEnvironmentSchema = z.enum(bexioEnvironmentValues);
export type BexioEnvironment = z.infer<typeof bexioEnvironmentSchema>;

export const bexioStatusLabelValues = [
  "valid",
  "expiring_soon",
  "expired",
] as const;
export const bexioStatusLabelSchema = z.enum(bexioStatusLabelValues);
export type BexioStatusLabel = z.infer<typeof bexioStatusLabelSchema>;

// Read shape returned by `bexio_credentials_status_for_admin()`.
// NEVER includes access_token_encrypted / refresh_token_encrypted.
export const bexioCredentialsStatusSchema = z.object({
  id: uuidSchema,
  bexio_company_id: z.string().nullable(),
  token_type: z.string(),
  expires_at: isoTimestampSchema,
  scope: z.string().nullable(),
  last_refreshed_at: isoTimestampSchema.nullable(),
  refresh_count: z.int().nonnegative(),
  is_active: z.boolean(),
  environment: bexioEnvironmentSchema,
  notes: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
  status_label: bexioStatusLabelSchema,
});

export type BexioCredentialsStatus = z.infer<typeof bexioCredentialsStatusSchema>;
