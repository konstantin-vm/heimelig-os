// Edge Function — bexio-contact-sync.
// Story 2.6 + review round 1 patches (2026-05-03).
//
// Drains customers.bexio_sync_status='pending' rows by POSTing them to the
// bexio Contact API. Two invocation paths:
//
//   1. User JWT (admin / office) — body MAY include `customer_id`.
//      Used by the manual "In bexio anlegen" / "Erneut synchronisieren"
//      buttons on the customer profile <BexioContactCard>.
//
//   2. x-cron-secret header — empty body, body.batch_size optional.
//      Used by the pg_cron + pg_net sweep scheduled in migrations 00040 + 00041.
//
// Concurrency model (review round 1, migration 00041):
//
//   * Sweep claim flips rows pending → in_progress (with a started-at
//     stamp). The Edge Function then performs the bexio HTTP work and
//     finalizes the row via:
//       * mark_bexio_contact_synced            (in_progress → synced)
//       * mark_bexio_contact_sync_failed       (in_progress → failed, sticky)
//       * release_bexio_sync_to_pending        (in_progress → pending, retriable)
//   * mark_* are gated to require status='in_progress'; if a user mid-sync
//     edit reset the row back to 'pending', the mark RPC returns false and
//     this Edge Function logs a stale-write skip — the next sweep
//     re-processes the customer with fresh data.
//   * Watchdog: claim_pending_bexio_contact_syncs first resets stale
//     in_progress rows (>10 min) so a killed Edge Function does not
//     orphan rows.
//   * Single-customer path uses claim_single_for_bexio_sync to guard
//     against rapid re-clicks and parallel cron+manual races.
//
// Per-customer flow (AC7 / AC8):
//
//   * If customers.bexio_contact_id is null/<=0 → CREATE path:
//       - POST /2.0/contact/search by api_reference (Search-Before-POST
//         recovery). bexio currently rejects api_reference as a search
//         field; the search call always 4xx → fall through to POST.
//         (Documented; tracked for /3.0/contact migration.)
//       - POST /2.0/contact with the create payload.
//   * If customers.bexio_contact_id > 0 → UPDATE path:
//       - POST /2.0/contact/{id} with the patch payload (review round 1
//         restricted to BEXIO_RETRIGGER + BEXIO_ADDRESS surface only).
//
// nDSG: every code path here runs in Supabase Zürich. error_log.details
// MUST NOT contain raw customer PII (names, emails, addresses, bexio
// response bodies that echo such fields) — IDs + structured codes only
// (Story 1.5 AC14, CLAUDE.md anti-pattern). Review round 1 H1 patch:
// dropped all `bexio_body` payloads from error_log.details.

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { z } from "https://esm.sh/zod@3.23.8";

import {
  BexioAuthRevokedError,
  BexioNetworkError,
  BexioRateLimitError,
  BexioServerError,
  type BexioClient,
  createServiceRoleClient,
  getBexioClient,
} from "../_shared/bexio-client.ts";
import { logEdgeError } from "../_shared/error-logger.ts";
import {
  bexioContactApiReference,
  bexioContactCreateResponseSchema,
  bexioContactSearchResponseSchema,
  bexioContactUpdateResponseSchema,
  customerToBexioContactPatch,
  customerToBexioContactPayload,
  type CustomerForBexio,
  type PrimaryAddressForBexio,
} from "../_shared/bexio-contact-mapper.ts";

// ---------------------------------------------------------------------------
// CORS (review round 1 H7 — fail closed when origin envs are unset).
// ---------------------------------------------------------------------------

const ALLOWED_ORIGIN =
  Deno.env.get("NEXT_PUBLIC_APP_URL") ?? Deno.env.get("APP_PUBLIC_URL") ?? null;

