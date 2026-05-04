"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import { Controller, type Control, type UseFormGetValues, type UseFormSetValue } from "react-hook-form";

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
} from "@/lib/validations/customer";
import { countryValues } from "@/lib/validations/common";
import {
  geocodeAddress,
  geocodeStatusMessage,
  type GeocodeResult,
} from "@/lib/utils/geocode";
import { logError } from "@/lib/utils/error-log";
import { cn } from "@/lib/utils";

import type { CustomerFormValues } from "./customer-edit-form.types";

type Props = {
  control: Control<CustomerFormValues>;
  getValues: UseFormGetValues<CustomerFormValues>;
  setValue: UseFormSetValue<CustomerFormValues>;
  customerAddressId?: string;
  errors: Record<string, { message?: string } | undefined>;
  /**
   * P8 — notify parent so the form-level Speichern button can be disabled
   * while a geocode lookup is in flight (avoids a race where stale lat/lng
   * are persisted alongside a freshly typed address).
   */
  onGeocodingChange?: (busy: boolean) => void;
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

export function CustomerAddressFields({
  control,
  getValues,
  setValue,
  customerAddressId,
  errors,
  onGeocodingChange,
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

  // P9 (Round 3) — abort any in-flight geocode when a new one starts. Without
  // this, a stale fetch could resolve AFTER the latest one and overwrite
  // lat/lng with coordinates from the previous address.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function runGeocode() {
    const v = getValues();
    // P26 — purely client-side guard; do NOT call Google or write to error_log
    // when required fields are empty (was log-spam with INVALID_REQUEST).
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

    // P9 (Round 3) — if a newer call superseded this one, drop the result.
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
      // Reset stored geocode values; user may decide to bypass.
      setValue("lat", null, { shouldDirty: true });
      setValue("lng", null, { shouldDirty: true });
      setValue("geocoded_at", null, { shouldDirty: true });
      // P25 — German hint for the UI from the stable status code.
      const localised = geocodeStatusMessage(result.status);
      setGeoState({
        kind: "error",
        status: result.status,
        message: localised,
      });

      // P6 + AC11 — log only the stable status code; never the underlying
      // Google `error_message` (can echo address parts back).
      const supabase = createClient();
      await logError(
        {
          errorType: "EXTERNAL_API",
          severity: "warning",
          source: "customer-geocoding",
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

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
        <Controller
          name="street"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address-street" required>Strasse</Label>
              <Input
                id="address-street"
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
              <Label htmlFor="address-street-number">Hausnummer</Label>
              <Input
                id="address-street-number"
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
              <Label htmlFor="address-zip" required>PLZ</Label>
              <Input
                id="address-zip"
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
              <Label htmlFor="address-city" required>Ort</Label>
              <Input
                id="address-city"
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
              <Label htmlFor="address-country">Land</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="address-country">
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
              <Label htmlFor="address-floor">Stockwerk</Label>
              <Select
                value={field.value ?? ""}
                onValueChange={(v) => field.onChange(v || null)}
              >
                <SelectTrigger id="address-floor">
                  <SelectValue placeholder="–" />
                </SelectTrigger>
                <SelectContent>
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
              <Label htmlFor="address-elevator">Lift</Label>
              <Select
                value={field.value ?? ""}
                onValueChange={(v) => field.onChange(v || null)}
              >
                <SelectTrigger id="address-elevator">
                  <SelectValue placeholder="–" />
                </SelectTrigger>
                <SelectContent>
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
            <Label htmlFor="address-access-notes">Zugang / Hinweise</Label>
            <Textarea
              id="address-access-notes"
              {...field}
              value={field.value ?? ""}
              rows={2}
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
            <span aria-hidden className="text-destructive">*</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={runGeocode}
            disabled={geoState.kind === "loading"}
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
                  />
                  Trotzdem speichern (ohne Geokoordinaten)
                </label>
              )}
            />
          </div>
        ) : null}

      </div>
    </div>
  );
}
