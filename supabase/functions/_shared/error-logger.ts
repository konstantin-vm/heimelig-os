// Edge Function shared error logger.
// Story 1.7 — finalises the deferral from Story 1.5.
//
// Mirrors the shape of heimelig-os/lib/utils/error-log.ts but is built for
// Deno + Supabase Edge Functions:
//   * Takes a service-role admin client (no next/headers coupling).
//   * Defaults `details.actor_system = 'bexio'` (callers can override).
//   * Best-effort: never throws. RPC failure → returns { ok: false } and
//     last-resort console.error (the dedicated logger cannot call itself).
//
// nDSG rule (enforced by reviewers, not by this helper):
//   args.details MUST NOT contain raw customer PII (names, addresses,
//   insurance numbers, emails). Pass IDs + structured error codes only.
//
// Edge Functions run in Zürich; logging never transits Vercel Frankfurt.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type EdgeErrorType =
  | "BEXIO_API"
  | "RLS_VIOLATION"
  | "VALIDATION"
  | "EDGE_FUNCTION"
  | "DB_FUNCTION"
  | "REALTIME"
  | "AUTH"
  | "MIGRATION"
  | "TOUR_PLANNING"
  | "INVENTORY"
  | "MAIL_PROVIDER"
  | "EXTERNAL_API"
  | "OTHER";

export type EdgeSeverity = "critical" | "error" | "warning" | "info";

export interface EdgeLogErrorArgs {
  errorType: EdgeErrorType;
  severity?: EdgeSeverity;
  source: string;
  message: string;
  details?: Record<string, unknown> | null;
  entity?: string | null;
  entityId?: string | null;
  requestId?: string | null;
}

export type EdgeLogResult = { ok: true; id: string } | { ok: false };

export async function logEdgeError(
  args: EdgeLogErrorArgs,
  supabaseAdmin: SupabaseClient,
): Promise<EdgeLogResult> {
  // Light validation. Mirror lib/validations/error-log.ts limits.
  if (!args.errorType || !args.source || !args.message) {
    console.error("[logEdgeError] invalid args:", {
      hasType: !!args.errorType,
      hasSource: !!args.source,
      hasMessage: !!args.message,
    });
    return { ok: false };
  }
  if (args.source.length > 64 || args.message.length > 500) {
    console.error("[logEdgeError] args exceed limits", {
      sourceLen: args.source.length,
      messageLen: args.message.length,
    });
    return { ok: false };
  }

  const baseDetails = args.details ?? {};
  const enriched = {
    actor_system: "bexio",
    ...baseDetails,
  };

  try {
    const { data, error } = await supabaseAdmin.rpc("log_error", {
      p_error_type: args.errorType,
      p_severity: args.severity ?? "error",
      p_source: args.source,
      p_message: args.message,
      p_details: enriched,
      p_entity: args.entity ?? null,
      p_entity_id: args.entityId ?? null,
      p_request_id: args.requestId ?? null,
    });

    if (error) {
      console.error("[logEdgeError] RPC failed:", error.message);
      return { ok: false };
    }
    if (typeof data === "string" && data.length > 0) {
      return { ok: true, id: data };
    }
    return { ok: false };
  } catch (err) {
    console.error(
      "[logEdgeError] unexpected failure:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false };
  }
}
