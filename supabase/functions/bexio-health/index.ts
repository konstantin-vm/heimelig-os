// Edge Function — bexio-health.
// Story 1.7 AC13.
//
// Admin-only health check: makes one cheap GET against bexio (default
// /3.0/company) through the shared bexio-client. Returns connection status
// + latency.
//
// Does NOT auto-refresh proactively to avoid burning the token lifetime on
// view-side health checks; the shared client's reactive 401 path still
// covers true expiry.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { logEdgeError } from "../_shared/error-logger.ts";
import {
  BexioAuthRevokedError,
  BexioRateLimitError,
  BexioServerError,
  createServiceRoleClient,
  getBexioClient,
} from "../_shared/bexio-client.ts";

// CORS: restrict to the configured app origin. `*` is permissive for a
// non-credentialed request, but this Edge Function expects a Bearer JWT and
// a custom client could send it from any origin — pin to NEXT_PUBLIC_APP_URL.
const ALLOWED_ORIGIN =
  Deno.env.get("NEXT_PUBLIC_APP_URL") ??
  Deno.env.get("APP_PUBLIC_URL") ??
  "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, code: "method_not_allowed", message: "Use POST" },
      405,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return jsonResponse(
      { ok: false, code: "config", message: "SUPABASE_* env vars missing" },
      500,
    );
  }

  // Verify admin role.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse(
      { ok: false, code: "unauthorized", message: "Missing bearer token." },
      401,
    );
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse(
      { ok: false, code: "unauthorized", message: "Invalid token." },
      401,
    );
  }
  const appRole =
    (userData.user.app_metadata as Record<string, unknown> | undefined)?.[
      "app_role"
    ];
  if (appRole !== "admin") {
    return jsonResponse(
      { ok: false, code: "forbidden", message: "Admin role required." },
      403,
    );
  }

  // Run the health probe.
  const adminClient = createServiceRoleClient();
  const start = performance.now();

  try {
    const client = await getBexioClient(adminClient);
    const resp = await client.request("/3.0/company", {
      method: "GET",
      skipRefresh: true,
    });
    const latencyMs = Math.round(performance.now() - start);

    // Read the active credential expires_at for the AC13 response shape
    // (token-free read via service-role).
    const { data: credRows } = await adminClient
      .from("bexio_credentials")
      .select("expires_at")
      .eq("is_active", true)
      .limit(1);
    const credExpiresAt = (credRows ?? [])[0]?.expires_at as
      | string
      | undefined;
    const statusLabel = computeStatusLabel(credExpiresAt ?? null);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      await logEdgeError(
        {
          errorType: "BEXIO_API",
          severity: "warning",
          source: "bexio-health",
          message: `bexio /3.0/company returned ${resp.status}`,
          details: { http_status: resp.status },
        },
        adminClient,
      );
      return jsonResponse(
        {
          ok: false,
          code: `bexio_${resp.status}`,
          message: truncate(text || resp.statusText, 200),
          latency_ms: latencyMs,
        },
        200,
      );
    }
    // Drain body to avoid leaks.
    try {
      await resp.body?.cancel();
    } catch {
      /* ignore */
    }

    return jsonResponse(
      {
        ok: true,
        environment: client.environment,
        expires_at: credExpiresAt ?? null,
        status_label: statusLabel,
        latency_ms: latencyMs,
      },
      200,
    );
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);

    if (err instanceof BexioAuthRevokedError) {
      await logEdgeError(
        {
          errorType: "AUTH",
          severity: "warning",
          source: "bexio-health",
          message: "bexio connection revoked at health probe",
          details: { code: "auth_revoked" },
        },
        adminClient,
      );
      return jsonResponse(
        {
          ok: false,
          code: "auth_revoked",
          message: "bexio connection revoked. Please reconnect.",
          latency_ms: latencyMs,
        },
        200,
      );
    }
    if (err instanceof BexioRateLimitError) {
      await logEdgeError(
        {
          errorType: "BEXIO_API",
          severity: "warning",
          source: "bexio-health",
          message: "bexio rate limit exhausted at health probe",
          details: { code: "rate_limit", attempts: err.attempts },
        },
        adminClient,
      );
      return jsonResponse(
        {
          ok: false,
          code: "rate_limit",
          message: "bexio rate limit exhausted",
          latency_ms: latencyMs,
        },
        200,
      );
    }
    if (err instanceof BexioServerError) {
      await logEdgeError(
        {
          errorType: "BEXIO_API",
          severity: "error",
          source: "bexio-health",
          message: `bexio server error at health probe: ${err.status}`,
          details: { http_status: err.status },
        },
        adminClient,
      );
      return jsonResponse(
        {
          ok: false,
          code: `bexio_${err.status}`,
          message: err.message,
          latency_ms: latencyMs,
        },
        200,
      );
    }

    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: "error",
        source: "bexio-health",
        message: err instanceof Error ? err.message : String(err),
      },
      adminClient,
    );

    return jsonResponse(
      {
        ok: false,
        code: "unknown",
        message: "Unexpected error during bexio health check.",
        latency_ms: latencyMs,
      },
      200,
    );
  }
});

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Mirror the SQL `bexio_credentials_status_label` thresholds exactly so the
// admin UI sees the same label whether it reads the function or the health
// endpoint. Keep the two definitions in lockstep when changing thresholds.
function computeStatusLabel(
  expiresAt: string | null,
): "valid" | "expiring_soon" | "expired" {
  if (!expiresAt) return "valid";
  const now = Date.now();
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return "valid";
  if (ms <= now) return "expired";
  if (ms <= now + 5 * 60 * 1000) return "expiring_soon";
  return "valid";
}
