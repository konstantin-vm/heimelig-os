import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/supabase/session";
import type { AppRole } from "@/lib/constants/roles";

export type ShellSession = {
  role: AppRole;
  displayName: string;
  email: string;
};

// Returns the authenticated user's role + display_name for the shell chrome.
// Assumes proxy.ts has already redirected unauthenticated or no-role users —
// if this runs without a valid session, callers are expected to render a
// fallback. PII is read live from Supabase Zürich (no "use cache").
export async function loadShellSession(): Promise<ShellSession | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const role = getSessionRole(claims);
  if (!role || !claims) return null;

  const email =
    typeof claims.email === "string" && claims.email.length > 0
      ? claims.email
      : "";
  const userId = typeof claims.sub === "string" ? claims.sub : null;

  let displayName = email ? (email.split("@")[0] ?? "") : "";

  if (userId) {
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("display_name, email")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.warn("[shell-session] user_profiles query failed:", profileError.message);
    }

    if (profile) {
      if (profile.display_name && profile.display_name.trim().length > 0) {
        displayName = profile.display_name;
      }
      if (profile.email && profile.email.length > 0 && !email) {
        return { role, displayName: displayName || "Benutzer", email: profile.email };
      }
    }
  }

  return { role, displayName: displayName || email || "Benutzer", email };
}
