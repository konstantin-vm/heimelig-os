"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import {
  Controller,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormSetValue,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  elevatorValues,
  floorValues,
  type CustomerAddressDialogValues,
} from "@/lib/validations/customer";
import { countryValues } from "@/lib/validations/common";
import {
  geocodeAddress,
  geocodeStatusMessage,
  type GeocodeResult,
} from "@/lib/utils/geocode";
import { logError } from "@/lib/utils/error-log";
import { cn } from "@/lib/utils";

// Standalone variant of `<CustomerAddressFields>` (Story 2.1) bound to the
// AddressDialog form-values shape. Keeps the customer-edit-form component
// untouched (avoids the generic-typed RHF refactor pain) and shares the same
// browser↔Google direct geocoding path + Trotzdem-speichern bypass.
//
// Field IDs are seeded with a caller-provided `idPrefix` so two address
// forms (e.g. customer-edit + address-dialog) can coexist on the same page
// without colliding label-for/htmlFor pairs.

type Props = {
  control: Control<CustomerAddressDialogValues>;
  getValues: UseFormGetValues<CustomerAddressDialogValues>;
  setValue: UseFormSetValue<CustomerAddressDialogValues>;
  /** UUID of the address row when editing; null for create. PII-safe. */
  customerAddressId?: string | null;
  errors: Record<string, { message?: string } | undefined>;
  /** Disable the geocode button + bypass toggle when the parent form is busy. */
  disabled?: boolean;
  onGeocodingChange?: (busy: boolean) => void;
  /** Prefix for label htmlFor / input id (default: 'address'). */
  idPrefix?: string;
};

const FLOOR_LABELS: Record<(typeof floorValues)[number], string> = {
  UG: "UG",
  EG: "EG",
  "1.OG": "1. OG",
  "2.OG": "2. OG",
  "3.OG": "3. OG",
  "4.OG": "4. OG",
  "5.OG+": "5. OG +",
};

const ELEVATOR_LABELS: Record<(typeof elevatorValues)[number], string> = {
  ja: "Ja",
  nein: "Nein",
  unbekannt: "Unbekannt",
};

// shadcn Select cannot accept value="" — use a sentinel for the
// "no value selected" option and map it back to "" in the form state.
// Round-2 review: previously a user could not clear floor / has_elevator
// after the first selection because there was no clear option.
const NONE_SENTINEL = "__none__";