function corsHeadersFor(origin: string | null): Record<string, string> {
  // No fallback to "*" — combined with `Authorization` in allowed-headers,
  // a wildcard origin would be a credentialed cross-origin liability if
  // the function is deployed without env vars. Returning an empty CORS
  // header set fails closed: browsers reject the pre-flight, the manual
  // button fails with a clear console error, but cron (no pre-flight)
  // continues to work.
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

const CORS_HEADERS = corsHeadersFor(ALLOWED_ORIGIN);

// ---------------------------------------------------------------------------
// Body schema.
// ---------------------------------------------------------------------------

const requestBodySchema = z
  .object({
    customer_id: z.string().uuid().optional(),
    batch_size: z.number().int().min(1).max(100).optional(),
  })
  .strict();

type RequestBody = z.infer<typeof requestBodySchema>;

// ---------------------------------------------------------------------------
// Per-customer outcome — surfaced both to the manual caller (single
// customer) and aggregated for the sweep response.
// ---------------------------------------------------------------------------

interface PerCustomerSuccess {
  ok: true;
  customer_id: string;
  bexio_contact_id: number;
  status: "synced";
  mode: "create" | "update" | "recovery";
}

interface PerCustomerFailure {
  ok: false;
  customer_id: string;
  code: string;
  message: string; // German user-friendly
  retriable: boolean; // true → row goes back to pending; false → sticky failed
  authRevoked?: boolean;
}

type PerCustomerResult = PerCustomerSuccess | PerCustomerFailure;

// Sweep wall-clock budget — keep well under Supabase Edge Function
// execution timeout (60s on Free / 300s on Pro). Combined with the
// reduced default batch_size of 10 and bexio backoff, a sweep finishes
// within ~30s in the happy path and aborts cleanly under degraded bexio.
const SWEEP_BUDGET_MS = 50_000;

// Default batch size for the sweep (review round 1 H8: lowered from 25
// so a degraded bexio is less likely to time out the whole sweep).
const DEFAULT_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, code: "method_not_allowed", message: "Use POST" },
      405,
    );
  }

  // -----------------------------------------------------------------------
  // Env + supabase admin client.
  // -----------------------------------------------------------------------

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return jsonResponse(
      { ok: false, code: "config", message: "SUPABASE_* env vars missing" },
      500,
    );
  }

  const cronSecret = Deno.env.get("BEXIO_CRON_SECRET");
  const defaultUserIdRaw = Deno.env.get("BEXIO_DEFAULT_USER_ID");
  const defaultUserId = defaultUserIdRaw ? Number(defaultUserIdRaw) : NaN;
  if (!Number.isInteger(defaultUserId) || defaultUserId <= 0) {
    return jsonResponse(
      {
        ok: false,
        code: "config",
        message:
          "BEXIO_DEFAULT_USER_ID must be a positive integer (set via `supabase secrets set`)",
      },
      500,
    );
  }

  let adminClient: SupabaseClient;
  try {
    adminClient = createServiceRoleClient();
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        code: "config",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  // -----------------------------------------------------------------------
  // Auth gate (AC4): cron-secret OR user JWT (admin/office).
  // -----------------------------------------------------------------------

  const cronHeader = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  let invocationMode: "cron" | "user";

  if (cronHeader && cronSecret && timingSafeEqual(cronHeader, cronSecret)) {
    invocationMode = "cron";
  } else if (authHeader.toLowerCase().startsWith("bearer ")) {
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
    if (appRole !== "admin" && appRole !== "office") {
      return jsonResponse(
        {
          ok: false,
          code: "forbidden",
          message: "Admin or office role required.",
        },
        403,
      );
    }
    invocationMode = "user";
  } else {
    return jsonResponse(
      { ok: false, code: "unauthorized", message: "Missing credentials." },
      401,
    );
  }

  // -----------------------------------------------------------------------
  // Body parse.
  // -----------------------------------------------------------------------

  let body: RequestBody;
  try {
    const raw = req.headers.get("content-length") === "0"
      ? {}
      : await req.json().catch(() => ({}));
    const parsed = requestBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          code: "validation",
          message: "Invalid request body",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            code: i.code,
          })),
        },
        400,
      );
    }
    body = parsed.data;
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        code: "validation",
        message: err instanceof Error ? err.message : "bad body",
      },
      400,
    );
  }

  // -----------------------------------------------------------------------
  // Branch on body shape.
  // -----------------------------------------------------------------------

  if (body.customer_id) {
    // Single-customer manual sync (AC9).
    const result = await syncSingleCustomer({
      customerId: body.customer_id,
      adminClient,
      defaultUserId,
    });
    return jsonResponse(
      result.ok
        ? {
          ok: true,
          customer_id: result.customer_id,
          bexio_contact_id: result.bexio_contact_id,
          status: result.status,
          mode: result.mode,
        }
        : {
          ok: false,
          customer_id: result.customer_id,
          code: result.code,
          message: result.message,
        },
      200,
    );
  }

  // Sweep branch (AC10) — only allowed via cron secret (so an office user
  // clicking the manual button can't accidentally trigger a batch claim
  // by sending an empty body).
  if (invocationMode !== "cron") {
    return jsonResponse(
      {
        ok: false,
        code: "missing_customer_id",
        message:
          "customer_id is required for user-initiated sync. Sweep is cron-only.",
      },
      400,
    );
  }

  const batchSize = body.batch_size ?? DEFAULT_BATCH_SIZE;
  const sweep = await runSweep({
    adminClient,
    defaultUserId,
    batchSize,
  });

  // Surface the claim/auth_revoked failure modes via non-2xx so cron's
  // job_run_details.status reflects "failed" instead of silently green.
  return jsonResponse(sweep, sweep.ok ? 200 : 500);
});

// ---------------------------------------------------------------------------
// Single-customer sync.
// ---------------------------------------------------------------------------

interface SingleCtx {
  adminClient: SupabaseClient;
  defaultUserId: number;
}

