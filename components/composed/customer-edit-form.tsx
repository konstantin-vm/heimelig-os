"use client";

import { useEffect, useRef, useState } from "react";
import {
  Controller,
  useForm,
  type FieldPath,
  type SubmitHandler,
} from "react-hook-form";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  customerCreateSchema,
  customerAddressUserInputSchema,
  customerTypeValues,
  salutationValues,
  SALUTATION_LABELS,
  acquisitionChannelValues,
} from "@/lib/validations/customer";
import { languageValues } from "@/lib/validations/common";
import {
  useCreateCustomer,
  useCustomer,
  useSyncCustomerToBexio,
  useUpdateCustomer,
  type CustomerAddressPayload,
} from "@/lib/queries/customers";
import type { CustomerCreate } from "@/lib/validations/customer";
import { cn } from "@/lib/utils";

import { CustomerAddressFields } from "./customer-address-fields";
import type {
  CustomerFormMode,
  CustomerFormValues,
} from "./customer-edit-form.types";

// Maps Zod-issue paths back onto react-hook-form field names. Some Zod
// paths refer to derived fields (e.g. customer_type refine, refer's to
// customer_type) that the form cannot focus directly; in that case we
// attach the message to a sensible inline location instead of just toast.
function mapZodPathToField(
  path: ReadonlyArray<PropertyKey>,
): FieldPath<CustomerFormValues> | null {
  const head = path[0];
  if (typeof head !== "string") return null;
  switch (head) {
    case "customer_number":
    case "customer_type":
      // customer_number cannot be entered; customer_type errors usually mean
      // the matching name field is missing — surface there.
      return null;
    case "first_name":
    case "last_name":
    case "company_name":
    case "addressee_line":
    case "salutation":
    case "title":
    case "email":
    case "phone":
    case "mobile":
    case "date_of_birth":
    case "height_cm":
    case "weight_kg":
    case "language":
    case "marketing_consent":
    case "acquisition_channel":
    case "notes":
    case "iv_marker":
    case "iv_dossier_number":
    case "street":
    case "street_number":
    case "zip":
    case "city":
    case "country":
    case "floor":
    case "has_elevator":
    case "access_notes":
      return head;
    default:
      return null;
  }
}

