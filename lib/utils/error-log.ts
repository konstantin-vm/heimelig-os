import type { SupabaseClient } from "@supabase/supabase-js";

import { logErrorArgsSchema, type LogErrorArgs } from "@/lib/validations/error-log";

// ---------------------------------------------------------------------------
// logError — best-effort frontend / middleware helper writing into error_log.
//
// nDSG rule (enforced by reviewers, not by this helper):
//   args.details MUST NOT contain raw customer PII (names, addresses,
//   insurance numbers, emails). Pass IDs + structured error codes only.
//   Middleware callers (lib/supabase/proxy.ts) run on Vercel Frankfurt —
//   passing PII there would violate data residency.
//
// The helper never throws:
//   * Zod validation failure → { ok: false }.
//   * RPC failure           → { ok: false }. As a last-resort fallback the
//                             helper emits console.error so that a broken
//                             logger is visible during development. This is
//                             the documented exception to the "no console.*
//                             for error handling" rule in CLAUDE.md — the
//                             dedicated logger itself cannot call itself.
//
// Caller must pass a Supabase client. Both the browser client
// (createBrowserClient) and the server client (createServerClient) work —
// whichever is already available at the call site.
// ---------------------------------------------------------------------------

type LogErrorResult = { ok: true; id: string } | { ok: false };

export async function logError(
  args: LogErrorArgs,
  client: SupabaseClient,
): Promise<LogErrorResult> {
  const parsed = logErrorArgsSchema.safeParse(args);
  if (!parsed.success) {
    // Last-resort fallback — see JSDoc above for the CLAUDE.md exception.
    console.error("[logError] invalid args:", parsed.error.issues);
    return { ok: false };
  }

  try {
    const { data, error } = await client.rpc("log_error", {
      p_error_type: parsed.data.errorType,
      p_severity: parsed.data.severity,
      p_source: parsed.data.source,
      p_message: parsed.data.message,
      p_details: parsed.data.details ?? {},
      p_entity: parsed.data.entity ?? null,
      p_entity_id: parsed.data.entityId ?? null,
      p_request_id: parsed.data.requestId ?? null,
    });

    if (error) {
      console.error("[logError] RPC failed:", error.message);
      return { ok: false };
    }
    if (typeof data === "string" && data.length > 0) {
      return { ok: true, id: data };
    }
    return { ok: false };
  } catch (err) {
    console.error(
      "[logError] unexpected failure:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false };
  }
}
