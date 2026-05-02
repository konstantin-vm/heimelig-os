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
    formState: { errors, isDirty, isSubmitting },
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

  // Hydrate values when (re-)opening the dialog OR when the edit-target
  // address prop changes. We deliberately do NOT depend on `addresses`:
  // the snapshot is read from the ref above so refetches do not cancel the
  // user's edit.
  useEffect(() => {
    if (!open) return;
    if (mode === "add") {
      // Default the Hauptadresse switch to true when no other active row of
      // the default type ('delivery') exists yet — that gives the first new
      // delivery address the right initial state. The user can flip it off.
      const hasDeliveryDefault = (addressesRef.current ?? []).some(
        (a) => a.address_type === "delivery" && a.is_default_for_type,
      );
      reset({
        ...EMPTY_DEFAULTS,
        is_default_for_type: !hasDeliveryDefault,
      });
      return;
    }
    if (!address) {
      reset(EMPTY_DEFAULTS);
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
  }, [open, mode, address, reset]);

  const watchedType = watch("address_type");
  const watchedDefault = watch("is_default_for_type");

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

  function requestClose() {
    if (isDirty) {
      setDiscardOpen(true);
    } else {
      onOpenChange(false);
    }
  }

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

  // Submit ------------------------------------------------------------------

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    if (createMutation.isPending || updateMutation.isPending) return;
    if (values.address_type === "primary") return; // defense-in-depth

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
      // Promote via RPC when the default toggle changed in either direction.
      // Since address_type is read-only in edit mode, we don't need the
      // type-changed-while-default branch from Story 2.3.
      const defaultToggled =
        values.is_default_for_type !== address.is_default_for_type;
      const setDefault = defaultToggled ? values.is_default_for_type : undefined;
      updateMutation.mutate({
        customerId,
        addressId: address.id,
        values: payload,
        setDefault,
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
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[520px]">
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
                  <Label htmlFor={typePickerId}>Adresstyp *</Label>
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
                    className="mt-1 text-xs font-medium text-amber-700"
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
