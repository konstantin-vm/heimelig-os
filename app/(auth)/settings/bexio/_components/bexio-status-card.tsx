"use client";

import { useState, useTransition } from "react";

import { connectBexioAction } from "../_actions/connect-bexio";
import { BexioStatusBadge, type BexioConnectionState } from "@/components/composed";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import {
  bexioHealthResponseSchema,
  type BexioHealthResponse,
} from "@/lib/validations/bexio-oauth";
import type { BexioCredentialsStatus } from "@/lib/validations/bexio-credentials";

type Status = BexioCredentialsStatus | null;

interface BexioStatusCardProps {
  status: Status;
  flash: { type: "connected" | "error"; code?: string } | null;
}

const ERROR_LABEL: Record<string, string> = {
  consent: "Zustimmung wurde abgebrochen.",
  exchange_failed: "Token-Tausch mit bexio fehlgeschlagen.",
  encrypt_failed: "Tokens konnten nicht verschlüsselt werden.",
  persist_failed: "Verbindung konnte nicht gespeichert werden.",
  state_invalid_or_expired: "OAuth-State ungültig oder abgelaufen.",
};

function statusToState(status: Status): BexioConnectionState {
  if (!status) return "disconnected";
  return status.status_label;
}

function formatSwiss(date: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  });
}

export function BexioStatusCard({ status, flash }: BexioStatusCardProps) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [healthResult, setHealthResult] = useState<BexioHealthResponse | null>(
    null,
  );
  const [healthPending, setHealthPending] = useState(false);

  const state = statusToState(status);
  const env = status?.environment ?? "trial";

  function onConnect(targetEnv: "trial" | "production") {
    setActionError(null);
    startTransition(async () => {
      const result = await connectBexioAction({ env: targetEnv });
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      window.location.assign(result.redirectTo);
    });
  }

  async function onHealthCheck() {
    setHealthResult(null);
    setHealthPending(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("bexio-health", {
        method: "POST",
      });
      if (error) {
        setHealthResult({
          ok: false,
          code: "invoke_failed",
          message: error.message,
        });
        return;
      }
      const parsed = bexioHealthResponseSchema.safeParse(data);
      if (!parsed.success) {
        setHealthResult({
          ok: false,
          code: "invalid_response",
          message: "Antwort konnte nicht ausgewertet werden.",
        });
        return;
      }
      setHealthResult(parsed.data);
    } finally {
      setHealthPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {flash?.type === "connected" ? (
        <Alert>
          <AlertDescription>
            bexio wurde erfolgreich verbunden.
          </AlertDescription>
        </Alert>
      ) : null}
      {flash?.type === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>
            {flash.code && ERROR_LABEL[flash.code]
              ? ERROR_LABEL[flash.code]
              : "Verbindung fehlgeschlagen. Details im Fehler-Log."}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>bexio-Verbindung</CardTitle>
          <BexioStatusBadge state={state} />
        </CardHeader>
        <CardContent className="space-y-4">
          {status ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Field label="Mandant" value={status.bexio_company_id ?? "—"} />
              <Field
                label="Umgebung"
                value={status.environment === "production" ? "Produktiv" : "Trial"}
              />
              <Field label="Läuft ab" value={formatSwiss(status.expires_at)} />
              <Field
                label="Letzter Refresh"
                value={formatSwiss(status.last_refreshed_at)}
              />
              <Field label="Refresh-Zähler" value={String(status.refresh_count)} />
              <Field label="Scopes" value={status.scope ?? "—"} className="sm:col-span-2" />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Noch keine bexio-Verbindung. Klicke auf <em>Verbinden</em>, um den
              OAuth-Flow zu starten.
            </p>
          )}

          {actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {status ? (
              <Button
                variant="default"
                disabled={pending}
                onClick={() => onConnect(env)}
              >
                {pending ? "Wird gestartet…" : "Neu verbinden"}
              </Button>
            ) : (
              <>
                <Button
                  variant="default"
                  disabled={pending}
                  onClick={() => onConnect("trial")}
                >
                  {pending ? "Wird gestartet…" : "Verbinden (Trial)"}
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => onConnect("production")}
                >
                  Verbinden (Produktiv)
                </Button>
              </>
            )}
            <Button
              variant="outline"
              disabled={!status || healthPending}
              onClick={onHealthCheck}
            >
              {healthPending ? "Prüfe…" : "Verbindung testen"}
            </Button>
          </div>

          {healthResult ? (
            <Alert variant={healthResult.ok ? "default" : "destructive"}>
              <AlertDescription>
                {healthResult.ok
                  ? `OK · ${healthResult.environment} · ${healthResult.latency_ms} ms`
                  : `${healthResult.code}: ${healthResult.message}`}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
