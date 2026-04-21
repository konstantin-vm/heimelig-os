import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { z } from "zod";

const emailOtpTypeSchema = z.enum([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function isSafeRelativePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const rawNext = searchParams.get("next") ?? "/";

  const typeResult = emailOtpTypeSchema.safeParse(rawType);
  if (!token_hash || !typeResult.success) {
    redirect("/auth/error?error=invalid_link");
  }

  const next = isSafeRelativePath(rawNext) ? rawNext : "/";

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: typeResult.data,
    token_hash,
  });

  if (error) {
    redirect("/auth/error?error=verify_failed");
  }

  redirect(next);
}
