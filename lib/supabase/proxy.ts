import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ROLE_ALLOWED_PATHS } from "@/lib/constants/roles";
import { getSessionRole, landingPathFor } from "@/lib/supabase/session";
import { logError } from "@/lib/utils/error-log";

// Paths served without a session. "/" is handled separately (root redirect).
const PUBLIC_AUTH_PREFIXES = ["/auth/"];

// Bound how long the middleware waits on the cross-region (Frankfurt → Zürich)
// log_error RPC. The redirect is what the user actually needs; logging is
// best-effort. logError() never throws, so the only thing we need to defend
// against is latency. 500ms keeps degraded-Supabase requests from feeling
// stuck while still giving a healthy round-trip room to complete.
const LOG_ERROR_TIMEOUT_MS = 500;

async function logErrorBounded(
  ...args: Parameters<typeof logError>
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, LOG_ERROR_TIMEOUT_MS);
  });
  // logError() resolves with { ok } and is documented never to throw; the
  // .catch() below is belt-and-braces against future regressions so a stray
  // rejection cannot escape Promise.race as an unhandled rejection on the
  // Edge runtime. If the timeout wins, the underlying RPC is dropped on the
  // next tear-down (Vercel Edge does not currently retain in-flight promises
  // across the redirect response — best-effort logging by design).
  await Promise.race([
    logError(...args)
      .then(() => undefined)
      .catch(() => undefined),
    timeout,
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

// Auth pages that an already-authenticated user must not land on.
// /auth/confirm (OTP) and /auth/error must stay reachable for logged-in users.
const AUTH_REDIRECT_AWAY_PREFIXES = [
  "/auth/login",
  "/auth/sign-up",
  "/auth/sign-up-success",
  "/auth/forgot-password",
  "/auth/update-password",
];

function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAuthRedirectAwayPath(pathname: string): boolean {
  return AUTH_REDIRECT_AWAY_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

function pathAllowedForRole(
  pathname: string,
  allowed: readonly string[],
): boolean {
  return allowed.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function redirectTo(request: NextRequest, target: string): NextResponse {
  const url = request.nextUrl.clone();
  const [targetPath, targetSearch = ""] = target.split("?");
  url.pathname = targetPath ?? "/";
  url.search = targetSearch ? `?${targetSearch}` : "";
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and supabase.auth.getClaims().
  // A simple mistake could make it very hard to debug issues with users being
  // randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  const pathname = request.nextUrl.pathname;

  // 1. Unauthenticated visitor — /auth/* is open, everything else goes to login.
  if (!user) {
    if (isPublicAuthPath(pathname)) return supabaseResponse;
    return redirectTo(request, "/auth/login");
  }

  // 2. Already authenticated and standing on login/signup/reset — bounce home.
  if (isAuthRedirectAwayPath(pathname)) {
    return redirectTo(request, landingPathFor(getSessionRole(user)));
  }

  // 3. Authenticated and on /auth/confirm or /auth/error — let them through.
  if (isPublicAuthPath(pathname)) return supabaseResponse;

  // 4. Root "/" — send authenticated users to their role landing.
  if (pathname === "/") {
    return redirectTo(request, landingPathFor(getSessionRole(user)));
  }

  // 5. Role-aware access check for protected routes.
  const role = getSessionRole(user);
  if (role === null) {
    // Authenticated session but no app_role set — stuck until admin fixes it.
    // nDSG: proxy.ts runs on Vercel Frankfurt — never pass PII (email, name)
    // to logError. user_id (UUID) and pathname are safe.
    await logErrorBounded(
      {
        errorType: "AUTH",
        severity: "warning",
        source: "proxy",
        message: "authenticated user has no app_role",
        details: {
          user_id: typeof user.sub === "string" ? user.sub : null,
          pathname,
        },
      },
      supabase,
    );
    return redirectTo(request, "/auth/error?error=no_role_assigned");
  }

  if (!pathAllowedForRole(pathname, ROLE_ALLOWED_PATHS[role])) {
    await logErrorBounded(
      {
        errorType: "AUTH",
        severity: "warning",
        source: "proxy",
        message: "authenticated user hit unauthorized path",
        details: {
          user_id: typeof user.sub === "string" ? user.sub : null,
          role,
          pathname,
          landing: landingPathFor(role),
        },
      },
      supabase,
    );
    return redirectTo(request, landingPathFor(role));
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!
  return supabaseResponse;
}