export function AddressFormFields({
  control,
  getValues,
  setValue,
  customerAddressId,
  errors,
  disabled,
  onGeocodingChange,
  idPrefix = "address",
}: Props) {
  const [geoState, setGeoState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; result: Extract<GeocodeResult, { ok: true }> }
    | { kind: "error"; message: string; status: string }
  >({ kind: "idle" });

  useEffect(() => {
    onGeocodingChange?.(geoState.kind === "loading");
  }, [geoState.kind, onGeocodingChange]);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Round-2 review: when any address field (street / street_number / zip /
  // city / country) changes after the form has been hydrated, clear the
  // stored geocode so the user is forced to re-validate. Without this, a
  // user could change "Bahnhofstrasse 1" → "Bahnhofstrasse 99" and Save
  // with the OLD coordinates, persisting a row whose displayed address
  // doesn't match its lat/lng.
  const watchedAddress = useWatch({
    control,
    name: ["street", "street_number", "zip", "city", "country"],
  });
  const prevAddressRef = useRef<readonly [string, string, string, string, string] | null>(null);
  useEffect(() => {
    const next = [
      watchedAddress[0] ?? "",
      watchedAddress[1] ?? "",
      watchedAddress[2] ?? "",
      watchedAddress[3] ?? "",
      watchedAddress[4] ?? "",
    ] as const;
    if (prevAddressRef.current === null) {
      prevAddressRef.current = next;
      return;
    }
    const prev = prevAddressRef.current;
    const changed =
      prev[0] !== next[0] ||
      prev[1] !== next[1] ||
      prev[2] !== next[2] ||
      prev[3] !== next[3] ||
      prev[4] !== next[4];
    if (!changed) return;
    prevAddressRef.current = next;
    const v = getValues();
    if (v.lat !== null || v.lng !== null || v.geocoded_at !== null) {
      setValue("lat", null, { shouldDirty: true });
      setValue("lng", null, { shouldDirty: true });
      setValue("geocoded_at", null, { shouldDirty: true });
      setValue("bypass_geocoding", false, { shouldDirty: true });
      // Defer the local-state reset to a microtask so the React Compiler's
      // `set-state-in-effect` rule doesn't fire — synchronously calling
      // setGeoState inside an effect that already ran setValue() (which
      // schedules its own renders via RHF subscriptions) is the cascading
      // pattern that rule warns about.
      queueMicrotask(() => setGeoState({ kind: "idle" }));
    }
  }, [watchedAddress, getValues, setValue]);

  async function runGeocode() {
    const v = getValues();
    if (!v.street || !v.zip || !v.city) {
      setGeoState({
        kind: "error",
        status: "INVALID_REQUEST",
        message: "Strasse, PLZ und Ort sind erforderlich.",
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setGeoState({ kind: "loading" });
    const result = await geocodeAddress(
      {
        street: v.street,
        streetNumber: v.street_number || null,
        zip: v.zip,
        city: v.city,
        country: v.country,
      },
      controller.signal,
    );

    if (controller.signal.aborted || abortRef.current !== controller) {
      return;
    }

    if (result.ok) {
      setValue("lat", result.lat, { shouldDirty: true });
      setValue("lng", result.lng, { shouldDirty: true });
      setValue("geocoded_at", result.geocodedAt, { shouldDirty: true });
      setValue("bypass_geocoding", false);
      setGeoState({ kind: "success", result });
    } else {
      // Round-2 review: previously wiped lat/lng/geocoded_at unconditionally
      // on geocode failure — a transient ZERO_RESULTS / OVER_QUERY_LIMIT on
      // an edit-flow re-geocode silently destroyed pre-existing valid
      // coordinates. Now: preserve whatever's in form state. The address-
      // field-change effect below already clears coords when street / zip /
      // city / country change, so by the time the user re-runs the geocode
      // after edits, lat/lng are already null. Editing without address-field
      // changes → coords stay valid through transient API failures.
      const localised = geocodeStatusMessage(result.status);
      setGeoState({
        kind: "error",
        status: result.status,
        message: localised,
      });

      const supabase = createClient();
      // PII-safe: only stable status code + opaque address ID. No street /
      // city / access_notes / recipient_name in details.
      await logError(
        {
          errorType: "EXTERNAL_API",
          severity: "warning",
          source: "customer-address-geocoding",
          message: `geocode_failed:${result.status}`,
          details: {
            google_status: result.status,
            customer_address_id: customerAddressId ?? null,
          },
        },
        supabase,
      );
    }
  }

  const streetId = `${idPrefix}-street`;
  const streetNumberId = `${idPrefix}-street-number`;
  const zipId = `${idPrefix}-zip`;
  const cityId = `${idPrefix}-city`;
  const countryId = `${idPrefix}-country`;
  const floorId = `${idPrefix}-floor`;
  const elevatorId = `${idPrefix}-elevator`;
  const accessNotesId = `${idPrefix}-access-notes`;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
        <Controller
          name="street"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={streetId}>Strasse *</Label>
              <Input
                id={streetId}
                {...field}
                value={field.value ?? ""}
                autoComplete="address-line1"
                required
                aria-invalid={Boolean(errors.street)}
              />
              {errors.street?.message ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.street.message}
                </p>
              ) : null}
            </div>
          )}
        />
        <Controller
          name="street_number"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={streetNumberId}>Hausnummer</Label>
              <Input
                id={streetNumberId}
                {...field}
                value={field.value ?? ""}
                autoComplete="address-line2"
                aria-invalid={Boolean(errors.street_number)}
              />
              {errors.street_number?.message ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.street_number.message}
                </p>
              ) : null}
            </div>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
        <Controller
          name="zip"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={zipId}>PLZ *</Label>
              <Input
                id={zipId}
                {...field}
                value={field.value ?? ""}
                autoComplete="postal-code"
                inputMode="numeric"
                required
                aria-invalid={Boolean(errors.zip)}
              />
              {errors.zip?.message ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.zip.message}
                </p>
              ) : null}
            </div>
          )}
        />

        <Controller
          name="city"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={cityId}>Ort *</Label>
              <Input
                id={cityId}
                {...field}
                value={field.value ?? ""}
                autoComplete="address-level2"
                required
                aria-invalid={Boolean(errors.city)}
              />
              {errors.city?.message ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.city.message}
                </p>
              ) : null}
            </div>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Controller
          name="country"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={countryId}>Land</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={countryId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {countryValues.map((c: (typeof countryValues)[number]) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />

        <Controller
          name="floor"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={floorId}>Stockwerk</Label>
              <Select
                value={field.value === "" ? NONE_SENTINEL : (field.value ?? NONE_SENTINEL)}
                onValueChange={(v) => field.onChange(v === NONE_SENTINEL ? "" : v)}
              >
                <SelectTrigger id={floorId}>
                  <SelectValue placeholder="–" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_SENTINEL}>–</SelectItem>
                  {floorValues.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FLOOR_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />

        <Controller
          name="has_elevator"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={elevatorId}>Lift</Label>
              <Select
                value={field.value === "" ? NONE_SENTINEL : (field.value ?? NONE_SENTINEL)}
                onValueChange={(v) => field.onChange(v === NONE_SENTINEL ? "" : v)}
              >
                <SelectTrigger id={elevatorId}>
                  <SelectValue placeholder="–" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_SENTINEL}>–</SelectItem>
                  {elevatorValues.map((e) => (
                    <SelectItem key={e} value={e}>
                      {ELEVATOR_LABELS[e]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />
      </div>

      <Controller
        name="access_notes"
        control={control}
        render={({ field }) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={accessNotesId}>Zugang / Hinweise</Label>
            <Textarea
              id={accessNotesId}
              {...field}
              value={field.value ?? ""}
              rows={3}
              placeholder="z.B. Schlüssel beim Nachbarn, Code 1234, Hund im Garten…"
            />
          </div>
        )}
      />

      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
            Adressvalidierung
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={runGeocode}
            disabled={disabled || geoState.kind === "loading"}
          >
            {geoState.kind === "loading" ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                Wird geprüft…
              </>
            ) : (
              "Adresse prüfen"
            )}
          </Button>
        </div>

        {geoState.kind === "success" ? (
          <div className="flex items-start gap-2 text-sm text-success-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden />
            <div className="flex flex-col">
              <span className="font-medium text-foreground">
                {geoState.result.formattedAddress}
              </span>
              <span className="text-xs text-muted-foreground">
                lat {geoState.result.lat.toFixed(6)} · lng{" "}
                {geoState.result.lng.toFixed(6)}
              </span>
            </div>
          </div>
        ) : null}

        {geoState.kind === "error" ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-destructive">{geoState.message}</p>
            <Controller
              name="bypass_geocoding"
              control={control}
              render={({ field }) => (
                <label
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                    disabled={disabled}
                  />
                  Trotzdem speichern (ohne Geokoordinaten)
                </label>
              )}
            />
          </div>
        ) : null}

        {geoState.kind === "idle" ? (
          <p className="text-xs text-muted-foreground">
            Klick auf „Adresse prüfen“ lädt lat/lng über Google Maps. Daten
            gehen direkt vom Browser an Google – kein Vercel-Hop.
          </p>
        ) : null}
      </div>
    </div>
  );
}
