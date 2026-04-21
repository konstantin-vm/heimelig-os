import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Suspense } from "react";

const knownErrors = {
  invalid_link: "Der Bestätigungslink ist ungültig oder abgelaufen.",
  verify_failed: "Die Bestätigung ist fehlgeschlagen. Bitte versuche es erneut.",
  session_expired: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
  no_role_assigned:
    "Dir wurde keine Rolle zugewiesen. Bitte kontaktiere einen Administrator.",
} as const;

type KnownErrorKey = keyof typeof knownErrors;

function isKnownError(value: string | undefined): value is KnownErrorKey {
  return !!value && value in knownErrors;
}

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const message = isKnownError(params?.error)
    ? knownErrors[params.error]
    : "Es ist ein unbekannter Fehler aufgetreten.";

  return <p className="text-sm text-muted-foreground">{message}</p>;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                Entschuldigung, etwas ist schiefgelaufen.
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Suspense>
                <ErrorContent searchParams={searchParams} />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
