// ---------------------------------------------------------------------------
// Browser-side Google Maps Geocoding helper.
//
// nDSG / Story 2.1 AC10 — PII boundary:
//   The address is sent **directly** Browser → Google Maps Geocoding API.
//   It must NEVER pass through a Vercel route handler (Frankfurt). This file
//   is `"use client"`-only — never import from a server component or route
//   handler. The Maps key is `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and is
//   referrer-restricted + Geocoding-API-restricted at the Google Cloud
//   project level (see docs/internal/google-maps-key-setup.md).
// ---------------------------------------------------------------------------

export type GeocodeInput = {
  street: string;
  streetNumber?: string | null;
  zip: string;
  city: string;
  country?: string; // ISO-3166-1 alpha-2; defaults to CH
};

export type GeocodeSuccess = {
  ok: true;
  lat: number;
  lng: number;
  formattedAddress: string;
  geocodedAt: string; // ISO timestamptz
};

export type GeocodeFailure = {
  ok: false;
  status: GoogleGeocodeStatus;
  message: string;
};

export type GeocodeResult = GeocodeSuccess | GeocodeFailure;

type GoogleGeocodeStatus =
  | "OK"
  | "ZERO_RESULTS"
  | "OVER_QUERY_LIMIT"
  | "REQUEST_DENIED"
  | "INVALID_REQUEST"
  | "UNKNOWN_ERROR"
  | "NETWORK_ERROR"
  // P15 (Round 3) — distinct from REQUEST_DENIED (which is Google's response
  // for an invalid/restricted/unauthorised key). NOT_CONFIGURED means the
  // env var is empty: the call never left the browser. Lets on-call tell
  // unconfigured-key from key-rejected without rummaging through Vercel env.
  | "NOT_CONFIGURED"
  | "ABORTED";

type GoogleGeocodeResponse = {
  status: GoogleGeocodeStatus;
  error_message?: string;
  results?: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
};

const ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

// AC11 + Code-review P25 — German status mapping. Google's `error_message`
// can echo address parts (PII) back, so we never surface it to the user or
// to error_log.message. Caller persists only `status` to error_log; this
// helper produces a localised hint string for the UI.
const STATUS_LABEL_DE: Record<GoogleGeocodeStatus, string> = {
  OK: "Adresse erfolgreich validiert.",
  ZERO_RESULTS: "Adresse konnte nicht gefunden werden.",
  OVER_QUERY_LIMIT:
    "Geocoding-Kontingent überschritten. Bitte später erneut versuchen.",
  REQUEST_DENIED:
    "Geocoding wurde abgelehnt. Bitte API-Key-Konfiguration prüfen.",
  INVALID_REQUEST:
    "Geocoding-Anfrage ungültig. Bitte Strasse / PLZ / Ort prüfen.",
  UNKNOWN_ERROR:
    "Geocoding ist temporär nicht verfügbar. Bitte erneut versuchen.",
  NETWORK_ERROR: "Netzwerkfehler beim Geocoding.",
  NOT_CONFIGURED:
    "Geocoding ist nicht konfiguriert. Bitte Administrator informieren.",
  ABORTED: "Geocoding-Anfrage abgebrochen.",
};

export function geocodeStatusMessage(status: GoogleGeocodeStatus): string {
  return STATUS_LABEL_DE[status] ?? "Geocoding fehlgeschlagen.";
}

export async function geocodeAddress(
  input: GeocodeInput,
  signal?: AbortSignal,
): Promise<GeocodeResult> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    // P15 (Round 3) — distinct from Google's REQUEST_DENIED.
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      message: geocodeStatusMessage("NOT_CONFIGURED"),
    };
  }

  const country = (input.country ?? "CH").toLowerCase();
  const street = [input.street, input.streetNumber ?? ""].join(" ").trim();
  const address = `${street}, ${input.zip} ${input.city}`;

  const url = new URL(ENDPOINT);
  url.searchParams.set("address", address);
  url.searchParams.set("region", country);
  url.searchParams.set("components", `country:${country.toUpperCase()}`);
  url.searchParams.set("key", key);

  let response: Response;
  try {
    response = await fetch(url.toString(), { method: "GET", signal });
  } catch (err) {
    // P9 (Round 3) — surface aborts distinctly so callers can suppress UI
    // updates from a superseded fetch.
    if (
      err instanceof DOMException &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      return {
        ok: false,
        status: "ABORTED",
        message: geocodeStatusMessage("ABORTED"),
      };
    }
    // P6 — never include the underlying error message; it can leak the URL
    // (with the address) into error_log.message via the caller.
    return {
      ok: false,
      status: "NETWORK_ERROR",
      message: geocodeStatusMessage("NETWORK_ERROR"),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: "UNKNOWN_ERROR",
      message: geocodeStatusMessage("UNKNOWN_ERROR"),
    };
  }

  let body: GoogleGeocodeResponse;
  try {
    body = (await response.json()) as GoogleGeocodeResponse;
  } catch {
    return {
      ok: false,
      status: "UNKNOWN_ERROR",
      message: geocodeStatusMessage("UNKNOWN_ERROR"),
    };
  }

  if (body.status !== "OK" || !body.results || body.results.length === 0) {
    // P6 — `body.error_message` from Google may echo the address back; drop it
    // and surface only the stable status code → German hint.
    return {
      ok: false,
      status: body.status,
      message: geocodeStatusMessage(body.status),
    };
  }

  const top = body.results[0];
  if (!top) {
    return {
      ok: false,
      status: "ZERO_RESULTS",
      message: geocodeStatusMessage("ZERO_RESULTS"),
    };
  }
  return {
    ok: true,
    lat: Number(top.geometry.location.lat.toFixed(6)),
    lng: Number(top.geometry.location.lng.toFixed(6)),
    formattedAddress: top.formatted_address,
    geocodedAt: new Date().toISOString(),
  };
}
