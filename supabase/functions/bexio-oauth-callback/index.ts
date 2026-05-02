// Edge Function — bexio-oauth-callback.
// Story 1.7 AC7.
//
// Public bexio redirect target. Verifies the state, exchanges the code for
// access + refresh tokens, encrypts them via SECURITY DEFINER helpers, and
// upserts the new active credential — all in one DB transaction via
// `bexio_complete_oauth(...)` — then 303-redirects the browser back to
// /settings/bexio?connected=1 (or ?error=... on failure).
//
// nDSG: tokens never transit Vercel Frankfurt. Code exchange happens between
// this Edge Function (Zürich) and bexio (Switzerland).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { logEdgeError } from "../_shared/error-logger.ts";

const DEFAULT_TOKEN_URL =
  "https://auth.bexio.com/realms/bexio/protocol/openid-connect/token";

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("BEXIO_CLIENT_ID");
  const clientSecret = Deno.env.get("BEXIO_CLIENT_SECRET");
  const redirectUri = Deno.env.get("BEXIO_REDIRECT_URI");
  const tokenUrl = Deno.env.get("BEXIO_TOKEN_URL") ?? DEFAULT_TOKEN_URL;

  if (!supabaseUrl || !serviceKey) {
    return errorResponse(
      "config",
      "SUPABASE_* env vars missing.",
      500,
      origin(req),
    );
  }
  if (!clientId || !clientSecret || !redirectUri) {
    return errorResponse(
      "config",
      "BEXIO_CLIENT_ID / SECRET / REDIRECT_URI missing.",
      500,
      origin(req),
    );
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const bexioError = url.searchParams.get("error");

  if (bexioError) {
    await logEdgeError(
      {
        errorType: "AUTH",
        severity: "warning",
        source: "bexio-auth",
        message: `bexio OAuth consent denied / aborted: ${bexioError}`,
        details: {
          actor_system: "other",
          bexio_error: bexioError,
          hint: "oauth_consent_denied_or_aborted",
        },
      },
      adminClient,
    );
    return redirect(
      `${frontendOrigin()}/settings/bexio?error=consent`,
      origin(req),
    );
  }

  if (!code || !state) {
    return errorResponse(
      "missing_params",
      "code or state query param missing.",
      400,
      origin(req),
    );
  }

  // 1. Verify state row.
  const { data: stateRows, error: stateErr } = await adminClient
    .from("bexio_oauth_states")
    .select("state, environment, used_at, expires_at")
    .eq("state", state)
    .limit(1);

  if (stateErr) {
    await logEdgeError(
      {
        errorType: "AUTH",
        severity: "error",
        source: "bexio-auth",
        message: `state lookup failed: ${stateErr.message}`,
        details: { actor_system: "other", code: stateErr.code },
      },
      adminClient,
    );
    return errorResponse(
      "state_lookup_failed",
      "Could not validate OAuth state.",
      500,
      origin(req),
    );
  }

  const stateRow = stateRows?.[0];
  if (
    !stateRow ||
    stateRow.used_at !== null ||
    new Date(stateRow.expires_at) <= new Date()
  ) {
    await logEdgeError(
      {
        errorType: "AUTH",
        severity: "error",
        source: "bexio-auth",
        message: "bexio OAuth state invalid or expired",
        details: {
          actor_system: "other",
          reason: "state_invalid_or_expired",
          had_row: !!stateRow,
        },
      },
      adminClient,
    );
    return errorResponse(
      "state_invalid_or_expired",
      "OAuth state expired or already used.",
      400,
      origin(req),
    );
  }

  const env = stateRow.environment as "trial" | "production";

  // 2. Exchange code for tokens.
  let tokenPayload: TokenPayload;
  try {
    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      await logEdgeError(
        {
          errorType: "AUTH",
          severity: "critical",
          source: "bexio-auth",
          message: `bexio token exchange failed ${resp.status}`,
          details: {
            actor_system: "other",
            http_status: resp.status,
            body_preview: truncate(text, 200),
          },
        },
        adminClient,
      );
      return redirect(
        `${frontendOrigin()}/settings/bexio?error=exchange_failed`,
        origin(req),
      );
    }

    tokenPayload = (await resp.json()) as TokenPayload;
  } catch (err) {
    await logEdgeError(
      {
        errorType: "AUTH",
        severity: "critical",
        source: "bexio-auth",
        message: `bexio token exchange threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
        details: { actor_system: "other" },
      },
      adminClient,
    );
    return redirect(
      `${frontendOrigin()}/settings/bexio?error=exchange_failed`,
      origin(req),
    );
  }

  if (
    !tokenPayload.access_token ||
    !tokenPayload.refresh_token ||
    !tokenPayload.expires_in
  ) {
    await logEdgeError(
      {
        errorType: "AUTH",
        severity: "critical",
        source: "bexio-auth",
        message: "bexio token response missing required fields",
        details: {
          actor_system: "other",
          has_access: !!tokenPayload.access_token,
          has_refresh: !!tokenPayload.refresh_token,
          has_expires: !!tokenPayload.expires_in,
        },
      },
      adminClient,
    );
    return redirect(
      `${frontendOrigin()}/settings/bexio?error=exchange_failed`,
      origin(req),
    );
  }

  const expiresAtIso = new Date(
    Date.now() + tokenPayload.expires_in * 1000,
  ).toISOString();

  // 3. Optional: fetch bexio company id.
  let bexioCompanyId: string | null = null;
  try {
    const companyResp = await fetch("https://api.bexio.com/3.0/company", {
      headers: {
        Authorization: `${tokenPayload.token_type ?? "Bearer"} ${tokenPayload.access_token}`,
        Accept: "application/json",
      },
    });
    if (companyResp.ok) {
      const company = (await companyResp.json()) as { id?: number | string };
      if (company?.id !== undefined && company.id !== null) {
        bexioCompanyId = String(company.id);
      }
    }
  } catch {
    // Best effort — leave null.
  }

  // 4. Encrypt + atomic upsert via SECURITY DEFINER RPC.
  const [{ data: encAccess, error: encA }, { data: encRefresh, error: encR }] =
    await Promise.all([
      adminClient.rpc("bexio_encrypt_token", {
        p_plaintext: tokenPayload.access_token,
      }),
      adminClient.rpc("bexio_encrypt_token", {
        p_plaintext: tokenPayload.refresh_token,
      }),
    ]);
  if (encA || encR || typeof encAccess !== "string" || typeof encRefresh !== "string") {
    await logEdgeError(
      {
        errorType: "AUTH",
        severity: "critical",
        source: "bexio-auth",
        message: "bexio_encrypt_token failed",
        details: {
          actor_system: "other",
          access_err: encA?.message ?? null,
          refresh_err: encR?.message ?? null,
        },
      },
      adminClient,
    );
    return redirect(
      `${frontendOrigin()}/settings/bexio?error=encrypt_failed`,
      origin(req),
    );
  }

  const { error: completeErr } = await adminClient.rpc(
    "bexio_complete_oauth",
    {
      p_state: state,
      p_access_token_encrypted: encAccess,
      p_refresh_token_encrypted: encRefresh,
      p_token_type: tokenPayload.token_type ?? "Bearer",
      p_expires_at: expiresAtIso,
      p_scope: tokenPayload.scope ?? null,
      p_environment: env,
      p_bexio_company_id: bexioCompanyId,
    },
  );

  if (completeErr) {
    await logEdgeError(
      {
        errorType: "AUTH",
        severity: "critical",
        source: "bexio-auth",
        message: `bexio_complete_oauth failed: ${completeErr.message}`,
        details: {
          actor_system: "other",
          code: completeErr.code,
        },
      },
      adminClient,
    );
    return redirect(
      `${frontendOrigin()}/settings/bexio?error=persist_failed`,
      origin(req),
    );
  }

  return redirect(
    `${frontendOrigin()}/settings/bexio?connected=1`,
    origin(req),
  );
});

interface TokenPayload {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

function origin(req: Request): string {
  return req.headers.get("Origin") ?? new URL(req.url).origin;
}

function frontendOrigin(): string {
  // App lives on Vercel Frankfurt. Source of truth for the public URL is
  // NEXT_PUBLIC_APP_URL (set as Edge Function secret); fallback is the bexio
  // referrer's expected app origin from request — but we cannot trust that.
  return (
    Deno.env.get("NEXT_PUBLIC_APP_URL") ??
    Deno.env.get("APP_PUBLIC_URL") ??
    "https://heimelig-os.vercel.app"
  );
}

function redirect(target: string, _ignored?: unknown): Response {
  void _ignored;
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
    },
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  _ignored?: unknown,
): Response {
  void _ignored;
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
