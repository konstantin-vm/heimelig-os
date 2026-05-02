// Edge Function — bexio-oauth-init.
// Story 1.7 AC6.
//
// Admin-initiated OAuth2 Authorization Code Flow kickoff.
//   * Verifies the caller is an admin (JWT app_role check).
//   * Generates a 32-byte random state, persists it in bexio_oauth_states.
//   * Builds the bexio authorize URL with offline_access scope (for refresh
//     token issuance) + redirect_uri pointing at the Edge Function URL.
//   * Returns { authorize_url } as JSON; the calling Server Action triggers
//     the browser redirect.
//
// nDSG: redirect_uri MUST point at the *.functions.supabase.co Edge Function
// URL (Zürich), never at a Vercel route. Tokens never transit Frankfurt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { logEdgeError } from "../_shared/error-logger.ts";

interface InitResponse {
  authorize_url: string;
}

interface ErrorResponse {
  error: string;
  message: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { error: "method_not_allowed", message: "Use POST" },
      405,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse(
      {
        error: "config_missing",
        message: "Edge Function not configured (SUPABASE_* env vars).",
      },
      500,
    );
  }

  const clientId = Deno.env.get("BEXIO_CLIENT_ID");
  const redirectUri = Deno.env.get("BEXIO_REDIRECT_URI");
  const authorizeUrl =
    Deno.env.get("BEXIO_AUTHORIZE_URL") ??
    "https://auth.bexio.com/realms/bexio/protocol/openid-connect/auth";
  const scopes =
    Deno.env.get("BEXIO_SCOPES") ??
    "openid profile offline_access contact_show contact_edit kb_invoice_show kb_invoice_edit";

  if (!clientId || !redirectUri) {
    return jsonResponse(
      {
        error: "config_missing",
        message: "BEXIO_CLIENT_ID or BEXIO_REDIRECT_URI not set.",
      },
      500,
    );
  }

  // 1. Verify admin role from the caller's JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse(
      { error: "unauthorized", message: "Missing bearer token." },
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
      { error: "unauthorized", message: "Invalid or expired token." },
      401,
    );
  }

  const appRole =
    (userData.user.app_metadata as Record<string, unknown> | undefined)?.[
      "app_role"
    ];
  if (appRole !== "admin") {
    return jsonResponse(
      { error: "forbidden", message: "Admin role required." },
      403,
    );
  }

  // 2. Parse env query param.
  const url = new URL(req.url);
  const env = url.searchParams.get("env") ?? "trial";
  if (env !== "trial" && env !== "production") {
    return jsonResponse(
      {
        error: "invalid_env",
        message: "env must be 'trial' or 'production'.",
      },
      400,
    );
  }

  // 3. Generate state + persist via service-role client.
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = bytesToBase64Url(stateBytes);

  const { error: insertErr } = await adminClient
    .from("bexio_oauth_states")
    .insert({ state, environment: env });
  if (insertErr) {
    await logEdgeError(
      {
        errorType: "EDGE_FUNCTION",
        severity: "error",
        source: "bexio-oauth-init",
        message: `bexio_oauth_states insert failed: ${insertErr.message}`,
        details: { env, code: insertErr.code },
      },
      adminClient,
    );
    return jsonResponse(
      {
        error: "state_persist_failed",
        message: "Could not persist OAuth state.",
      },
      500,
    );
  }

  // 4. Build authorize URL.
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  });
  const authorize = `${authorizeUrl}?${params.toString()}`;

  const body: InitResponse = { authorize_url: authorize };
  return jsonResponse(body, 200);
});

function jsonResponse(
  body: InitResponse | ErrorResponse,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

