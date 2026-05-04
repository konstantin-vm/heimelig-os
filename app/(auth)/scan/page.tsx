"use client";

// Story 3.5 — warehouse mobile QR scan page (S-038).
//
// Single-page client component:
//   * Camera surface (Html5Qrcode) on first render.
//   * On decode (or on manual-entry submit), set the payload and switch to
//     the result panel. The result panel internally calls
//     `useDeviceByQrPayload` and renders loading / not-found / found.
//   * Manual-entry fallback is always visible (D-MANUAL 2026-05-04). The
//     toggle auto-flips to expanded if the camera surface reports a
//     permission error — so a worker who denied camera access does not need
//     to look for the toggle.
//
// Roles: admin / office / warehouse (technician's in-stop scanner is the
// Epic-8 / Story 8.4 surface, NOT this page). The route gate lives in
// `lib/constants/roles.ts` ROLE_ALLOWED_PATHS — proxy.ts redirects technician
// hits on `/scan` to their landing path before this component renders.

import { useState } from "react";

import { PageShell } from "@/components/composed/page-shell";
import { QrScannerSurface } from "@/components/composed/qr-scanner-surface";
import { ScanResultPanel } from "@/components/composed/scan-result-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MANUAL_INPUT_MAX_LEN = 256;

export default function ScanPage() {
  // Single source of truth — fed by either the camera surface OR the
  // manual-entry submit. The result panel gates rendering on truthiness.
  const [payload, setPayload] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [showManual, setShowManual] = useState(false);

  function handleManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // No `.toUpperCase()` — the QR-payload contract is owned by
    // `lib/qr-labels/encode.ts` (Story 3.7) and is case-sensitive by design.
    // Uppercasing here would mangle a future Q5 lowercase format
    // (`autoCapitalize="characters"` on the input still nudges casing for
    // mobile keyboards while letting paste / soft-keyboard edits keep their
    // original casing).
    const next = manualInput.trim();
    if (next.length === 0) return;
    setPayload(next);
  }

  function handleClear() {
    setPayload(null);
    setManualInput("");
  }

  return (
    <PageShell title="Scannen">
      <div className="flex flex-col gap-4">
        {payload === null ? (
          <>
            <QrScannerSurface
              onDecode={(p) => setPayload(p.trim())}
              onError={() => setShowManual(true)}
              paused={false}
            />
            <button
              type="button"
              className="mx-auto text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              onClick={() => setShowManual((v) => !v)}
              aria-expanded={showManual}
              aria-controls="manual-entry-form"
            >
              {showManual
                ? "Manuelle Eingabe schliessen"
                : "Seriennummer manuell eingeben"}
            </button>
            {showManual ? (
              <form
                id="manual-entry-form"
                className="flex flex-col gap-2"
                onSubmit={handleManualSubmit}
              >
                <Label htmlFor="manual-serial">Seriennummer</Label>
                <Input
                  id="manual-serial"
                  value={manualInput}
                  onChange={(e) =>
                    setManualInput(e.target.value.slice(0, MANUAL_INPUT_MAX_LEN))
                  }
                  placeholder="z. B. PB1M-0526-00001"
                  inputMode="text"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="min-h-11 font-mono"
                />
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={manualInput.trim().length === 0}
                >
                  Suchen
                </Button>
              </form>
            ) : null}
          </>
        ) : (
          <ScanResultPanel payload={payload} onClear={handleClear} />
        )}
      </div>
    </PageShell>
  );
}
