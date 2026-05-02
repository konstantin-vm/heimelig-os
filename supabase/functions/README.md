# Heimelig OS — Supabase Edge Functions

Edge Functions run in **Zürich** (same region as the database) and are the only sanctioned host for code that:

- Touches bexio API tokens (encrypted at rest, decrypted only inside Zürich).
- Holds the `service_role` key (Edge Functions get it injected; Vercel never does).
- Runs server-to-server flows that must never transit Vercel Frankfurt for nDSG reasons.

Functions are deployed via:

```bash
npx supabase functions deploy <name> [<name> ...]
```

`supabase functions deploy` reads the function code from `supabase/functions/<name>/index.ts` plus shared modules under `supabase/functions/_shared/`.

---

## Shared modules (`_shared/`)

These modules are imported via relative path (`from "../_shared/<name>.ts"`) — Deno requires the explicit `.ts` extension. Do **NOT** import from the Node-side `lib/utils/error-log.ts` (uses `next/headers`); this directory ships its Edge-Function-appropriate equivalents.

| Module | Purpose |
|---|---|
| `error-logger.ts` | `logEdgeError(args, supabaseAdmin)` — service-role wrapper around the `log_error` SQL RPC. Mirrors `lib/utils/error-log.ts` shape, no Node coupling. Defaults `details.actor_system = 'other'`. nDSG rule: `details` MUST NOT contain raw customer PII (names, addresses, insurance numbers, emails). Pass IDs + structured codes only. (Shipped Story 1.7 — finalises the deferral from Story 1.5.) |
| `rate-limiter.ts` | `withRateLimit(fetcher, opts?)` — wraps a fetch-returning callable with bexio-aware 429 handling: backoff `[1s, 4s, 16s]`, max 3 retries, then throws `BexioRateLimitError`. Sprint-1 limitation: backoff state is per-Edge-Function-invocation (single in-process call). Deno KV-shared budget across parallel invocations is an Epic 6 concern — TODO comment in source. |
| `bexio-client.ts` | `getBexioClient(supabaseAdmin)` — single chokepoint for all bexio HTTP calls. Loads + decrypts the active credential via `bexio_get_active_credential_decrypted` RPC, refreshes proactively at 80% of token lifetime (or when <5 min remaining), refreshes once on 401 + retries, delegates 429 to the rate-limiter, respects 5xx Retry-After. Surfaces a typed error union `BexioAuthRevokedError | BexioRateLimitError | BexioServerError | BexioNetworkError`. Exports `createServiceRoleClient()` convenience for callers. |

Future Epic-6 modules (e.g., `bexio-invoice-helpers.ts`) live alongside these.

---

## Function inventory

| Function | Trigger | Authorization |
|---|---|---|
| `bexio-oauth-init` | Server Action `connectBexioAction` (admin-only Settings page) | Verifies caller's JWT `app_role = 'admin'`. Reads `env` from JSON body (`{"env":"trial"\|"production"}`; query-string `?env=` is accepted as legacy fallback). Generates 32-byte state, persists in `bexio_oauth_states` with `created_by = caller`, returns `{ authorize_url }`. (Story 1.7 AC6) |
| `bexio-oauth-callback` | bexio redirect target | Public endpoint by design — bexio doesn't carry a Supabase JWT. Validates `state` row (FOR UPDATE + used_at IS NULL + not expired), exchanges `code` for tokens at the bexio token endpoint, encrypts via `bexio_encrypt_token` RPC, persists atomically via `bexio_complete_oauth` RPC (advisory-locked, propagates `bexio_oauth_states.created_by` into `bexio_credentials.created_by`). 303-redirects to `${NEXT_PUBLIC_APP_URL}/settings/bexio?connected=1` or `?error=...`. Refuses to start without `NEXT_PUBLIC_APP_URL` / `APP_PUBLIC_URL`. Deployed with `--no-verify-jwt`. (Story 1.7 AC7) |
| `bexio-health` | Manual click on the Settings page | Verifies caller's JWT `app_role = 'admin'`. Issues a cheap GET against `/3.0/company` via the shared `bexio-client.ts`. Returns `{ ok, environment, expires_at, status_label, latency_ms }` or `{ ok: false, code, message, latency_ms }`. Logs typed errors (`auth_revoked`, `rate_limit`, `bexio_<status>`, `unknown`) to `error_log`. (Story 1.7 AC13) |

Future Epic-6 functions (`bexio-billing-run`, `bexio-payment-sync`, `bexio-contact-sync`, `bexio-dunning-sync`, `bexio-invoice-create`, `bexio-invoice-send`) will share `_shared/bexio-client.ts` and `_shared/error-logger.ts`.

---

## Deploy-time secrets

Set via `npx supabase secrets set <KEY>=<value>` (the Cloud project, not your local env). Verify with `npx supabase secrets list` (values are hashed in the listing — only names are shown).

| Secret | Purpose |
|---|---|
| `BEXIO_CLIENT_ID` | bexio OAuth Application client id |
| `BEXIO_CLIENT_SECRET` | bexio OAuth Application client secret |
| `BEXIO_REDIRECT_URI` | MUST be `https://<project-ref>.functions.supabase.co/bexio-oauth-callback`. Tokens never transit Vercel Frankfurt — see [migrations README "bexio-credentials encryption"](../migrations/README.md#bexio-credentials-encryption-story-17). |
| `BEXIO_AUTHORIZE_URL` | Default: `https://auth.bexio.com/realms/bexio/protocol/openid-connect/auth` |
| `BEXIO_TOKEN_URL` | Default: `https://auth.bexio.com/realms/bexio/protocol/openid-connect/token` |
| `BEXIO_SCOPES` | Default: `openid profile offline_access contact_show contact_edit kb_invoice_show kb_invoice_edit`. **`offline_access` is mandatory** — without it bexio does not issue a refresh token. |
| `NEXT_PUBLIC_APP_URL` | **Required.** Public frontend URL the OAuth callback 303-redirects back to. The callback refuses to start without it (`error=config_missing`). `APP_PUBLIC_URL` is an accepted alias. |

**Vault secret** (database-side, not a Function secret): `bexio_token_key` — see migrations README §"bexio-credentials encryption" for the one-time setup SQL.

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` are auto-injected by the Edge Function platform — no manual setup.

---

## nDSG / data residency

- All Edge Function infrastructure runs in Zürich.
- `BEXIO_REDIRECT_URI` MUST point at this Edge Function URL, NOT a Vercel route. The `/settings/bexio` Vercel page only handles the post-OAuth redirect-back; tokens never transit Frankfurt.
- bexio API endpoints (`auth.bexio.com`, `api.bexio.com`) are in Switzerland.
- Edge Functions hold the `service_role` key — Vercel never does.

---

## Deployment notes

```bash
# Default deploy (JWT verification ON at the platform gateway).
npx supabase functions deploy bexio-oauth-init bexio-health

# bexio-oauth-callback MUST be deployed with --no-verify-jwt because bexio's
# redirect doesn't carry a Supabase JWT.
npx supabase functions deploy bexio-oauth-callback --no-verify-jwt
```

To re-deploy all three at once (mixed flags), run them in two separate calls — `--no-verify-jwt` is per-deploy-call, applying to every function in that call.