async function syncSingleCustomer(
  args: SingleCtx & { customerId: string },
): Promise<PerCustomerResult> {
  const { customerId, adminClient } = args;

  // Reservation FIRST so a rapid double-click or cron+manual overlap
  // resolves to "overlap" rather than two parallel POSTs to bexio.
  const { data: claimed, error: claimErr } = await adminClient.rpc(
    "claim_single_for_bexio_sync",
    { p_customer_id: customerId },
  );
  if (claimErr) {
    await logEdgeError(
      {
        errorType: "DB_FUNCTION",
        severity: "error",
        source: "contact-sync",
        message: `claim_single_for_bexio_sync failed: ${claimErr.message}`,
        details: {
          customer_id: customerId,
          code: claimErr.code ?? null,
        },
        entity: "customers",
        entityId: customerId,
      },
      adminClient,
    );
    return {
      ok: false,
      customer_id: customerId,
      code: "claim_error",
      message: "Reservierung in bexio_sync_status fehlgeschlagen.",
      retriable: false,
    };
  }
  if (!claimed) {
    return {
      ok: false,
      customer_id: customerId,
      code: "overlap",
      message:
        "Synchronisation läuft bereits (oder Kunde ist nicht aktiv) — bitte einen Moment warten.",
      retriable: true,
    };
  }

  // Now we hold the in_progress reservation. Acquire the bexio client;
  // on auth_revoked, mark this single row failed so the user gets a
  // visible "Admin muss neu verbinden" surface (review round 1 M9).
  let bexio: BexioClient;
  try {
    bexio = await getBexioClient(adminClient);
  } catch (err) {
    if (err instanceof BexioAuthRevokedError) {
      const marked = await markFailed(adminClient, customerId, "auth_revoked");
      if (!marked.ok && marked.reason === "stale") {
        // Row was edited mid-call — release reservation if still ours.
        await releaseToPending(adminClient, customerId);
      }
      return {
        ok: false,
        customer_id: customerId,
        code: "auth_revoked",
        message:
          "bexio-Verbindung wurde widerrufen — Admin muss /settings/bexio neu verbinden.",
        retriable: false,
        authRevoked: true,
      };
    }
    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: "error",
        source: "contact-sync",
        message: `getBexioClient failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        entity: "customers",
        entityId: customerId,
      },
      adminClient,
    );
    await releaseToPending(adminClient, customerId);
    return {
      ok: false,
      customer_id: customerId,
      code: "unknown",
      message: "Unerwarteter Fehler beim Laden des bexio-Tokens.",
      retriable: true,
    };
  }

  const loaded = await loadCustomerWithPrimaryAddress(adminClient, customerId);
  if (!loaded.ok) {
    if (loaded.code === "not_found") {
      // Customer deleted between claim and load. Don't call markFailed —
      // the gate would no-op anyway and we'd write noise.
      return {
        ok: false,
        customer_id: customerId,
        code: loaded.code,
        message: loaded.message,
        retriable: false,
      };
    }
    // missing_primary_address / load_error — sticky failed surfaces the
    // problem on the card. markFailed only flips if status is still
    // in_progress; if the user re-edited the row mid-call (now pending),
    // we release back to pending so the next sweep retries.
    const marked = await markFailed(adminClient, customerId, loaded.code);
    if (!marked.ok && marked.reason === "stale") {
      await releaseToPending(adminClient, customerId);
    }
    return {
      ok: false,
      customer_id: customerId,
      code: loaded.code,
      message: loaded.message,
      retriable: false,
    };
  }

  return await syncOne({
    adminClient,
    bexio,
    defaultUserId: args.defaultUserId,
    customer: loaded.customer,
    primaryAddress: loaded.primaryAddress,
    existingBexioContactId: loaded.existingBexioContactId,
  });
}

// ---------------------------------------------------------------------------
// Sweep — claim + iterate serially.
// ---------------------------------------------------------------------------

interface SweepResponse {
  ok: boolean;
  processed: number;
  synced: number;
  failed: number;
  retried: number;
  saturated: boolean;
  auth_revoked: boolean;
  aborted: "auth_revoked" | "budget" | "claim_error" | null;
}

interface SweepCtx {
  adminClient: SupabaseClient;
  defaultUserId: number;
  batchSize: number;
}

async function runSweep(ctx: SweepCtx): Promise<SweepResponse> {
  const { adminClient, batchSize } = ctx;

  // Acquire bexio client up-front. On auth_revoked, return a non-2xx so
  // cron's job_run_details.status surfaces it (M4) — no rows are claimed.
  let bexio: BexioClient;
  try {
    bexio = await getBexioClient(adminClient);
  } catch (err) {
    if (err instanceof BexioAuthRevokedError) {
      await logEdgeError(
        {
          errorType: "BEXIO_API",
          severity: "warning",
          source: "contact-sync",
          message: "sweep aborted on auth_revoked (no rows claimed)",
          details: { code: "auth_revoked", batch_size: batchSize },
        },
        adminClient,
      );
      return emptySweep({ ok: false, auth_revoked: true, aborted: "auth_revoked" });
    }
    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: "error",
        source: "contact-sync",
        message: `getBexioClient failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      adminClient,
    );
    return emptySweep({ ok: false, aborted: "claim_error" });
  }

  const { data, error } = await adminClient.rpc(
    "claim_pending_bexio_contact_syncs",
    { p_limit: batchSize },
  );
  if (error) {
    await logEdgeError(
      {
        errorType: "DB_FUNCTION",
        severity: "error",
        source: "contact-sync",
        message: `claim_pending_bexio_contact_syncs failed: ${error.message}`,
        details: { code: error.code ?? null },
      },
      adminClient,
    );
    return emptySweep({ ok: false, aborted: "claim_error" });
  }

  const customerIds = ((data ?? []) as Array<{ id?: string } | string>).map(
    (row) => (typeof row === "string" ? row : (row.id ?? "")),
  ).filter((id): id is string => id.length > 0);

  let synced = 0;
  let failed = 0;
  let retried = 0;
  let aborted: SweepResponse["aborted"] = null;
  let authRevoked = false;
  const startedAt = Date.now();

  // Serial — bexio rate limit is per-org, parallel makes the shared
  // client's backoff useless.
  let i = 0;
  for (; i < customerIds.length; i++) {
    if (Date.now() - startedAt > SWEEP_BUDGET_MS) {
      aborted = "budget";
      break;
    }
    const customerId = customerIds[i]!;
    const loaded = await loadCustomerWithPrimaryAddress(adminClient, customerId);
    if (!loaded.ok) {
      if (loaded.code === "not_found") {
        // Row was deleted between claim and load — try to clean up.
        await releaseToPending(adminClient, customerId);
        failed++;
        continue;
      }
      const marked = await markFailed(adminClient, customerId, loaded.code);
      if (!marked.ok && marked.reason === "stale") {
        await releaseToPending(adminClient, customerId);
        retried++;
      } else {
        failed++;
      }
      continue;
    }
    const result = await syncOne({
      adminClient,
      bexio,
      defaultUserId: ctx.defaultUserId,
      customer: loaded.customer,
      primaryAddress: loaded.primaryAddress,
      existingBexioContactId: loaded.existingBexioContactId,
    });
    if (result.ok) {
      synced++;
    } else if (result.retriable) {
      retried++;
      if (result.authRevoked) {
        authRevoked = true;
        aborted = "auth_revoked";
        break;
      }
    } else {
      failed++;
    }
  }

  // For abort paths: release the reservations on the rows we never
  // touched so the next sweep can pick them up cleanly.
  if (aborted) {
    for (let j = i + 1; j < customerIds.length; j++) {
      await releaseToPending(adminClient, customerIds[j]!);
      retried++;
    }
  }

  const processed = synced + failed + retried;
  const saturated = processed === customerIds.length && customerIds.length === batchSize && !aborted;

  // M4 / M5: emit a warning when sweep aborts on auth_revoked or saturates.
  if (aborted === "auth_revoked") {
    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: "warning",
        source: "contact-sync",
        message: "sweep aborted on auth_revoked",
        details: {
          code: "auth_revoked",
          batch_size: batchSize,
          processed,
          synced,
          failed,
          retried,
        },
      },
      adminClient,
    );
  } else if (aborted === "budget") {
    await logEdgeError(
      {
        errorType: "EDGE_FUNCTION",
        severity: "warning",
        source: "contact-sync",
        message: "sweep aborted on wall-clock budget",
        details: {
          code: "budget_exceeded",
          batch_size: batchSize,
          processed,
          synced,
          failed,
          retried,
          budget_ms: SWEEP_BUDGET_MS,
        },
      },
      adminClient,
    );
  } else if (saturated) {
    // Backlog likely exceeds batch_size — bumped from `info` to `warning`
    // so the admin error dashboard surfaces a growing queue.
    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: "warning",
        source: "contact-sync",
        message: "sweep saturated — pending backlog likely larger than batch_size",
        details: {
          code: "sweep_saturated",
          batch_size: batchSize,
          synced,
          failed,
          retried,
        },
      },
      adminClient,
    );
  }

  return {
    ok: aborted === null || aborted === "auth_revoked" ? !aborted : false,
    processed,
    synced,
    failed,
    retried,
    saturated,
    auth_revoked: authRevoked,
    aborted,
  };
}

