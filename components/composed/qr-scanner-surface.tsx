"use client";

// <QrScannerSurface> — Story 3.5.
//
// Wraps `html5-qrcode` for the warehouse mobile scan flow. Single
// responsibility: when mounted + not paused, opens the device camera and
// fires `onDecode(payload)` for each successful QR decode. Camera permission
// errors (NotAllowedError / NotFoundError / OverconstrainedError) bubble out
// via `onError(e)` so the parent can flip the manual-entry fallback open.
//
// SSR / bundler:
//   * `html5-qrcode` reads `navigator` + `window` at module evaluation time,
//     so the import is dynamic with `ssr: false` (Next 16 cacheComponents
//     fails at build time otherwise — same pattern as the project's other
//     browser-only deps).
//
// Lifecycle discipline:
//   * On mount: create one `Html5Qrcode` instance bound to a stable element
//     id, then call `start()` with environment-facing camera + 250×250 qrbox.
//     Story-spec budget is ≤2s scan-to-result on a Pixel 6 at 4G.
//   * On `paused === true`: stop the camera (`pause(true)` keeps the
//     viewfinder dim but does not release the camera, which can stutter on
//     iOS Safari when the user dismisses the result panel back to the
//     scanner; `stop()` + restart on the next mount is more robust on the
//     phones in the warehouse hardware fleet).
//   * On unmount: best-effort `stop()` + `clear()`. Never throw from the
//     cleanup path — Next StrictMode double-mounts the effect in dev and
//     a thrown cleanup turns into a console.error wall.
//
// Logging:
//   * `onDecodeFailure` events are NOT logged — html5-qrcode fires it on
//     EVERY frame without a valid QR code. Logging would flood `error_log`
//     to ~10 rows/second on an idle camera.
//   * Camera permission denial → `logError({ severity: "info" })` exactly
//     once per mount (NOT "error" — the user denied permission, that is a
//     normal user choice rather than a system fault).

import { useEffect, useId, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";
import { logError } from "@/lib/utils/error-log";

export type QrScannerSurfaceProps = {
  onDecode: (payload: string) => void;
  onError: (error: unknown) => void;
  paused: boolean;
};

// Camera errors we recognise as "user denied / camera unavailable" rather
// than transient. The `name` field of a DOMException is the stable signal
// (the message text varies by browser locale).
const PERMISSION_ERROR_NAMES = new Set([
  "NotAllowedError",
  "NotFoundError",
  "OverconstrainedError",
  "SecurityError",
  "PermissionDeniedError",
  "TrackStartError",
]);

function isPermissionError(error: unknown): boolean {
  if (
    error != null &&
    typeof error === "object" &&
    "name" in error &&
    typeof (error as { name: unknown }).name === "string"
  ) {
    return PERMISSION_ERROR_NAMES.has((error as { name: string }).name);
  }
  return false;
}

export function QrScannerSurface({
  onDecode,
  onError,
  paused,
}: QrScannerSurfaceProps) {
  const elementId = useId();
  const safeElementId = `qr-scanner-${elementId.replace(/:/g, "-")}`;
  // Track latest callbacks in refs so the camera-start effect does not
  // tear down + restart the camera on every parent re-render. The effect
  // re-runs only when the host element id or paused flag changes.
  const onDecodeRef = useRef(onDecode);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onDecodeRef.current = onDecode;
    onErrorRef.current = onError;
  }, [onDecode, onError]);

  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    // Tracks whether `start()` finished. Cleanup must wait on this so the
    // teardown's `stop()` does not race a still-pending `start()` (a known
    // html5-qrcode failure mode that leaves the camera live across React 19
    // strict-mode double-mounts).
    let startPromise: Promise<unknown> | null = null;
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    // Pause the scanner once a successful decode has fired — html5-qrcode
    // calls onDecodeSuccess on every frame (~10/sec) until the camera moves
    // off the QR. The page only needs the first hit; subsequent fires are
    // wasted work and risk re-setting parent state during unmount.
    let decoded = false;

    (async () => {
      try {
        // Lazy-load to keep `html5-qrcode` (and its `navigator` reads) out of
        // the SSR bundle. Story 3.5 dev-note: importing statically crashes
        // the Next 16 build under cacheComponents.
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        const Html5QrcodeCtor = mod.Html5Qrcode;
        scanner = new Html5QrcodeCtor(safeElementId);
        startPromise = scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText: string) => {
            if (decoded || cancelled) return;
            const trimmed = decodedText.trim();
            if (trimmed.length === 0) return;
            decoded = true;
            scanner?.pause(true);
            onDecodeRef.current(trimmed);
          },
          // onDecodeFailure is intentionally a no-op — fires every frame
          // without a valid QR. Logging it would flood error_log.
          () => {},
        );
        await startPromise;
        if (cancelled) {
          // Component unmounted while `start()` was in flight — tear down
          // the camera the cleanup couldn't.
          await scanner.stop().catch(() => {});
          try {
            scanner.clear();
          } catch {
            /* swallow */
          }
        }
      } catch (e) {
        if (cancelled) return;
        if (isPermissionError(e)) {
          setPermissionDenied(true);
          // Best-effort log — fire-and-forget so a logging hiccup does not
          // block the manual-entry fallback from showing. `errorType: "OTHER"`
          // because the `error_log.error_type` enum (see migration 00012)
          // does not ship a dedicated `"FRONTEND"` value; the structured
          // `source: "qr-scan"` is the discriminator the ops query filters on.
          void logError(
            {
              errorType: "OTHER",
              severity: "info",
              source: "qr-scan",
              message: "camera permission denied or unavailable",
              details: {
                error_name:
                  e != null &&
                  typeof e === "object" &&
                  "name" in e &&
                  typeof (e as { name: unknown }).name === "string"
                    ? (e as { name: string }).name
                    : "unknown",
              },
            },
            createClient(),
          );
        }
        if (!cancelled) onErrorRef.current(e);
      }
    })();

    return () => {
      cancelled = true;
      const local = scanner;
      const localStart = startPromise;
      scanner = null;
      if (!local) return;
      // Wait for `start()` before calling `stop()`; if `start()` never
      // resolved (rejected, e.g. permission denied), the catch path below
      // handles teardown.
      Promise.resolve(localStart)
        .then(() => local.stop())
        .then(() => {
          try {
            local.clear();
          } catch {
            /* swallow */
          }
        })
        .catch(() => {
          try {
            local.clear();
          } catch {
            /* swallow */
          }
        });
    };
  }, [paused, safeElementId]);

  return (
    <section
      role="region"
      aria-label="QR-Scanner"
      className="flex flex-col gap-3"
    >
      {permissionDenied ? (
        <Alert variant="destructive">
          <AlertTitle>Kamerazugriff verweigert</AlertTitle>
          <AlertDescription>
            Bitte in den Browser-Einstellungen erlauben oder Seriennummer
            manuell eingeben.
          </AlertDescription>
        </Alert>
      ) : null}
      <div
        id={safeElementId}
        className="relative aspect-square w-full max-w-md self-center overflow-hidden rounded-lg border border-input bg-muted/40"
      />
    </section>
  );
}
