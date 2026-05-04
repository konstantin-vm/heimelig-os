"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Controller,
  useForm,
  type SubmitHandler,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { PostgrestError } from "@supabase/supabase-js";

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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ADDRESS_TYPE_LABELS } from "@/lib/constants/address";
import {
  customerKeys,
  useCreateCustomerAddress,
  useCustomerAddresses,
  useSoftDeleteCustomerAddress,
  useUpdateCustomerAddress,
  type CustomerAddressCreatePayload,
} from "@/lib/queries/customers";
import {
  customerAddressDialogSchema,
  elevatorSchema,
  floorSchema,
  type CustomerAddress,
  type CustomerAddressDialogValues,
} from "@/lib/validations/customer";

import { AddressFormFields } from "./address-form-fields";
import { AddressTypePicker } from "./address-type-picker";
import { ConfirmDialog } from "./confirm-dialog";

export type AddressDialogMode = "add" | "edit";

export type AddressDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: AddressDialogMode;
  customerId: string;
  customerLabel?: string;
  /** Required for `mode='edit'`. Ignored in `mode='add'`. */
  address?: CustomerAddress;
};

type FormValues = CustomerAddressDialogValues;

const EMPTY_DEFAULTS: FormValues = {
  address_type: "delivery",
  recipient_name: "",
  street: "",
  street_number: "",
  zip: "",
  city: "",
  country: "CH",
  floor: "",
  has_elevator: "",
  access_notes: "",
  lat: null,
  lng: null,
  geocoded_at: null,
  is_default_for_type: true,
  bypass_geocoding: false,
};

