"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getSessionRole, landingPathFor } from "@/lib/supabase/session";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

function germanAuthError(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  if (/invalid login credentials/i.test(message)) {
    return "E-Mail oder Passwort falsch.";
  }
  if (/email not confirmed/i.test(message)) {
    return "E-Mail-Adresse ist noch nicht bestätigt. Bitte kontaktiere einen Administrator.";
  }
  if (/too many requests|rate limit/i.test(message)) {
    return "Zu viele Anmeldeversuche. Bitte warte kurz und versuche es erneut.";
  }
  return "Anmeldung fehlgeschlagen. Bitte versuche es erneut.";
}

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: "onChange",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: LoginInput) => {
    setSubmitError(null);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setSubmitError(germanAuthError(error));
      return;
    }

    const { data: claimsData } = await supabase.auth.getClaims();
    const role = getSessionRole(claimsData?.claims);

    if (role === null) {
      await supabase.auth.signOut();
      router.replace("/auth/error?error=no_role_assigned");
      router.refresh();
      return;
    }

    router.replace(landingPathFor(role));
    router.refresh();
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Anmeldung</CardTitle>
          <CardDescription>
            Melde dich mit deiner E-Mail-Adresse an.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email" required>E-Mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@beispiel.ch"
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email) || undefined}
                  {...register("email")}
                />
                {errors.email?.message && (
                  <p className="text-sm text-destructive">{errors.email.message}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password" required>Passwort</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Passwort eingeben"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password) || undefined}
                  {...register("password")}
                />
                {errors.password?.message && (
                  <p className="text-sm text-destructive">
                    {errors.password.message}
                  </p>
                )}
              </div>
              {submitError && (
                <p className="text-sm text-destructive" role="alert">
                  {submitError}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting || !isValid}
              >
                {isSubmitting ? "Anmelden…" : "Anmelden"}
              </Button>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Passwort zurücksetzen? Admin kontaktieren.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
