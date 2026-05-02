import { z } from "zod";

import { bexioEnvironmentSchema } from "./bexio-credentials";

// Story 1.7 — input validation for the connectBexio Server Action.
export const connectBexioActionInputSchema = z.object({
  env: bexioEnvironmentSchema,
});
export type ConnectBexioActionInput = z.infer<
  typeof connectBexioActionInputSchema
>;

// Health-check Edge Function response shape (consumed by the
// /settings/bexio status card).
export const bexioHealthResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    environment: bexioEnvironmentSchema,
    latency_ms: z.number().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
    latency_ms: z.number().nonnegative().optional(),
  }),
]);
export type BexioHealthResponse = z.infer<typeof bexioHealthResponseSchema>;