function nullIfBlank(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

// Parse the floor / lift form values through their authoritative Zod
// enums instead of an `as` cast. A tampered form (DevTools / browser
// extension / future regression) cannot smuggle an arbitrary string into
// the DB CHECK constraint with this gate; non-enum input falls back to
// null (review fix for the unchecked enum cast).
function safeFloor(value: string): CustomerAddressCreatePayload["floor"] {
  const trimmed = nullIfBlank(value);
  if (trimmed === null) return null;
  const parsed = floorSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

function safeElevator(
  value: string,
): CustomerAddressCreatePayload["has_elevator"] {
  const trimmed = nullIfBlank(value);
  if (trimmed === null) return null;
  const parsed = elevatorSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

export function AddressDialog({
  open,
  onOpenChange,
  mode,
  customerId,
  customerLabel,
  address,
}: AddressDialogProps) {
  const isEdit = mode === "edit";
  const queryClient = useQueryClient();
  const { data: addresses } = useCustomerAddresses(customerId);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors, isDirty, isSubmitting, dirtyFields },
  } = useForm<FormValues>({
    defaultValues: EMPTY_DEFAULTS,
    mode: "onBlur",
    resolver: zodResolver(customerAddressDialogSchema),
  });

  // Refetch on open so the replace-warning sees fresh data after a
  // parallel-session edit (Story 2.2 + 2.3 review pattern).
  useEffect(() => {
    if (!open || !customerId) return;
    queryClient.invalidateQueries({
      queryKey: customerKeys.addresses(customerId),
    });
  }, [open, customerId, queryClient]);

  // Keep the latest `addresses` snapshot in a ref so the hydration effect
  // can read it without re-running on every TanStack refetch (review fix —
  // a refetch mid-edit would otherwise trigger `reset(...)` and wipe the
  // user's typed-but-unsaved input).
  const addressesRef = useRef(addresses);
  addressesRef.current = addresses;

  // Snapshot of `address.is_default_for_type` taken at dialog-open time.
  // The submit-time comparator uses this snapshot instead of the live
  // `address` prop so a Realtime invalidation that flips the row's default
  // flag mid-edit cannot make the user's submit produce the opposite of
  // the intended action (round-2 review).
  const initialIsDefaultRef = useRef<boolean | null>(null);

  // Track whether the user opened the dialog with a specific address row
  // (edit mode). If that row vanishes from the addresses list while the
  // dialog is open (cross-session soft-delete), we surface an error and
  // close the dialog instead of silently resetting the form. Round-2
  // review: previously the hydration effect re-ran on `address` flipping
  // to undefined and wiped user input via reset(EMPTY_DEFAULTS).
  const editTargetIdRef = useRef<string | null>(null);

  // Hydrate values when (re-)opening the dialog OR when the edit-target
  // address prop changes. We deliberately do NOT depend on `addresses`:
  // the snapshot is read from the ref above so refetches do not cancel the
  // user's edit.
  useEffect(() => {
    if (!open) {
      initialIsDefaultRef.current = null;
      editTargetIdRef.current = null;
      return;
    }
    if (mode === "add") {
      // Default the Hauptadresse switch to true when no other active row of
      // the seeded type ('delivery') exists yet — that gives the first new
      // delivery address the right initial state. The user can flip it off.
      // (Type-change re-seed is handled by a separate effect below.)
      const hasDeliveryDefault = (addressesRef.current ?? []).some(
        (a) => a.address_type === "delivery" && a.is_default_for_type,
      );
      reset({
        ...EMPTY_DEFAULTS,
        is_default_for_type: !hasDeliveryDefault,
      });
      initialIsDefaultRef.current = !hasDeliveryDefault;
      editTargetIdRef.current = null;
      return;
    }
    // edit mode
    if (!address) {
      // Open without an address prop on first mount → keep empty defaults
      // and remember no edit-target. Address-vanished detection (below)
      // only fires once we've recorded an id.
      if (editTargetIdRef.current === null) {
        reset(EMPTY_DEFAULTS);
        return;
      }
      // Address went from defined → undefined while dialog open: handled
      // by the address-vanished effect below.
      return;
    }
    if (
      editTargetIdRef.current !== null &&
      editTargetIdRef.current === address.id
    ) {
      // Same edit target as before — `address` prop changed only because
      // a Realtime refetch returned a fresh row reference. Do NOT reset:
      // that would wipe in-progress edits. The hydration ref-pattern
      // applies here just like for the addresses list.
      return;
    }
    reset({
      address_type: address.address_type,
      recipient_name: address.recipient_name ?? "",
      street: address.street ?? "",
      street_number: address.street_number ?? "",
      zip: address.zip ?? "",
      city: address.city ?? "",
      country: address.country,
      floor: address.floor ?? "",
      has_elevator: address.has_elevator ?? "",
      access_notes: address.access_notes ?? "",
      lat: address.lat,
      lng: address.lng,
      geocoded_at: address.geocoded_at,
      is_default_for_type: address.is_default_for_type,
      bypass_geocoding: false,
    });
    initialIsDefaultRef.current = address.is_default_for_type;
    editTargetIdRef.current = address.id;
  }, [open, mode, address, reset]);

  const watchedType = watch("address_type");
  const watchedDefault = watch("is_default_for_type");

  // Round-2 review: when the user changes the address-type picker in add
  // mode, recompute the Hauptadresse seed for the newly-picked partition.
  // Previously the seed was computed once at open against the seeded
  // 'delivery' type; switching to e.g. 'billing' (where a default already
  // exists) left the toggle pre-selected as `true` and surprised the user
  // with the replace-warning instead of the spec's "default false otherwise"
  // behaviour (AC1).
  const watchedTypeForSeed = mode === "add" ? watchedType : null;
  const seedTypeRef = useRef<typeof watchedType | null>(null);
  useEffect(() => {
    if (watchedTypeForSeed === null) {
      seedTypeRef.current = null;
      return;
    }
    if (seedTypeRef.current === null) {
      // First record after open — leave the value chosen by the open-effect.
      seedTypeRef.current = watchedTypeForSeed;
      return;
    }
    if (seedTypeRef.current === watchedTypeForSeed) return;
    // Type changed — recompute the seed against the new partition.
    seedTypeRef.current = watchedTypeForSeed;
    const hasDefault = (addressesRef.current ?? []).some(
      (a) =>
        a.address_type === watchedTypeForSeed && a.is_default_for_type,
    );
    setValue("is_default_for_type", !hasDefault, { shouldDirty: true });
    initialIsDefaultRef.current = !hasDefault;
  }, [watchedTypeForSeed, setValue]);

  // Round-2 review: detect when an edit-target address vanishes from the
  // addresses list (e.g. another session soft-deleted it). Surface a toast
  // and close the dialog instead of silently resetting form state and
  // wiping the user's typed-but-unsaved input.
  useEffect(() => {
    if (!open) return;
    if (mode !== "edit") return;
    const trackedId = editTargetIdRef.current;
    if (trackedId === null) return;
    if (addresses === undefined) return; // initial fetch in flight
    const stillExists = addresses.some((a) => a.id === trackedId);
    if (stillExists) return;
    toast.error(
      "Adresse wurde gelöscht.",
      {
        description:
          "Diese Adresse wurde von einer anderen Sitzung entfernt. Der Dialog wird geschlossen.",
      },
    );
    editTargetIdRef.current = null;
    onOpenChange(false);
  }, [open, mode, addresses, onOpenChange]);

  // Existing default of the same type — used for the replace-warning. In
  // edit mode we exclude the row being edited.
  const existingDefault = useMemo(() => {
    if (!addresses) return null;
    return (
      addresses.find(
        (a) =>
          a.is_default_for_type &&
          a.address_type === watchedType &&
          a.address_type !== "primary" &&
          (!isEdit || a.id !== address?.id),
      ) ?? null
    );
  }, [addresses, isEdit, address?.id, watchedType]);

  const replaceWarning = watchedDefault && existingDefault;

  // Dirty-form guard wiring -------------------------------------------------

  const [discardOpen, setDiscardOpen] = useState(false);

  // `requestClose` is defined after the mutations + `submitting` computation
  // below so it can read the live submitting state. See the function
  // definition further down.

  // Mutations ---------------------------------------------------------------

  const createMutation = useCreateCustomerAddress({
    onSuccess: () => {
      toast.success("Adresse hinzugefügt.");
      reset(EMPTY_DEFAULTS);
      onOpenChange(false);
    },
    onError: (err) => {
      const code = (err as Partial<PostgrestError>).code;
      let message: string;
      if (code === "23505") {
        message =
          "Eine andere Standardadresse für diesen Typ existiert bereits — bitte erneut versuchen.";
      } else if (code === "23514") {
        message = "Ungültiger Wert — bitte prüfen Sie die Eingabe.";
      } else if (code === "P0002") {
        message =
          "Adresse ist deaktiviert — bitte zuerst wiederherstellen.";
      } else {
        message = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
      }
      toast.error(message, { description: err.message });
    },
  });

  const updateMutation = useUpdateCustomerAddress({
    onSuccess: () => {
      toast.success("Adresse aktualisiert.");
      onOpenChange(false);
    },
    onError: (err) => {
      const code = (err as Partial<PostgrestError>).code;
      let message: string;
      if (code === "23505") {
        message =
          "Eine andere Standardadresse für diesen Typ existiert bereits — bitte erneut versuchen.";
      } else if (code === "23514") {
        message = "Ungültiger Wert — bitte prüfen Sie die Eingabe.";
      } else if (code === "P0002") {
        message =
          "Adresse ist deaktiviert — bitte zuerst wiederherstellen.";
      } else {
        message = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
      }
      toast.error(message, { description: err.message });
    },
  });

  const deleteMutation = useSoftDeleteCustomerAddress({
    onSuccess: (_data, variables) => {
      if (variables.restore) {
        toast.success("Adresse wiederhergestellt.");
        return;
      }
      toast.success("Adresse gelöscht.", {
        action: {
          label: "Rückgängig",
          onClick: () => {
            deleteMutation.mutate({ ...variables, restore: true });
          },
        },
      });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error("Löschen fehlgeschlagen.", { description: err.message });
    },
  });

  const submitting =
    isSubmitting ||
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  function requestClose() {
    // Round-2 review: refuse close while a mutation is in flight. The
    // backdrop / Escape would otherwise dismiss the dialog mid-submit and
    // race the success toast against a freshly-opened next dialog instance.
    if (submitting) return;
    if (isDirty) {
      setDiscardOpen(true);
    } else {
      onOpenChange(false);
    }
  }

  // Submit ------------------------------------------------------------------

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    if (createMutation.isPending || updateMutation.isPending) return;
    if (values.address_type === "primary") return; // defense-in-depth

    // Round-2 review: mirror Story 2.1's customer-edit-form geocode guard.
    // The dialog previously allowed Save with null lat/lng without the user
    // explicitly bypassing geocoding — silently regressing the address-
    // validation contract for delivery / billing / other addresses.
    if (
      values.lat === null &&
      values.lng === null &&
      !values.bypass_geocoding
    ) {
      toast.error(
        "Adresse nicht geprüft.",
        {
          description:
            "Bitte „Adresse prüfen“ klicken oder „Trotzdem speichern“ aktivieren.",
        },
      );
      return;
    }

    const payload: CustomerAddressCreatePayload = {
      address_type: values.address_type,
      recipient_name: nullIfBlank(values.recipient_name),
      street: values.street.trim(),
      street_number: nullIfBlank(values.street_number),
      zip: values.zip.trim(),
      city: values.city.trim(),
      country: values.country,
      floor: safeFloor(values.floor),
      has_elevator: safeElevator(values.has_elevator),
      access_notes: nullIfBlank(values.access_notes),
      lat: values.lat,
      lng: values.lng,
      geocoded_at: values.geocoded_at,
      is_default_for_type: values.is_default_for_type,
      is_active: true,
    };

    if (mode === "add") {
      createMutation.mutate({
        customerId,
        values: payload,
        setDefault: values.is_default_for_type,
      });
    } else if (address) {
      // Round-2 review: compare against the snapshot taken at dialog-open
      // time. The live `address` prop can mutate via Realtime invalidation
      // → parent re-renders with a refreshed row reference; comparing
      // `values.is_default_for_type !== address.is_default_for_type` with
      // the live prop would produce the OPPOSITE of the user's intent if
      // the row's default flag changed under the dialog.
      const initialIsDefault =
        initialIsDefaultRef.current ?? address.is_default_for_type;
      const defaultToggled = values.is_default_for_type !== initialIsDefault;
      const setDefault = defaultToggled ? values.is_default_for_type : undefined;

      // Round-2 review: scope the field-UPDATE to dirtyFields so a pristine
      // "open + Save" no-op no longer fires a phantom UPDATE + audit row.
      // Mirrors Story 2.1 round-3 dirtyFields-scoped patch.
      const dirtyKeys = new Set<
        "recipient_name" | "street" | "street_number" | "zip" | "city" |
        "country" | "floor" | "has_elevator" | "access_notes" | "lat" |
        "lng" | "geocoded_at"
      >();
      if (dirtyFields.recipient_name) dirtyKeys.add("recipient_name");
      if (dirtyFields.street) dirtyKeys.add("street");
      if (dirtyFields.street_number) dirtyKeys.add("street_number");
      if (dirtyFields.zip) dirtyKeys.add("zip");
      if (dirtyFields.city) dirtyKeys.add("city");
      if (dirtyFields.country) dirtyKeys.add("country");
      if (dirtyFields.floor) dirtyKeys.add("floor");
      if (dirtyFields.has_elevator) dirtyKeys.add("has_elevator");
      if (dirtyFields.access_notes) dirtyKeys.add("access_notes");
      if (dirtyFields.lat) dirtyKeys.add("lat");
      if (dirtyFields.lng) dirtyKeys.add("lng");
      if (dirtyFields.geocoded_at) dirtyKeys.add("geocoded_at");

      // No field changes AND no default-toggle → nothing to do.
      if (dirtyKeys.size === 0 && setDefault === undefined) {
        toast.info("Keine Änderungen.");
        onOpenChange(false);
        return;
      }

      updateMutation.mutate({
        customerId,
        addressId: address.id,
        values: payload,
        setDefault,
        dirtyFields: dirtyKeys,
      });
    }
  };

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const headerTitle =
    mode === "add" ? "Adresse hinzufügen" : "Adresse bearbeiten";

  const recipientId = useId();
  const defaultId = useId();
  const typePickerId = useId();

  // Address-line preview for the delete-confirm body.
  const addressLineForConfirm = useMemo(() => {
    if (!address) return null;
    const street = [address.street, address.street_number]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(" ");
    const cityZip = [address.zip, address.city]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(" ");
    return [street, cityZip].filter(Boolean).join(", ") || "—";
  }, [address]);

  const recipientHelper =
    watchedType === "billing"
      ? "Optional — z.B. Krankenkasse, Sozialdienst, abweichende Rechnungsadresse."
      : "Optional — z.B. „Tochter Sabine Müller“ für eine Lieferadresse.";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) {
            onOpenChange(true);
          } else {
            requestClose();
          }
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[780px]">
          <DialogHeader>
            <DialogTitle>{headerTitle}</DialogTitle>
            <DialogDescription>
              Daten erfassen und speichern. Pflichtfelder sind mit * markiert.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-5"
            noValidate
          >
            {/* Address-type segmented control */}
            <Controller
              name="address_type"
              control={control}
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={typePickerId} required>Adresstyp</Label>
                  <AddressTypePicker
                    id={typePickerId}
                    value={
                      field.value === "primary"
                        ? "delivery"
                        : (field.value as Exclude<typeof field.value, "primary">)
                    }
                    onChange={field.onChange}
                    disabled={isEdit}
                    invalid={Boolean(errors.address_type)}
                  />
                  {isEdit ? (
                    <p className="text-xs text-muted-foreground">
                      Adresstyp kann nach dem Erstellen nicht mehr geändert
                      werden. Lösche die Adresse und lege sie mit dem
                      gewünschten Typ neu an.
                    </p>
                  ) : null}
                  {errors.address_type?.message ? (
                    <p role="alert" className="text-xs text-destructive">
                      {errors.address_type.message}
                    </p>
                  ) : null}
                </div>
              )}
            />

            {/* recipient_name */}
            <Controller
              name="recipient_name"
              control={control}
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={recipientId}>Abweichender Empfänger</Label>
                  <Input
                    id={recipientId}
                    placeholder="z.B. Tochter Sabine Müller"
                    aria-invalid={Boolean(errors.recipient_name)}
                    {...field}
                  />
                  <p className="text-xs text-muted-foreground">
                    {recipientHelper}
                  </p>
                  {errors.recipient_name?.message ? (
                    <p role="alert" className="text-xs text-destructive">
                      {errors.recipient_name.message}
                    </p>
                  ) : null}
                </div>
              )}
            />

            {/* Street / number / zip / city / country / floor / lift / notes
                + geocoder. Shared field block from Story 2.1, extracted to
                avoid generic-typed RHF refactor. */}
            <AddressFormFields
              control={control}
              getValues={getValues}
              setValue={setValue}
              customerAddressId={address?.id ?? null}
              errors={errors}
              disabled={submitting}
              idPrefix={`address-dialog-${isEdit ? "edit" : "add"}`}
            />

            {/* Hauptadresse switch */}
            <section className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor={defaultId}>
                  Als Standardadresse für diesen Adresstyp markieren
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pro Adresstyp kann nur eine Adresse als Standard markiert
                  sein.
                </p>
                {replaceWarning && existingDefault ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className="mt-1 text-xs font-medium text-warning-foreground"
                  >
                    {(() => {
                      const recipient =
                        existingDefault.recipient_name?.trim() ||
                        [existingDefault.street, existingDefault.street_number]
                          .filter((s): s is string => Boolean(s && s.trim()))
                          .join(" ") ||
                        "—";
                      const typeLabel = ADDRESS_TYPE_LABELS[existingDefault.address_type];
                      return `${recipient} ist aktuell Standard für ${typeLabel} und wird ersetzt.`;
                    })()}
                  </p>
                ) : null}
              </div>
              <Controller
                name="is_default_for_type"
                control={control}
                render={({ field }) => (
                  <Switch
                    id={defaultId}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </section>

            <DialogFooter
              className={cn(
                "-mx-6 -mb-6 mt-2 border-t border-border bg-card px-6 py-4",
                isEdit ? "sm:justify-between" : "sm:justify-end",
              )}
            >
              {isEdit && address ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={submitting || deleteMutation.isPending}
                >
                  <Trash2 aria-hidden />
                  Adresse löschen
                </Button>
              ) : null}
              <div className="flex items-center gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestClose}
                  disabled={submitting}
                >
                  Abbrechen
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden />
                      Speichert…
                    </>
                  ) : (
                    "Speichern"
                  )}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Änderungen verwerfen?"
        description="Bisher eingegebene Daten gehen verloren."
        confirmLabel="Verwerfen"
        cancelLabel="Abbrechen"
        variant="destructive"
        onConfirm={() => {
          setDiscardOpen(false);
          reset(EMPTY_DEFAULTS);
          onOpenChange(false);
        }}
      />

      {isEdit && address ? (
        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title="Adresse löschen?"
          description={(() => {
            const recipient = address.recipient_name?.trim() || addressLineForConfirm;
            const typeLabel = ADDRESS_TYPE_LABELS[address.address_type];
            const customerHint = customerLabel?.trim()
              ? ` ${customerLabel.trim()}`
              : "";
            return `${recipient} (${typeLabel}) wird vom Kunden${customerHint} entfernt. Bestehende Aufträge mit dieser Adresse bleiben unverändert.`;
          })()}
          confirmLabel="Löschen"
          variant="standard"
          onConfirm={async () => {
            await deleteMutation.mutateAsync({
              customerId,
              addressId: address.id,
            });
            setDeleteConfirmOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
