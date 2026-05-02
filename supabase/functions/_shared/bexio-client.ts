// Edge Function shared bexio-client.
// Story 1.7 AC8.
//
// Single chokepoint for all bexio HTTP calls:
//   * Loads + decrypts the active credential via service-role RPC
//     `bexio_get_active_credential_decrypted`.
//   * Proactive refresh at 80 % of token lifetime. Falls back to
//     "refresh if <5 min remaining" when last_refreshed_at is null.
//   * On 401, refresh once + retry. On second 401 → revoke + raise.
//   * On 429 → delegate to withRateLimit() (1s/4s/16s backoff).
//   * On 5xx with Retry-After → respect it; without → 1 retry then surface.
//   * Concurrency: refresh path uses bexio_record_token_refresh() which is
//     a single UPDATE; parallel invocations may both attempt a refresh, but
//     the partial-unique constraint + RPC's `where is_active = true` filter
//     keep state consistent (last writer wins; refresh_count may bump twice
//     in worst case — acceptable, well within bexio's bounds).
//
// Concurrency note:
//   For perfectly serialised refreshes across parallel Edge Function
//   invocations we'd need `select ... for update` on the credential row.
//   The current shape uses CRUD-only RPCs to avoid leaking transactional
//   complexity into the Edge Function layer; a follow-up can switch to a
//   FOR-UPDATE-locked refresh RPC if Epic 6 measures it as needed.
//
// All exported types are intentionally narrow — callers should never see
// raw plaintext token strings.

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { logEdgeError } from "./error-logger.ts";
import { BexioRateLimitError, withRateLimit } from "./rate-limiter.ts";

// ---------------------------------------------------------------------------
// Typed error union surfaced to callers.
// ---------------------------------------------------------------------------

export class BexioAuthRevokedError extends Error {
  readonly code = "BEXIO_AUTH_REVOKED" as const;
  constructor(message: string) {
    super(message);
    this.name = "BexioAuthRevokedError";
  }
}

export class BexioServerError extends Error {
  readonly code = "BEXIO_SERVER_ERROR" as const;
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "BexioServerError";
  }
}

export class BexioNetworkError extends Error {
  readonly code = "BEXIO_NETWORK_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "BexioNetworkError";
  }
}

export { BexioRateLimitError };

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

interface ActiveCredentialRow {
  id: string;
  bexio_company_id: string | null;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string;
  scope: string | null;
  last_refreshed_at: string | null;
  refresh_count: number;
  environment: "trial" | "production";
}

