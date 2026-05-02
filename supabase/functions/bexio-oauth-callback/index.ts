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

// Sane upper bound on bexio access-token lifetime (30 days). Guards against
// malformed `expires_in` from a compromised proxy or bexio returning an
// absurd value, which would otherwise produce `Invalid Date`.
const MAX_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("BEXIO_CLIENT_ID");
  const clientSecret = Deno.env.get("BEXIO_CLIENT_SECRET");
  const redirectUri = Deno.env.get("BEXIO_REDIRECT_URI");
  const tokenUrl = Deno.env.get("BEXIO_TOKEN_URL") ?? DEFAULT_TOKEN_URL;
  const appUrl =
    Deno.env.get("NEXT_PUBLIC_APP_URL") ?? Deno.env.get("APP_PUBLIC_URL");

  if (!supabaseUrl || !serviceKey) {
    return errorResponse("config", "SUPABASE_* env vars missing.", 500);
  }
  if (!clientId || !clientSecret || !redirectUri) {
    return errorResponse(
      "config",
      "BEXIO_CLIENT_ID / SECRET / REDIRECT_URI missing.",
      500,
    );
  }
  if (!appUrl) {
    // Fail loudly rather than fall back to a hardcoded preview hostname.
    return errorResponse(
      "config_missing",
      "NEXT_PUBLIC_APP_URL or APP_PUBLIC_URL must be set.",
      500,
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
          bexio_error: bexioError,
          hint: "oauth_consent_denied_or_aborted",
        },
      },
      adminClient,
    );
    return redirect(`${appUrl}/settings/bexio?error=consent`);
  }

  if (!code || !state) {
    return errorResponse(
      "missing_params",
      "code or state query param missing.",
      400,
    );
  }

  // 1. Verify state row.
  const { data: stateRows, error: stateErr } = await adminClient
    .from("bexio_oauth_states")
    .select("state, environment, used_at, expires_at, created_by")
    .eq("state", state)
    .limit(1);

  if (stateErr) {
    await logEdgeError(
      {
        errorType: "AUTH",
        severity: "error",
        source: "bexio-auth",
        message: `state lookup failed: ${stateErr.message}`,
        details: { code: stateErr.code },
      },
      adminClient,
    );
    return errorResponse(
      "state_lookup_failed",
      "Could not validate OAuth state.",
      500,
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
    );
  }

  const env = stateRow.environment as "trial" | "production";
  const initiatedBy = (stateRow as { created_by?: string | null }).created_by ?? null;

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
      const oauthCode = extractOAuthErrorCode(text);
      await logEdgeError(
        {
          errorType: "AUTH",
          severity: "critical",
          source: "bexio-auth",
          message: `bexio token exchange failed ${resp.status}`,
          details: {
            http_status: resp.status,
            // Structured-only — no raw body. Matches CLAUDE.md AC14
            // (Story 1.5) "structured codes + IDs only".
            oauth_error: oauthCode,
          },
        },
        adminClient,
      );
      return redirect(`${appUrl}/settings/bexio?error=exchange_failed`);
    }

    const rawJson = (await resp.json().catch(() => null)) as unknown;
    const validated = validateTokenPayload(rawJson);
    if (!validated) {
      await logEdgeError(
        {
          errorType: "AUTH",
          severity: "critical",
          source: "bexio-auth",
          message: "bexio token response failed schema validation",
          details: { reason: "schema_invalid" },
        },
        adminClient,
      );
      return redirect(`${appUrl}/settings/bexio?error=exchange_failed`);
    }
    tokenPayload = validated;
  } catch (err) {
    await logEdgeError(
      {
        errorType: "AUTH",
        severity: "critical",
        source: "bexio-auth",
        message: `bexio token exchange threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      adminClient,
    );
    return redirect(`${appUrl}/settings/bexio?error=exchange_failed`);
  }

  // expires_in already validated by validateTokenPayload as a finite,
  // bounded positive number — safe to multiply.
  const expiresAtIso = new Date(
    Date.now() + tokenPayload.expires_in! * 1000,
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
          access_err: encA?.message ?? null,
          refresh_err: encR?.message ?? null,
        },
      },
      adminClient,
    );
    return redirect(`${appUrl}/settings/bexio?error=encrypt_failed`);
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
      p_initiated_by: initiatedBy,
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
          code: completeErr.code,
        },
      },
      adminClient,
    );
    return redirect(`${appUrl}/settings/bexio?error=persist_failed`);
  }

  return redirect(`${appUrl}/settings/bexio?connected=1`);
});

interface TokenPayload {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

function redirect(target: string): Response {
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
): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Validate the bexio token-endpoint response against our expected shape:
// access_token + refresh_token must be non-empty strings; expires_in must be
// a finite, positive integer below MAX_EXPIRES_IN_SECONDS.
function validateTokenPayload(raw: unknown): TokenPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.access_token !== "string" || v.access_token.length === 0) return null;
  if (typeof v.refresh_token !== "string" || v.refresh_token.length === 0) return null;
  if (typeof v.expires_in !== "number") return null;
  if (
    !Number.isFinite(v.expires_in) ||
    v.expires_in <= 0 ||
    v.expires_in > MAX_EXPIRES_IN_SECONDS
  ) {
    return null;
  }
  if (v.token_type !== undefined && typeof v.token_type !== "string") return null;
  if (v.scope !== undefined && v.scope !== null && typeof v.scope !== "string") return null;
  return {
    access_token: v.access_token,
    refresh_token: v.refresh_token,
    expires_in: v.expires_in,
    token_type: typeof v.token_type === "string" ? v.token_type : undefined,
    scope: typeof v.scope === "string" ? v.scope : undefined,
  };
}

// Extract OAuth `error` code from a token-endpoint error body (RFC 6749 §5.2)
// without leaking the body into error_log. Returns the code (e.g.
// `invalid_grant`) if parseable, else null.
function extractOAuthErrorCode(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") {
      const code = parsed.error.trim();
      if (/^[A-Za-z0-9_-]{1,40}$/.test(code)) return code;
    }
  } catch {
    /* not JSON */
  }
  return null;
}