function parseFiniteNumber(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

const LANGUAGE_LABELS: Record<(typeof languageValues)[number], string> = {
  de: "Deutsch",
  fr: "Französisch",
  it: "Italienisch",
  en: "Englisch",
};

const ACQUISITION_LABELS: Record<
  (typeof acquisitionChannelValues)[number],
  string
> = {
  spitex: "Spitex",
  sozialdienst_spital: "Sozialdienst Spital",
  google: "Google",
  ki: "KI / Chatbot",
  empfehlung: "Empfehlung",
  wiederholer: "Wiederholungskunde",
  arzt_therapeut: "Arzt / Therapeut",
  shopify: "Shopify",
  sonstige: "Sonstige",
};

const EMPTY_DEFAULTS: CustomerFormValues = {
  customer_type: "private",
  salutation: null,
  title: "",
  first_name: "",
  last_name: "",
  company_name: "",
  addressee_line: "",
  email: "",
  phone: "",
  mobile: "",
  date_of_birth: "",
  height_cm: "",
  weight_kg: "",
  language: "de",
  marketing_consent: false,
  acquisition_channel: "",
  notes: "",

  iv_marker: false,
  iv_dossier_number: "",

  street: "",
  street_number: "",
  zip: "",
  city: "",
  country: "CH",
  floor: null,
  has_elevator: null,
  access_notes: "",
  lat: null,
  lng: null,
  geocoded_at: null,
  bypass_geocoding: false,
};

export type CustomerEditFormProps = {
  mode: CustomerFormMode;
  customerId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const BEXIO_RETRIGGER_FIELDS = [
  "first_name",
  "last_name",
  "company_name",
  "email",
] as const;

// Address columns relevant for the bexio postal address. Mirrors what bexio
// itself stores; floor / has_elevator / access_notes do not roundtrip.
const BEXIO_ADDRESS_FIELDS = [
  "street",
  "street_number",
  "zip",
  "city",
  "country",
] as const;

function nullIfEmpty(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

export function CustomerEditForm({
  mode,
  customerId,
  open,
  onOpenChange,
}: CustomerEditFormProps) {
  const isEdit = mode === "edit";
  const {
    data: existing,
    isLoading: isLoadingExisting,
    isError: isErrorExisting,
  } = useCustomer(isEdit ? customerId ?? null : null);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    getValues,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting, isDirty, dirtyFields },
  } = useForm<CustomerFormValues>({
    defaultValues: EMPTY_DEFAULTS,
    mode: "onTouched",
  });

  // P4 — gate the address-change-effect on a hydrated flag. Without this,
  // edit-mode hydration triggers the effect (street goes from "" → existing)
  // and wipes persisted lat/lng/geocoded_at on every dialog open.
  const hydratedRef = useRef(false);
  // P14 — track previous customer_type so the toggle effect skips its first
  // mount and doesn't dirty the form for a no-change open.
  const prevTypeRef = useRef<string | null>(null);
  // Story 2.1.1 — same first-mount-skip pattern for the IV-marker watcher.
  const prevIvMarkerRef = useRef<boolean | null>(null);

  // Hydrate values when editing. The parent passes `key={customerId ?? "create"}`
  // so a customer switch remounts this form — the effect therefore only needs
  // to handle the mode-create / first-edit-load case, not customer-id flips.
  useEffect(() => {
    if (!open) {
      hydratedRef.current = false;
      prevTypeRef.current = null;
      prevIvMarkerRef.current = null;
      return;
    }
    if (mode === "create") {
      reset(EMPTY_DEFAULTS);
      prevTypeRef.current = EMPTY_DEFAULTS.customer_type;
      hydratedRef.current = true;
      return;
    }
    if (!existing) return;
    const a = existing.primary_address;
    reset({
      customer_type: existing.customer_type,
      salutation: existing.salutation,
      title: existing.title ?? "",
      first_name: existing.first_name ?? "",
      last_name: existing.last_name ?? "",
      company_name: existing.company_name ?? "",
      addressee_line: existing.addressee_line ?? "",
      email: existing.email ?? "",
      phone: existing.phone ?? "",
      mobile: existing.mobile ?? "",
      date_of_birth: existing.date_of_birth ?? "",
      height_cm: existing.height_cm == null ? "" : String(existing.height_cm),
      weight_kg: existing.weight_kg == null ? "" : String(existing.weight_kg),
      language: existing.language,
      marketing_consent: existing.marketing_consent,
      acquisition_channel: existing.acquisition_channel ?? "",
      notes: existing.notes ?? "",

      iv_marker: existing.iv_marker ?? false,
      iv_dossier_number: existing.iv_dossier_number ?? "",

      street: a?.street ?? "",
      street_number: a?.street_number ?? "",
      zip: a?.zip ?? "",
      city: a?.city ?? "",
      country: a?.country ?? "CH",
      floor: a?.floor ?? null,
      has_elevator: a?.has_elevator ?? null,
      access_notes: a?.access_notes ?? "",
      lat: a?.lat ?? null,
      lng: a?.lng ?? null,
      geocoded_at: a?.geocoded_at ?? null,
      bypass_geocoding: false,
    });
    prevTypeRef.current = existing.customer_type;
    hydratedRef.current = true;
    // Intentionally NOT depending on `existing` reference to avoid clobbering
    // user edits on background refetch — only the first non-null `existing`
    // (and `open`/`mode` transitions) hydrates the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, open, existing?.id]);

  const customerType = watch("customer_type");
  const isPrivate = customerType === "private";

  // Story 2.1.1 — when IV-Marker flips on→off, clear the dossier-number input
  // so a flip-on/off/on-roundtrip never carries a stale value. Mirror of the
  // customer-type-toggle pattern: skip on first run after hydration so a
  // no-change open does not dirty the form. shouldDirty:true on a real
  // transition makes dirtyFields track the dossier clear so the update RPC
  // actually transmits it.
  const watchedIvMarker = watch("iv_marker");
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (prevIvMarkerRef.current === null) {
      prevIvMarkerRef.current = watchedIvMarker;
      return;
    }
    if (prevIvMarkerRef.current === watchedIvMarker) return;
    prevIvMarkerRef.current = watchedIvMarker;
    if (!watchedIvMarker) {
      setValue("iv_dossier_number", "", { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedIvMarker]);

  // P14 — customer-type toggle clears the hidden branch's name fields so a
  // back-and-forth toggle never carries stale values into the submit payload.
  // Skip on first run after hydration (prevTypeRef === customerType) so we
  // don't dirty the form for a no-change open. Use shouldDirty:false so the
  // user-pressed toggle alone — without other edits — doesn't enable Save.
  useEffect(() => {
    if (prevTypeRef.current === null) return;
    if (prevTypeRef.current === customerType) return;
    prevTypeRef.current = customerType;
    if (isPrivate) {
      setValue("company_name", "", { shouldDirty: false });
      setValue("addressee_line", "", { shouldDirty: false });
    } else {
      setValue("first_name", "", { shouldDirty: false });
      setValue("last_name", "", { shouldDirty: false });
      setValue("height_cm", "", { shouldDirty: false });
      setValue("weight_kg", "", { shouldDirty: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrivate, customerType]);

  // P8 — invalidate lat/lng/geocoded_at whenever a postal-relevant address
  // field changes after a successful geocode, so we never persist coordinates
  // that point at the previous building. P4 — gated on hydratedRef so the
  // initial reset() during edit-mode hydration does NOT trigger this and
  // wipe persisted coordinates. P12 — `bypass_geocoding` is no longer
  // auto-cleared here; once the user opts into "Trotzdem speichern", every
  // keystroke would otherwise reset the flag and deadlock the submit.
  const watchedStreet = watch("street");
  const watchedStreetNo = watch("street_number");
  const watchedZip = watch("zip");
  const watchedCity = watch("city");
  const watchedCountry = watch("country");
  useEffect(() => {
    if (!hydratedRef.current) return;
    const v = getValues();
    if (v.lat !== null || v.lng !== null || v.geocoded_at !== null) {
      setValue("lat", null, { shouldDirty: true });
      setValue("lng", null, { shouldDirty: true });
      setValue("geocoded_at", null, { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedStreet, watchedStreetNo, watchedZip, watchedCity, watchedCountry]);

  // Story 2.6 — fire-and-forget bexio sync after a successful create or
  // bexio-relevant update. The mutation's own onSuccess/onError shows the
  // bexio result toast separately. Customer is saved either way; bexio
  // sync is best-effort + non-blocking.
  const bexioSyncMutation = useSyncCustomerToBexio();
  const triggerBexioSync = (customerId: string) => {
    bexioSyncMutation.mutate(customerId, {
      onSuccess: (result) => {
        if (result.ok) {
          toast.success("Mit bexio synchronisiert");
        } else {
          toast.error(
            result.message ||
              "bexio-Synchronisation fehlgeschlagen — siehe Fehlerprotokoll",
          );
        }
      },
      onError: () => {
        toast.error(
          "bexio-Synchronisation fehlgeschlagen — siehe Fehlerprotokoll",
        );
      },
    });
  };

  const createMutation = useCreateCustomer({
    onSuccess: (newCustomerId) => {
      toast.success("Kunde wurde angelegt.");
      onOpenChange(false);
      // Fire bexio sync immediately so the user lands on the profile with
      // a Synced (or Failed) state instead of staring at Pending. Realtime
      // pickup keeps the card fresh either way.
      triggerBexioSync(newCustomerId);
    },
    onError: (err) => {
      toast.error("Anlegen fehlgeschlagen", { description: err.message });
    },
  });

  const updateMutation = useUpdateCustomer({
    onSuccess: (updatedId, variables) => {
      toast.success("Änderungen gespeichert.");
      onOpenChange(false);
      // Only sync when a bexio-relevant field actually changed (per the
      // existing BEXIO_RETRIGGER_FIELDS computation upstream).
      if (variables.bexioRetrigger) {
        triggerBexioSync(updatedId);
      }
    },
    onError: (err) => {
      toast.error("Speichern fehlgeschlagen", { description: err.message });
    },
  });

  const onSubmit: SubmitHandler<CustomerFormValues> = async (values) => {
    clearErrors();

    // P24 — guard non-finite paste before passing to Zod / DB cast.
    const heightParsed = isPrivate ? parseFiniteNumber(values.height_cm) : null;
    if (Number.isNaN(heightParsed)) {
      setError("height_cm", { message: "Ungültige Grösse." });
      return;
    }
    const weightParsed = isPrivate ? parseFiniteNumber(values.weight_kg) : null;
    if (Number.isNaN(weightParsed)) {
      setError("weight_kg", { message: "Ungültiges Gewicht." });
      return;
    }

    // P1 — DB DEFAULT `gen_next_customer_number()` supplies the number; the
    // form must not send a value (schema is now `.optional()`).
    const customerPayload: Omit<CustomerCreate, "customer_number"> = {
      customer_type: values.customer_type,
      salutation: values.salutation,
      title: nullIfEmpty(values.title),
      first_name: isPrivate ? nullIfEmpty(values.first_name) : null,
      last_name: isPrivate ? nullIfEmpty(values.last_name) : null,
      company_name: !isPrivate ? nullIfEmpty(values.company_name) : null,
      addressee_line: !isPrivate ? nullIfEmpty(values.addressee_line) : null,
      email: nullIfEmpty(values.email),
      phone: nullIfEmpty(values.phone),
      mobile: nullIfEmpty(values.mobile),
      date_of_birth: nullIfEmpty(values.date_of_birth),
      height_cm: heightParsed,
      weight_kg: weightParsed,
      language: values.language,
      marketing_consent: values.marketing_consent,
      acquisition_channel:
        values.acquisition_channel === "" ? null : values.acquisition_channel,
      bexio_contact_id: null,
      // P4 — `bexio_sync_status` is owned by the mutation: on create it
      // defaults to 'pending'; on update the mutation forces 'pending' only
      // when `bexioRetrigger` is true (omitted from the patch otherwise).
      bexio_sync_status: "pending",
      // P5 — `bexio_synced_at` stays under DB-side ownership; the form must
      // not overwrite an existing success timestamp on edit.
      bexio_synced_at: null,
      notes: nullIfEmpty(values.notes),
      // P3 (Round 3) — `is_active` is managed elsewhere: create defaults to
      // true via DB column default, edit treats it as immutable. Sending the
      // key from the form would let an office user soft-delete a customer
      // through the edit modal by hand-crafting a payload.
      is_active: true,
      // Story 2.1.1 — IV fields. When the marker is off, the dossier number
      // is normalised to `null` so a stray cleared input never lands as an
      // empty string in the DB.
      iv_marker: values.iv_marker,
      iv_dossier_number: values.iv_marker
        ? nullIfEmpty(values.iv_dossier_number)
        : null,
    };

    const addressPayload: CustomerAddressPayload = {
      address_type: "primary",
      is_default_for_type: true,
      // P1 (Round 3) — `recipient_name` is not a form field. Sending `null`
      // here would, before migration 00029, silently null any persisted
      // recipient_name on every edit (the upsert blindly copied excluded.*).
      // Migration 00029 case-when-guards the column, but we still build the
      // payload without the key on edit so the guard kicks in.
      recipient_name: null,
      street: values.street.trim(),
      street_number: nullIfEmpty(values.street_number),
      zip: values.zip.trim(),
      city: values.city.trim(),
      country: values.country,
      floor: values.floor,
      has_elevator: values.has_elevator,
      access_notes: nullIfEmpty(values.access_notes),
      lat: values.lat,
      lng: values.lng,
      geocoded_at: values.geocoded_at,
      is_active: true,
    };

    // P10 — surface Zod issues inline next to each offending field.
    const customerParse = customerCreateSchema.safeParse(customerPayload);
    if (!customerParse.success) {
      let surfaced = false;
      for (const issue of customerParse.error.issues) {
        const field = mapZodPathToField(issue.path);
        if (field) {
          setError(field, { message: issue.message });
          surfaced = true;
        }
      }
      // Refine errors and unmappable issues fall back to a toast so the user
      // still sees something.
      const first = customerParse.error.issues[0];
      toast.error("Eingabe ungültig", {
        description: first?.message ?? "Bitte Eingaben prüfen.",
      });
      if (!surfaced) return;
      return;
    }
    // P28 — schema variant without customer_id; no placeholder UUID needed.
    const addressParse =
      customerAddressUserInputSchema.safeParse(addressPayload);
    if (!addressParse.success) {
      for (const issue of addressParse.error.issues) {
        const field = mapZodPathToField(issue.path);
        if (field) setError(field, { message: issue.message });
      }
      const first = addressParse.error.issues[0];
      toast.error("Adresse ungültig", {
        description: first?.message ?? "Bitte Adresse prüfen.",
      });
      return;
    }

    if (
      values.lat === null &&
      values.lng === null &&
      !values.bypass_geocoding
    ) {
      toast.warning("Adresse noch nicht validiert", {
        description:
          'Klicke "Adresse prüfen" oder bestätige "Trotzdem speichern".',
      });
      return;
    }

    const addressForMutation = addressParse.data as CustomerAddressPayload;

    if (mode === "create") {
      // The mutation calls the atomic create RPC; bexio_sync_status='pending'
      // is set there.
      createMutation.mutate({
        customer: customerParse.data as CustomerCreate,
        address: addressForMutation,
      });
    } else if (customerId) {
      // P4 — only flag retrigger when a relevant field actually changed.
      const customerChanged = BEXIO_RETRIGGER_FIELDS.some(
        (k) => (existing?.[k] ?? null) !== (customerParse.data[k] ?? null),
      );
      const addressChanged = hasAddressChange(
        values,
        existing?.primary_address ?? null,
      );
      const bexioRetrigger = customerChanged || addressChanged;

      // P3 (Round 3) — only send keys whose form fields the user actually
      // changed. The RPC's `case when p_customer ? 'key'` guard is then
      // load-bearing: absent keys preserve existing column values. Without
      // this filter, every save sent the entire EMPTY_DEFAULTS-shaped
      // payload and could revoke `marketing_consent` if hydration raced.
      const customerForUpdate: Partial<CustomerCreate> = {};
      const customerData = customerParse.data;
      const dirty = dirtyFields as Partial<Record<keyof CustomerFormValues, boolean>>;
      for (const key of Object.keys(customerData) as Array<keyof CustomerCreate>) {
        if (key === "is_active" || key === "customer_number") continue;
        if (dirty[key as keyof CustomerFormValues] === true) {
          (customerForUpdate as Record<string, unknown>)[key] =
            (customerData as Record<string, unknown>)[key];
        }
      }

      // P1 (Round 3) — only send dirty address keys. street/zip/city are
      // always sent because the RPC requires them in every call (validation
      // guards check NULL/empty); other columns fall through to the case-
      // when guards in migration 00029.
      const addressForUpdate: Partial<CustomerAddressPayload> & {
        address_type: "primary";
        is_default_for_type: true;
        street: string;
        zip: string;
        city: string;
      } = {
        address_type: "primary",
        is_default_for_type: true,
        street: addressForMutation.street,
        zip: addressForMutation.zip,
        city: addressForMutation.city,
      };
      const addressDirtyKeys: ReadonlyArray<keyof CustomerAddressPayload> = [
        "street_number",
        "country",
        "floor",
        "has_elevator",
        "access_notes",
        "lat",
        "lng",
        "geocoded_at",
      ];
      for (const k of addressDirtyKeys) {
        if (dirty[k as keyof CustomerFormValues] === true) {
          (addressForUpdate as Record<string, unknown>)[k] =
            (addressForMutation as Record<string, unknown>)[k];
        }
      }

      updateMutation.mutate({
        id: customerId,
        customer: customerForUpdate,
        address: addressForUpdate as CustomerAddressPayload,
        bexioRetrigger,
      });
    }
  };

  // P8 — block submit while a geocode lookup is in flight; otherwise a
  // racing submit can persist stale lat/lng paired with the new address.
  const [geocoding, setGeocoding] = useState(false);
  const submitting =
    isSubmitting || createMutation.isPending || updateMutation.isPending;
  const headerTitle = mode === "create" ? "Neuen Kunden anlegen" : "Kunde bearbeiten";
  const headerSubtitle =
    mode === "create"
      ? "Stammdaten erfassen und speichern"
      : "Kundeninformationen bearbeiten und speichern";
  const submitLabel = mode === "create" ? "Anlegen" : "Speichern";

  // P7 — explicit states for the edit-mode loading and not-found cases;
  // the form is never rendered against EMPTY_DEFAULTS when the user
  // intended to edit a real customer.
  const showLoader = isEdit && isLoadingExisting;
  const showNotFound =
    isEdit && !isLoadingExisting && !isErrorExisting && existing == null;
  const showLoadError = isEdit && isErrorExisting;

  // P13 (Round 3) — guard accidental ESC / backdrop click against discarding
  // user-entered customer data. Submit / explicit close button bypass the
  // guard by opting out (see `force` parameter pattern); for now we only
  // confirm on dirty close.
  const handleDialogOpenChange = (next: boolean) => {
    if (next === open) return;
    if (!next && isDirty && !submitting) {
      const ok = window.confirm(
        "Ungespeicherte Änderungen verwerfen?",
      );
      if (!ok) return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{headerTitle}</DialogTitle>
          <DialogDescription>{headerSubtitle}</DialogDescription>
        </DialogHeader>

        {showLoader ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Daten werden geladen…
          </div>
        ) : showNotFound ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm">
            <AlertTriangle className="h-8 w-8 text-warning" aria-hidden />
            <p className="font-medium text-foreground">
              Kunde nicht gefunden
            </p>
            <p className="text-muted-foreground">
              Der Datensatz wurde möglicherweise gelöscht oder ist für dich
              nicht freigegeben.
            </p>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Schliessen
            </Button>
          </div>
        ) : showLoadError ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm">
            <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
            <p className="font-medium text-foreground">
              Daten konnten nicht geladen werden
            </p>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Schliessen
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-5"
            noValidate
          >
            {/* Customer type toggle */}
            <Section title="Kundentyp">
              <Controller
                name="customer_type"
                control={control}
                render={({ field }) => (
                  <div role="radiogroup" className="flex gap-2">
                    {customerTypeValues.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={field.value === t}
                        onClick={() => field.onChange(t)}
                        className={cn(
                          "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                          field.value === t
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-input bg-background text-foreground hover:bg-muted",
                        )}
                      >
                        {t === "private" ? "Privatperson" : "Institution"}
                      </button>
                    ))}
                  </div>
                )}
              />
            </Section>

            {/* Persönliche Daten */}
            <Section title="Persönliche Daten">
              {isPrivate ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
                    <Controller
                      name="salutation"
                      control={control}
                      render={({ field }) => (
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="salutation">Anrede</Label>
                          <Select
                            value={field.value ?? ""}
                            onValueChange={(v) => field.onChange(v || null)}
                          >
                            <SelectTrigger id="salutation">
                              <SelectValue placeholder="–" />
                            </SelectTrigger>
                            <SelectContent>
                              {salutationValues.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {SALUTATION_LABELS[s]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />
                    <Controller
                      name="title"
                      control={control}
                      render={({ field }) => (
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="title">Titel</Label>
                          <Input
                            id="title"
                            {...field}
                            placeholder="Dr. med."
                          />
                        </div>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Controller
                      name="first_name"
                      control={control}
                      rules={{ required: "Vorname ist erforderlich." }}
                      render={({ field }) => (
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="first_name">Vorname</Label>
                          <Input
                            id="first_name"
                            {...field}
                            autoComplete="given-name"
                            aria-invalid={Boolean(errors.first_name)}
                          />
                          {errors.first_name?.message ? (
                            <p
                              role="alert"
                              className="text-xs text-destructive"
                            >
                              {errors.first_name.message}
                            </p>
                          ) : null}
                        </div>
                      )}
                    />
                    <Controller
                      name="last_name"
                      control={control}
                      rules={{ required: "Nachname ist erforderlich." }}
                      render={({ field }) => (
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="last_name">Nachname</Label>
                          <Input
                            id="last_name"
                            {...field}
                            autoComplete="family-name"
                            aria-invalid={Boolean(errors.last_name)}
                          />
                          {errors.last_name?.message ? (
                            <p
                              role="alert"
                              className="text-xs text-destructive"
                            >
                              {errors.last_name.message}
                            </p>
                          ) : null}
                        </div>
                      )}
                    />
                  </div>
                  <Controller
                    name="date_of_birth"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="dob">Geburtsdatum</Label>
                        <Input
                          id="dob"
                          type="date"
                          {...field}
                          autoComplete="bday"
                        />
                      </div>
                    )}
                  />
                </>
              ) : (
                <>
                  <Controller
                    name="company_name"
                    control={control}
                    rules={{ required: "Firmenname ist erforderlich." }}
                    render={({ field }) => (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="company_name">Firmenname</Label>
                        <Input
                          id="company_name"
                          {...field}
                          autoComplete="organization"
                          aria-invalid={Boolean(errors.company_name)}
                        />
                        {errors.company_name?.message ? (
                          <p role="alert" className="text-xs text-destructive">
                            {errors.company_name.message}
                          </p>
                        ) : null}
                      </div>
                    )}
                  />
                  <Controller
                    name="addressee_line"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="addressee_line">
                          Z.&nbsp;Hd. / Ansprechpartner
                        </Label>
                        <Input
                          id="addressee_line"
                          {...field}
                          placeholder="z.B. Frau Müller, Pflegedienstleitung"
                        />
                      </div>
                    )}
                  />
                </>
              )}
            </Section>

            {/* Patient-Daten — private only (Q4 = Option A) */}
            {isPrivate ? (
              <Section
                title="Patient-Daten"
                hint="Aktueller Stand. Bei Bestellungen kann pro Auftrag übersteuert werden."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Controller
                    name="height_cm"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="height_cm">Grösse (cm)</Label>
                        <Input
                          id="height_cm"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={259}
                          {...field}
                        />
                      </div>
                    )}
                  />
                  <Controller
                    name="weight_kg"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="weight_kg">Gewicht (kg)</Label>
                        <Input
                          id="weight_kg"
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min={0}
                          max={349}
                          {...field}
                        />
                      </div>
                    )}
                  />
                </div>
              </Section>
            ) : null}

            {/* IV-Kennzeichnung — Story 2.1.1.
                Not gated on customer_type: institutions can also be IV-relevant
                administrators (e.g. Pflegeheime, die Kosten via IV abrechnen). */}
            <Section
              title="IV-Kennzeichnung"
              hint="IV-Kunden brauchen eine Dossiernummer (z. B. 320/2025/004391/0)."
            >
              <Controller
                name="iv_marker"
                control={control}
                render={({ field }) => (
                  <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="iv_marker">IV-Kunde</Label>
                      <p className="text-xs text-muted-foreground">
                        Kostengutsprache via Invalidenversicherung.
                      </p>
                    </div>
                    <Switch
                      id="iv_marker"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </div>
                )}
              />
              {watchedIvMarker ? (
                <Controller
                  name="iv_dossier_number"
                  control={control}
                  rules={{
                    validate: (v) =>
                      (typeof v === "string" && v.trim() !== "") ||
                      "IV-Dossiernummer ist erforderlich.",
                  }}
                  render={({ field }) => (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="iv_dossier_number">
                        IV-Dossiernummer *
                      </Label>
                      <Input
                        id="iv_dossier_number"
                        placeholder="z. B. 320/2025/004391/0"
                        autoComplete="off"
                        aria-invalid={Boolean(errors.iv_dossier_number)}
                        {...field}
                      />
                      {errors.iv_dossier_number?.message ? (
                        <p role="alert" className="text-xs text-destructive">
                          {errors.iv_dossier_number.message}
                        </p>
                      ) : null}
                    </div>
                  )}
                />
              ) : null}
            </Section>

            {/* Kontakt */}
            <Section title="Kontaktdaten">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Controller
                  name="phone"
                  control={control}
                  rules={{ required: "Telefon ist erforderlich." }}
                  render={({ field }) => (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="phone">Telefon</Label>
                      <Input
                        id="phone"
                        type="tel"
                        autoComplete="tel"
                        {...field}
                        aria-invalid={Boolean(errors.phone)}
                      />
                      {errors.phone?.message ? (
                        <p role="alert" className="text-xs text-destructive">
                          {errors.phone.message}
                        </p>
                      ) : null}
                    </div>
                  )}
                />
                <Controller
                  name="mobile"
                  control={control}
                  render={({ field }) => (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="mobile">Mobile</Label>
                      <Input
                        id="mobile"
                        type="tel"
                        autoComplete="tel"
                        {...field}
                        aria-invalid={Boolean(errors.mobile)}
                      />
                      {errors.mobile?.message ? (
                        <p role="alert" className="text-xs text-destructive">
                          {errors.mobile.message}
                        </p>
                      ) : null}
                    </div>
                  )}
                />
              </div>
              <Controller
                name="email"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email">E-Mail</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      {...field}
                    />
                  </div>
                )}
              />
            </Section>

            {/* Adresse */}
            <Section title="Adresse">
              <CustomerAddressFields
                control={control}
                getValues={getValues}
                setValue={setValue}
                customerAddressId={existing?.primary_address?.id}
                errors={errors as Record<string, { message?: string } | undefined>}
                onGeocodingChange={setGeocoding}
              />
            </Section>

            {/* Versicherung — read-only preview, full editor in Story 2.3 (S-008) */}
            <Section title="Versicherung">
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  Versicherungsangaben werden separat verwaltet
                </p>
                <p className="mt-1">
                  Krankenkasse, KK-Split und Versichertennummer sind ab Story
                  2.3 über den Dialog „Versicherung bearbeiten“ pflegbar (mit
                  MiGeL-Upload und Partner-KK-Hinweis).
                </p>
              </div>
            </Section>

            {/* Sprache + Akquise + Marketing */}
            <Section title="Weitere Angaben">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Controller
                  name="language"
                  control={control}
                  render={({ field }) => (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="language">Sprache</Label>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger id="language">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {languageValues.map((l) => (
                            <SelectItem key={l} value={l}>
                              {LANGUAGE_LABELS[l]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />
                <Controller
                  name="acquisition_channel"
                  control={control}
                  render={({ field }) => (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="acquisition_channel">
                        Akquise-Kanal
                      </Label>
                      <Select
                        value={field.value ?? ""}
                        onValueChange={(v) => field.onChange(v)}
                      >
                        <SelectTrigger id="acquisition_channel">
                          <SelectValue placeholder="–" />
                        </SelectTrigger>
                        <SelectContent>
                          {acquisitionChannelValues.map((a) => (
                            <SelectItem key={a} value={a}>
                              {ACQUISITION_LABELS[a]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />
              </div>
              <Controller
                name="marketing_consent"
                control={control}
                render={({ field }) => (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                    Marketing-Einwilligung erteilt
                  </label>
                )}
              />
            </Section>

            {/* Notizen */}
            <Section title="Notizen">
              <Controller
                name="notes"
                control={control}
                render={({ field }) => (
                  <Textarea
                    {...field}
                    rows={3}
                    placeholder="Interne Notizen"
                  />
                )}
              />
            </Section>

            <DialogFooter className="-mx-6 -mb-6 mt-2 border-t border-border bg-card px-6 py-4 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={submitting || geocoding || (mode === "edit" && !isDirty)}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                    Speichert…
                  </>
                ) : (
                  submitLabel
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-foreground">
          {title}
        </h3>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

type AddressLike =
  | {
      street: string | null;
      street_number: string | null;
      zip: string | null;
      city: string | null;
      country: string | null;
      floor: string | null;
      has_elevator: string | null;
      access_notes: string | null;
    }
  | null;

function hasAddressChange(values: CustomerFormValues, current: AddressLike) {
  if (!current) return true;
  return BEXIO_ADDRESS_FIELDS.some((k) => {
    // P11 (Round 3) — country NULL coalesce. Legacy customers imported from
    // Blue Office can have current.country=null while the form defaults to
    // 'CH'. Without this coalesce, every legacy edit triggered a false
    // bexio retrigger.
    if (k === "country") {
      const currentCountry = current.country ?? "CH";
      return values.country !== currentCountry;
    }
    return (
      (values[k as keyof CustomerFormValues] ?? null) !== (current[k] ?? null)
    );
  });
}
