"use server";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/utils/error-log";
import {
  connectBexioActionInputSchema,
  type ConnectBexioActionInput,
} from "@/lib/validations/bexio-oauth";

type ActionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string };

// Server Action invoked by the /settings/bexio page when the admin clicks
// "Verbinden" / "Neu verbinden". Reaches the bexio-oauth-init Edge Function
// using the user's authenticated supabase client; the Edge Function itself
// re-checks the JWT app_role claim. Returns the bexio authorize URL the
// browser navigates to.
export async function connectBexioAction(
  raw: ConnectBexioActionInput,
): Promise<ActionResult> {
  const parsed = connectBexioActionInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Ungültige Eingabe." };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) {
    return { ok: false, message: "Sitzung abgelaufen." };
  }

  const { data, error } = await supabase.functions.invoke<{ authorize_url?: string }>(
    `bexio-oauth-init?env=${parsed.data.env}`,
    { method: "POST" },
  );

  if (error || !data?.authorize_url) {
    await logError(
      {
        errorType: "EDGE_FUNCTION",
        severity: "error",
        source: "settings-bexio",
        message: error?.message ?? "bexio-oauth-init returned empty authorize_url",
        details: {
          env: parsed.data.env,
          actor_system: "other",
        },
      },
      supabase,
    );
    return {
      ok: false,
      message: "Verbindung konnte nicht initiiert werden. Siehe Fehler-Log.",
    };
  }

  return { ok: true, redirectTo: data.authorize_url };
}