function emptySweep(overrides: Partial<SweepResponse>): SweepResponse {
  return {
    ok: false,
    processed: 0,
    synced: 0,
    failed: 0,
    retried: 0,
    saturated: false,
    auth_revoked: false,
    aborted: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// One-row sync — shared by single + sweep paths.
// ---------------------------------------------------------------------------

interface SyncOneArgs {
  adminClient: SupabaseClient;
  bexio: BexioClient;
  defaultUserId: number;
  customer: CustomerForBexio;
  primaryAddress: PrimaryAddressForBexio;
  existingBexioContactId: number | null;
}

async function syncOne(args: SyncOneArgs): Promise<PerCustomerResult> {
  const { adminClient, bexio, defaultUserId, customer, primaryAddress, existingBexioContactId } =
    args;

  try {
    if (existingBexioContactId === null || existingBexioContactId <= 0) {
      // CREATE path with Search-Before-POST recovery (AC7).
      const recovered = await searchByApiReference(bexio, customer.id, adminClient);
      if (recovered.kind === "found") {
        return await finalizeSynced(args, recovered.id, "recovery");
      }
      if (recovered.kind === "duplicate") {
        // bexio has duplicates with our api_reference — data corruption.
        await logEdgeError(
          {
            errorType: "BEXIO_API",
            severity: "critical",
            source: "contact-sync",
            message: "bexio search returned >1 matches for api_reference",
            details: {
              customer_id: customer.id,
              match_count: recovered.count,
              code: "duplicate_api_reference",
            },
            entity: "customers",
            entityId: customer.id,
          },
          adminClient,
        );
        return await finalizeFailed(
          args,
          "duplicate_api_reference",
          "In bexio existieren mehrere Kontakte mit derselben Heimelig-Referenz — bitte manuell prüfen.",
        );
      }
      const payload = customerToBexioContactPayload(
        customer,
        primaryAddress,
        { defaultUserId },
      );
      const resp = await bexio.request("/2.0/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return await handleResponse(args, resp, "create");
    }

    // UPDATE path (AC8).
    const patch = customerToBexioContactPatch(customer, primaryAddress);
    const resp = await bexio.request(
      `/2.0/contact/${existingBexioContactId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    return await handleResponse(args, resp, "update");
  } catch (err) {
    return await mapErrorToOutcome(args, err);
  }
}

// ---------------------------------------------------------------------------
// Search-Before-POST.
// ---------------------------------------------------------------------------

type SearchOutcome =
  | { kind: "not_found" }
  | { kind: "found"; id: number }
  | { kind: "duplicate"; count: number };

async function searchByApiReference(
  bexio: BexioClient,
  customerId: string,
  adminClient: SupabaseClient,
): Promise<SearchOutcome> {
  const resp = await bexio.request("/2.0/contact/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      {
        field: "api_reference",
        value: bexioContactApiReference(customerId),
        criteria: "=",
      },
    ]),
  });
  if (!resp.ok) {
    // Diagnostic: log the failed search WITHOUT the raw body (PII safe).
    // The status code + structured search code is enough to spot
    // unsupported-field / auth-scope drift.
    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: resp.status >= 500 ? "warning" : "info",
        source: "contact-sync",
        message: `bexio /2.0/contact/search returned ${resp.status}`,
        details: {
          customer_id: customerId,
          bexio_status: resp.status,
          code: `search_${resp.status}`,
        },
        entity: "customers",
        entityId: customerId,
      },
      adminClient,
    );
    if (resp.status >= 400 && resp.status < 500) {
      // bexio rejected the search request itself — most likely an
      // unsupported search field. Treat as "no match" and proceed to
      // POST. The deferred-fix is to migrate to /3.0/contact where
      // api_reference is honored as a search field.
      return { kind: "not_found" };
    }
    // 5xx: surface so the row stays pending for next sweep.
    throw new BexioServerError(
      `bexio /2.0/contact/search returned ${resp.status}`,
      resp.status,
    );
  }
  const json = (await resp.json().catch(() => null)) as unknown;
  const parsed = bexioContactSearchResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new BexioServerError(
      "bexio /2.0/contact/search response shape invalid",
      200,
    );
  }
  if (parsed.data.length === 0) return { kind: "not_found" };
  if (parsed.data.length === 1) return { kind: "found", id: parsed.data[0]!.id };
  return { kind: "duplicate", count: parsed.data.length };
}

// ---------------------------------------------------------------------------
// Response handler — branches on status code.
// ---------------------------------------------------------------------------

async function handleResponse(
  args: SyncOneArgs,
  resp: Response,
  mode: "create" | "update",
): Promise<PerCustomerResult> {
  const { adminClient, customer, existingBexioContactId } = args;

  if (resp.ok) {
    const json = (await resp.json().catch(() => null)) as unknown;
    const schema =
      mode === "create"
        ? bexioContactCreateResponseSchema
        : bexioContactUpdateResponseSchema;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // Hard contract drift — bexio returned a shape we cannot read.
      await logEdgeError(
        {
          errorType: "EDGE_FUNCTION",
          severity: "error",
          source: "contact-sync",
          message: `bexio response shape invalid (mode=${mode})`,
          details: { customer_id: customer.id, code: "response_shape_invalid" },
          entity: "customers",
          entityId: customer.id,
        },
        adminClient,
      );
      return await finalizeFailed(
        args,
        "response_shape_invalid",
        "Antwort von bexio konnte nicht gelesen werden.",
      );
    }
    const bexioId = parsed.data.id ?? existingBexioContactId;
    if (!bexioId || bexioId <= 0) {
      return await finalizeFailed(
        args,
        "missing_bexio_id",
        "bexio hat keine gültige Kontakt-ID zurückgegeben.",
      );
    }
    return await finalizeSynced(args, bexioId, mode);
  }

  // 4xx — sticky failure. Drop bexio_body from details (PII risk —
  // bexio echoes the offending field value). Use the German status
  // helper which still surfaces a short message in the UI toast.
  if (resp.status >= 400 && resp.status < 500) {
    const text = await resp.text().catch(() => "");
    const code = `bexio_${resp.status}`;
    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: "error",
        source: "contact-sync",
        message: `bexio ${resp.status} on contact ${mode}`,
        details: {
          customer_id: customer.id,
          bexio_status: resp.status,
          mode,
          code,
        },
        entity: "customers",
        entityId: customer.id,
      },
      adminClient,
    );
    return await finalizeFailed(
      args,
      code,
      deriveGermanErrorMessage(resp.status, text),
    );
  }

  // 5xx — leave pending for the next sweep (release reservation).
  await logEdgeError(
    {
      errorType: "BEXIO_API",
      severity: "warning",
      source: "contact-sync",
      message: `bexio ${resp.status} on contact ${mode}`,
      details: {
        customer_id: customer.id,
        bexio_status: resp.status,
        mode,
        code: `bexio_${resp.status}`,
      },
      entity: "customers",
      entityId: customer.id,
    },
    adminClient,
  );
  await releaseToPending(adminClient, customer.id);
  return {
    ok: false,
    customer_id: customer.id,
    code: `bexio_${resp.status}`,
    message: "bexio antwortet aktuell nicht — Versuch in 5 Minuten erneut.",
    retriable: true,
  };
}

// ---------------------------------------------------------------------------
// Error → outcome mapping.
// ---------------------------------------------------------------------------

async function mapErrorToOutcome(
  args: SyncOneArgs,
  err: unknown,
): Promise<PerCustomerResult> {
  const { adminClient, customer } = args;

  if (err instanceof BexioAuthRevokedError) {
    // The shared client already audited + critical-logged. Release the
    // reservation so the row goes back to pending — the next sweep will
    // surface auth_revoked again until admin reconnects.
    await releaseToPending(adminClient, customer.id);
    return {
      ok: false,
      customer_id: customer.id,
      code: "auth_revoked",
      message:
        "bexio-Verbindung wurde widerrufen — Admin muss neu verbinden.",
      retriable: true,
      authRevoked: true,
    };
  }
  if (err instanceof BexioRateLimitError) {
    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: "warning",
        source: "contact-sync",
        message: "bexio rate limit exhausted",
        details: { customer_id: customer.id, code: "rate_limit", attempts: err.attempts },
        entity: "customers",
        entityId: customer.id,
      },
      adminClient,
    );
    await releaseToPending(adminClient, customer.id);
    return {
      ok: false,
      customer_id: customer.id,
      code: "rate_limit",
      message: "bexio Rate-Limit erreicht — Versuch in 5 Minuten erneut.",
      retriable: true,
    };
  }
  if (err instanceof BexioServerError) {
    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: "warning",
        source: "contact-sync",
        message: `bexio server error ${err.status}`,
        details: { customer_id: customer.id, bexio_status: err.status, code: `bexio_${err.status}` },
        entity: "customers",
        entityId: customer.id,
      },
      adminClient,
    );
    await releaseToPending(adminClient, customer.id);
    return {
      ok: false,
      customer_id: customer.id,
      code: `bexio_${err.status}`,
      message: "bexio antwortet aktuell nicht — Versuch in 5 Minuten erneut.",
      retriable: true,
    };
  }
  if (err instanceof BexioNetworkError) {
    await logEdgeError(
      {
        errorType: "BEXIO_API",
        severity: "warning",
        source: "contact-sync",
        message: `bexio network error: ${err.message}`,
        details: { customer_id: customer.id, code: "network" },
        entity: "customers",
        entityId: customer.id,
      },
      adminClient,
    );
    await releaseToPending(adminClient, customer.id);
    return {
      ok: false,
      customer_id: customer.id,
      code: "network",
      message: "bexio nicht erreichbar — Versuch in 5 Minuten erneut.",
      retriable: true,
    };
  }

  // Our own bug.
  await logEdgeError(
    {
      errorType: "EDGE_FUNCTION",
      severity: "error",
      source: "contact-sync",
      message: err instanceof Error ? err.message : String(err),
      details: { customer_id: customer.id, code: "edge_function_bug" },
      entity: "customers",
      entityId: customer.id,
    },
    adminClient,
  );
  return await finalizeFailed(
    args,
    "edge_function_bug",
    "Unerwarteter Fehler — siehe Fehlerprotokoll.",
  );
}

// ---------------------------------------------------------------------------
// Finalizers — wrap the gated mark_* RPCs with the stale-write recovery.
// ---------------------------------------------------------------------------

async function finalizeSynced(
  args: SyncOneArgs,
  bexioId: number,
  mode: "create" | "update" | "recovery",
): Promise<PerCustomerResult> {
  const { adminClient, customer } = args;
  const marked = await markSynced(adminClient, customer.id, bexioId);
  if (marked.ok) {
    return {
      ok: true,
      customer_id: customer.id,
      bexio_contact_id: bexioId,
      status: "synced",
      mode,
    };
  }
  if (marked.reason === "stale") {
    // A user re-edited the row mid-sync; the fresh edit reset status to
    // 'pending'. Don't override; the next sweep will sync with the new
    // data. We MUST also clear our reservation flag if the row is still
    // somehow in_progress (defensive).
    await logEdgeError(
      {
        errorType: "EDGE_FUNCTION",
        severity: "info",
        source: "contact-sync",
        message: "mark_synced skipped — row was re-edited mid-sync",
        details: { customer_id: customer.id, code: "stale_sync_skipped" },
        entity: "customers",
        entityId: customer.id,
      },
      adminClient,
    );
    return {
      ok: false,
      customer_id: customer.id,
      code: "stale_sync_skipped",
      message:
        "Während der Synchronisation wurde der Kunde bearbeitet — der Folge-Sweep übernimmt.",
      retriable: true,
    };
  }
  // RPC error — try to release reservation so the next sweep retries.
  await releaseToPending(adminClient, customer.id);
  return {
    ok: false,
    customer_id: customer.id,
    code: "mark_synced_rpc_failed",
    message: "Status konnte nicht auf ‚synced‘ gesetzt werden — wird wiederholt.",
    retriable: true,
  };
}

async function finalizeFailed(
  args: SyncOneArgs,
  code: string,
  message: string,
): Promise<PerCustomerResult> {
  const { adminClient, customer } = args;
  const marked = await markFailed(adminClient, customer.id, code);
  if (marked.ok) {
    return {
      ok: false,
      customer_id: customer.id,
      code,
      message,
      retriable: false,
    };
  }
  if (marked.reason === "stale") {
    // Row was re-edited mid-call — release reservation and let next
    // sweep re-process with fresh data. Don't burn the user with a
    // sticky-failed message.
    await releaseToPending(adminClient, customer.id);
    return {
      ok: false,
      customer_id: customer.id,
      code: "stale_sync_skipped",
      message:
        "Während der Synchronisation wurde der Kunde bearbeitet — der Folge-Sweep übernimmt.",
      retriable: true,
    };
  }
  // RPC failure — release reservation so we don't orphan the row.
  await releaseToPending(adminClient, customer.id);
  return {
    ok: false,
    customer_id: customer.id,
    code: "mark_failed_rpc_failed",
    message: "Fehlerstatus konnte nicht gesetzt werden — wird wiederholt.",
    retriable: true,
  };
}

// ---------------------------------------------------------------------------
// DB helpers.
// ---------------------------------------------------------------------------

interface CustomerLoad {
  ok: true;
  customer: CustomerForBexio;
  primaryAddress: PrimaryAddressForBexio;
  existingBexioContactId: number | null;
}

interface CustomerLoadFailure {
  ok: false;
  code: "not_found" | "missing_primary_address" | "load_error";
  message: string;
}

async function loadCustomerWithPrimaryAddress(
  adminClient: SupabaseClient,
  customerId: string,
): Promise<CustomerLoad | CustomerLoadFailure> {
  const { data: customerRow, error: customerErr } = await adminClient
    .from("customers")
    .select(
      "id, customer_type, salutation, first_name, last_name, company_name, email, phone, mobile, language, bexio_contact_id",
    )
    .eq("id", customerId)
    .maybeSingle();

  if (customerErr) {
    return {
      ok: false,
      code: "load_error",
      message: `Kunde konnte nicht geladen werden: ${customerErr.message}`,
    };
  }
  if (!customerRow) {
    return {
      ok: false,
      code: "not_found",
      message: "Kunde nicht gefunden.",
    };
  }

  const { data: addressRow, error: addressErr } = await adminClient
    .from("customer_addresses")
    .select("street, street_number, zip, city, country")
    .eq("customer_id", customerId)
    .eq("address_type", "primary")
    .eq("is_default_for_type", true)
    .eq("is_active", true)
    .maybeSingle();

  if (addressErr) {
    return {
      ok: false,
      code: "load_error",
      message: `Adresse konnte nicht geladen werden: ${addressErr.message}`,
    };
  }
  if (!addressRow) {
    return {
      ok: false,
      code: "missing_primary_address",
      message:
        "Kunde hat keine aktive Hauptadresse — bexio-Sync nicht möglich.",
    };
  }

  return {
    ok: true,
    customer: {
      id: customerRow.id,
      customer_type: customerRow.customer_type,
      salutation: customerRow.salutation,
      first_name: customerRow.first_name,
      last_name: customerRow.last_name,
      company_name: customerRow.company_name,
      email: customerRow.email,
      phone: customerRow.phone,
      mobile: customerRow.mobile,
      language: customerRow.language,
    },
    primaryAddress: {
      street: addressRow.street,
      street_number: addressRow.street_number,
      zip: addressRow.zip,
      city: addressRow.city,
      country: addressRow.country,
    },
    existingBexioContactId: customerRow.bexio_contact_id ?? null,
  };
}

interface MarkOutcome {
  ok: boolean;
  reason?: "stale" | "rpc_error";
}

async function markSynced(
  adminClient: SupabaseClient,
  customerId: string,
  bexioContactId: number,
): Promise<MarkOutcome> {
  const { data, error } = await adminClient.rpc("mark_bexio_contact_synced", {
    p_customer_id: customerId,
    p_bexio_contact_id: bexioContactId,
  });
  if (error) {
    await logEdgeError(
      {
        errorType: "DB_FUNCTION",
        severity: "error",
        source: "contact-sync",
        message: `mark_bexio_contact_synced failed: ${error.message}`,
        details: {
          customer_id: customerId,
          bexio_contact_id: bexioContactId,
          code: error.code ?? null,
        },
        entity: "customers",
        entityId: customerId,
      },
      adminClient,
    );
    return { ok: false, reason: "rpc_error" };
  }
  if (data === false) return { ok: false, reason: "stale" };
  return { ok: true };
}

async function markFailed(
  adminClient: SupabaseClient,
  customerId: string,
  errorCode: string,
): Promise<MarkOutcome> {
  const { data, error } = await adminClient.rpc("mark_bexio_contact_sync_failed", {
    p_customer_id: customerId,
    p_error_code: errorCode,
  });
  if (error) {
    await logEdgeError(
      {
        errorType: "DB_FUNCTION",
        severity: "error",
        source: "contact-sync",
        message: `mark_bexio_contact_sync_failed failed: ${error.message}`,
        details: {
          customer_id: customerId,
          attempted_code: errorCode,
          code: error.code ?? null,
        },
        entity: "customers",
        entityId: customerId,
      },
      adminClient,
    );
    return { ok: false, reason: "rpc_error" };
  }
  if (data === false) return { ok: false, reason: "stale" };
  return { ok: true };
}

async function releaseToPending(
  adminClient: SupabaseClient,
  customerId: string,
): Promise<void> {
  const { error } = await adminClient.rpc("release_bexio_sync_to_pending", {
    p_customer_id: customerId,
  });
  if (error) {
    await logEdgeError(
      {
        errorType: "DB_FUNCTION",
        severity: "warning",
        source: "contact-sync",
        message: `release_bexio_sync_to_pending failed: ${error.message}`,
        details: { customer_id: customerId, code: error.code ?? null },
        entity: "customers",
        entityId: customerId,
      },
      adminClient,
    );
  }
}

// ---------------------------------------------------------------------------
// Tiny helpers.
// ---------------------------------------------------------------------------

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

// Constant-time comparison for the cron secret. Not perfectly resistant
// to length-leak (early return on length mismatch), but good enough for
// a 32-byte hex secret over TLS.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function deriveGermanErrorMessage(status: number, body: string): string {
  // bexio's 4xx body is JSON `{ error: '...', error_code: '...', message: '...' }`
  // shaped — extract message when present, else fall back to a generic.
  // The body itself is NOT logged (PII risk); only this short surface is
  // shown to the user via the toast and the failed-card panel.
  try {
    const parsed = JSON.parse(body) as {
      message?: unknown;
      error?: unknown;
    };
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return `bexio (${status}): ${parsed.message.slice(0, 200)}`;
    }
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return `bexio (${status}): ${parsed.error.slice(0, 200)}`;
    }
  } catch {
    /* not JSON */
  }
  if (status === 401 || status === 403) {
    return "bexio hat den Zugriff verweigert — Admin muss Berechtigungen prüfen.";
  }
  if (status === 422 || status === 400) {
    return "bexio hat die Daten abgelehnt — bitte Pflichtfelder prüfen.";
  }
  return `bexio antwortete mit Status ${status}.`;
}