export interface BexioClient {
  readonly credentialId: string;
  readonly environment: "trial" | "production";
  request(
    path: string,
    init?: RequestInit & { skipRefresh?: boolean },
  ): Promise<Response>;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

export interface GetBexioClientOptions {
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.bexio.com";

export async function getBexioClient(
  supabaseAdmin: SupabaseClient,
  opts: GetBexioClientOptions = {},
): Promise<BexioClient> {
  const cred = await loadActiveCredential(supabaseAdmin);
  if (!cred) {
    throw new BexioAuthRevokedError(
      "No active bexio credential. Admin must (re)connect via /settings/bexio.",
    );
  }

  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

  // Mutable holder so refresh() can rotate access_token + expiry inside the
  // closure without losing the credential id.
  const state: { current: ActiveCredentialRow } = { current: cred };

  async function refreshNow(): Promise<void> {
    await refreshCredential(supabaseAdmin, state);
  }

  async function rawRequest(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const url = path.startsWith("http")
      ? path
      : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const headers = new Headers(init?.headers);
    headers.set("Authorization", `${state.current.token_type} ${state.current.access_token}`);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch (err) {
      throw new BexioNetworkError(
        err instanceof Error ? err.message : String(err),
      );
    }
    return response;
  }

  return {
    credentialId: cred.id,
    environment: cred.environment,
    async request(
      path: string,
      init: (RequestInit & { skipRefresh?: boolean }) = {},
    ): Promise<Response> {
      // Proactive refresh window check.
      if (!init.skipRefresh && shouldRefreshProactively(state.current)) {
        try {
          await refreshNow();
        } catch (err) {
          // Refresh failure on proactive path is critical — the next request
          // will 401; surface immediately rather than burn a wasted call.
          await handleRefreshFailure(supabaseAdmin, state.current.id, err);
          throw err;
        }
      }

      let response = await withRateLimit(() => rawRequest(path, init));

      if (response.status === 401) {
        // Reactive 401 → refresh + retry once.
        try {
          await response.body?.cancel();
        } catch {
          /* ignore */
        }
        try {
          await refreshNow();
        } catch (err) {
          await handleRefreshFailure(supabaseAdmin, state.current.id, err);
          throw err;
        }
        response = await withRateLimit(() => rawRequest(path, init));

        if (response.status === 401) {
          await handleRefreshFailure(
            supabaseAdmin,
            state.current.id,
            new Error("bexio rejected refreshed access_token (second 401)"),
          );
          throw new BexioAuthRevokedError(
            "bexio still returned 401 after refresh — admin must reconnect.",
          );
        }
      }

      if (response.status >= 500) {
        const retryAfter = parseRetryAfter(
          response.headers.get("Retry-After"),
        );
        if (retryAfter !== null) {
          try {
            await response.body?.cancel();
          } catch {
            /* ignore */
          }
          await sleep(retryAfter);
          response = await withRateLimit(() => rawRequest(path, init));
        }
        if (response.status >= 500) {
          // Surface — caller decides whether to enqueue / fail.
          throw new BexioServerError(
            `bexio ${response.status} ${response.statusText}`,
            response.status,
          );
        }
      }

      return response;
    },
  };
}

// ---------------------------------------------------------------------------
// Credential loading + refresh.
// ---------------------------------------------------------------------------

async function loadActiveCredential(
  supabaseAdmin: SupabaseClient,
): Promise<ActiveCredentialRow | null> {
  const { data, error } = await supabaseAdmin.rpc(
    "bexio_get_active_credential_decrypted",
  );
  if (error) {
    throw new Error(
      `bexio_get_active_credential_decrypted failed: ${error.message}`,
    );
  }
  const rows = (data ?? []) as ActiveCredentialRow[];
  return rows.length > 0 ? rows[0] : null;
}

function shouldRefreshProactively(cred: ActiveCredentialRow): boolean {
  const expiresMs = new Date(cred.expires_at).getTime();
  const now = Date.now();
  if (Number.isNaN(expiresMs)) return false;

  // Always refresh when we're already inside the 5-minute imminent window.
  if (expiresMs - now < 5 * 60 * 1000) {
    return true;
  }

  // 80 %-of-lifetime check needs an anchor. Use last_refreshed_at when known,
  // else created_at. expires_at - anchor = full lifetime.
  if (!cred.last_refreshed_at) {
    return false;
  }
  const anchorMs = new Date(cred.last_refreshed_at).getTime();
  if (Number.isNaN(anchorMs)) return false;
  const lifetime = expiresMs - anchorMs;
  if (lifetime <= 0) return true;
  const remaining = expiresMs - now;
  return remaining / lifetime <= 0.2;
}

async function refreshCredential(
  supabaseAdmin: SupabaseClient,
  state: { current: ActiveCredentialRow },
): Promise<void> {
  const tokenUrl = Deno.env.get("BEXIO_TOKEN_URL");
  const clientId = Deno.env.get("BEXIO_CLIENT_ID");
  const clientSecret = Deno.env.get("BEXIO_CLIENT_SECRET");
  if (!tokenUrl || !clientId || !clientSecret) {
    throw new BexioNetworkError(
      "bexio refresh: BEXIO_TOKEN_URL / CLIENT_ID / CLIENT_SECRET not configured",
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: state.current.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let resp: Response;
  try {
    resp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new BexioNetworkError(
      err instanceof Error
        ? `refresh fetch failed: ${err.message}`
        : `refresh fetch failed: ${String(err)}`,
    );
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    if (resp.status === 400 || resp.status === 401) {
      // invalid_grant — refresh token revoked / expired. Surface as auth-revoked.
      throw new BexioAuthRevokedError(
        `bexio refresh failed ${resp.status}: ${truncate(text, 200)}`,
      );
    }
    throw new BexioServerError(
      `bexio refresh ${resp.status}: ${truncate(text, 200)}`,
      resp.status,
    );
  }

  let payload: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  };
  try {
    payload = await resp.json();
  } catch (err) {
    throw new BexioNetworkError(
      err instanceof Error
        ? `refresh body parse failed: ${err.message}`
        : `refresh body parse failed: ${String(err)}`,
    );
  }

  if (!payload.access_token || !payload.refresh_token || !payload.expires_in) {
    throw new BexioNetworkError(
      "bexio refresh response missing access_token / refresh_token / expires_in",
    );
  }

  const expiresAtIso = new Date(
    Date.now() + payload.expires_in * 1000,
  ).toISOString();

  // Encrypt both tokens via the SECURITY DEFINER helpers.
  const [encAccess, encRefresh] = await Promise.all([
    encryptViaRpc(supabaseAdmin, payload.access_token),
    encryptViaRpc(supabaseAdmin, payload.refresh_token),
  ]);

  const { error: writeErr } = await supabaseAdmin.rpc(
    "bexio_record_token_refresh",
    {
      p_credential_id: state.current.id,
      p_access_token_encrypted: encAccess,
      p_refresh_token_encrypted: encRefresh,
      p_expires_at: expiresAtIso,
      p_scope: payload.scope ?? null,
    },
  );
  if (writeErr) {
    throw new BexioNetworkError(
      `bexio_record_token_refresh failed: ${writeErr.message}`,
    );
  }

  // Update in-memory state so subsequent calls in this invocation use the
  // new tokens without re-reading.
  state.current = {
    ...state.current,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type ?? state.current.token_type,
    expires_at: expiresAtIso,
    scope: payload.scope ?? state.current.scope,
    last_refreshed_at: new Date().toISOString(),
    refresh_count: state.current.refresh_count + 1,
  };
}

async function encryptViaRpc(
  supabaseAdmin: SupabaseClient,
  plaintext: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("bexio_encrypt_token", {
    p_plaintext: plaintext,
  });
  if (error || typeof data !== "string") {
    throw new Error(
      `bexio_encrypt_token failed: ${error?.message ?? "no ciphertext"}`,
    );
  }
  return data;
}

async function handleRefreshFailure(
  supabaseAdmin: SupabaseClient,
  credentialId: string,
  err: unknown,
): Promise<void> {
  const isAuthRevoked = err instanceof BexioAuthRevokedError;
  const message =
    err instanceof Error ? err.message : `bexio refresh failed: ${String(err)}`;

  await logEdgeError(
    {
      errorType: "AUTH",
      severity: "critical",
      source: "bexio-auth",
      message: truncate(message, 500),
      details: {
        actor_system: "other",
        recovery: "reconnect_required",
        is_auth_revoked: isAuthRevoked,
      },
      entity: "bexio_credentials",
      entityId: credentialId,
    },
    supabaseAdmin,
  );

  // Best-effort flip to is_active=false + audit. A failure here must not
  // mask the original refresh error.
  try {
    await supabaseAdmin.rpc("bexio_set_credentials_revoked", {
      p_credential_id: credentialId,
      p_reason: truncate(message, 200),
    });
  } catch (revokeErr) {
    console.error(
      "[bexio-client] revoke RPC failed:",
      revokeErr instanceof Error ? revokeErr.message : String(revokeErr),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  const date = new Date(header).getTime();
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.min(date - Date.now(), 30_000));
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Convenience for callers that need their own service-role client.
export function createServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in Edge Function environment",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
