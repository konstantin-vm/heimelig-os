// Edge Function shared rate-limiter.
// Story 1.7 AC9.
//
// Wraps a fetch-returning callable with bexio-aware rate-limit handling:
//   * Reads RateLimit-Remaining + RateLimit-Reset headers (per RFC draft).
//   * On 429 (or Remaining=0 BEFORE the call when we have prior knowledge),
//     sleeps with exponential backoff [1s, 4s, 16s] (per epic AC), retrying
//     up to maxRetries times.
//   * On success returns the Response.
//   * After exhausting retries, throws BexioRateLimitError.
//
// Sprint-1 limitation (documented):
//   Backoff state is per Edge-Function-invocation (single in-process call).
//   Fully shared rate-budget across concurrent invocations is an Epic 6
//   concern when 800-invoice billing runs hit limits in parallel. For
//   Sprint-1's contact-sync (sub-50 calls/min) this is sufficient.
//   TODO(epic-6): Deno KV-shared budget for parallel billing-run workers.

const BACKOFF_MS = [1_000, 4_000, 16_000] as const;
const DEFAULT_MAX_RETRIES = 3;
// Cap server-hint backoff so a misbehaving upstream cannot hold an Edge
// Function past its execution timeout.
const SERVER_HINT_CAP_MS = 120_000;

export class BexioRateLimitError extends Error {
  readonly code = "BEXIO_RATE_LIMIT" as const;
  constructor(
    message: string,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = "BexioRateLimitError";
  }
}

export interface WithRateLimitOptions {
  maxRetries?: number;
}

export async function withRateLimit(
  fetcher: () => Promise<Response>,
  opts: WithRateLimitOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let attempt = 0;

  while (true) {
    const response = await fetcher();

    if (response.status !== 429) {
      // Soft-warn when the budget is empty even though the call succeeded —
      // useful for log-driven observability later (Epic 6).
      const remainingNum = parseRemaining(response.headers.get("RateLimit-Remaining"));
      if (remainingNum === 0) {
        const reset = response.headers.get("RateLimit-Reset");
        console.warn(
          `[rate-limiter] RateLimit-Remaining=0 (Reset=${reset ?? "n/a"}); next call may 429`,
        );
      }
      return response;
    }

    // 429 — back off if retries remain.
    if (attempt >= maxRetries) {
      throw new BexioRateLimitError(
        `bexio rate limit exhausted after ${attempt + 1} attempts`,
        attempt + 1,
      );
    }

    // Honor server hints (Retry-After per RFC 6585; RateLimit-Reset per the
    // current draft) and pick max(scheduledBackoff, serverHint) so we never
    // retry sooner than the server asked for.
    const serverHintMs = readServerHintMs(response.headers);

    // Drain the body so the connection can be reused.
    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }

    const scheduledMs = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    const sleepMs = Math.max(scheduledMs, serverHintMs ?? 0);
    await sleep(sleepMs);
    attempt += 1;
  }
}

function parseRemaining(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function readServerHintMs(headers: Headers): number | null {
  // Retry-After: delta-seconds | HTTP-date.
  const retryAfter = headers.get("Retry-After");
  if (retryAfter !== null) {
    const trimmed = retryAfter.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, SERVER_HINT_CAP_MS);
    }
    const date = new Date(trimmed).getTime();
    if (!Number.isNaN(date)) {
      return Math.max(0, Math.min(date - Date.now(), SERVER_HINT_CAP_MS));
    }
  }
  // RateLimit-Reset: per the IETF draft, this is delta-seconds until the
  // window resets (some servers emit a unix timestamp; treat large values
  // as such).
  const reset = headers.get("RateLimit-Reset");
  if (reset !== null) {
    const trimmed = reset.trim();
    const value = Number(trimmed);
    if (Number.isFinite(value) && value >= 0) {
      // > 1e9 = looks like a unix timestamp (seconds since epoch).
      const ms =
        value > 1_000_000_000
          ? Math.max(0, value * 1000 - Date.now())
          : value * 1000;
      return Math.min(ms, SERVER_HINT_CAP_MS);
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
