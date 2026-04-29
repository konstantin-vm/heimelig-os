"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Controller,
  useForm,
  type SubmitHandler,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { PostgrestError } from "@supabase/supabase-js";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { cn } from "@/lib/utils";
import {
  INSURANCE_TYPES,
  type InsuranceType,
} from "@/lib/constants/insurance";
import {
  customerKeys,
  useActivePartnerInsurers,
  useCreateCustomerInsurance,
  useCustomerInsurances,
  useSoftDeleteCustomerInsurance,
  useUpdateCustomerInsurance,
  type CustomerInsuranceCreatePayload,
  type CustomerInsuranceWithPartner,
} from "@/lib/queries/customers";
import {
  customerInsuranceDialogSchema,
  type CustomerInsuranceDialogValues,
} from "@/lib/validations/customer";

import { ConfirmDialog } from "./confirm-dialog";

export type InsuranceDialogMode = "add" | "edit";

export type InsuranceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: InsuranceDialogMode;
  customerId: string;
  customerLabel?: string;
  insurance?: CustomerInsuranceWithPartner;
};

const ANDERE_VALUE = "__andere__";

type FormValues = CustomerInsuranceDialogValues;

const EMPTY_DEFAULTS: FormValues = {
  insurer_choice: "",
  insurer_name_freetext: "",
  insurance_type: "grund",
  insurance_number: "",
  valid_from: "",
  valid_to: "",
  is_primary: false,
};

function nullIfEmpty(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

export function InsuranceDialog({
  open,
  onOpenChange,
  mode,
  customerId,
  customerLabel,
  insurance,
}: InsuranceDialogProps) {
  const isEdit = mode === "edit";
  const queryClient = useQueryClient();
  const { data: partnerInsurers = [] } = useActivePartnerInsurers();
  const { data: insurances } = useCustomerInsurances(customerId);
  const insuranceTypeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: EMPTY_DEFAULTS,
    mode: "onBlur",
    resolver: zodResolver(customerInsuranceDialogSchema),
  });

  const insurerFreetextRef = useRef<HTMLInputElement | null>(null);

  // Refetch on open so the replace-warning sees fresh data after parallel-
  // session edits.
  useEffect(() => {
    if (!open || !customerId) return;
    queryClient.invalidateQueries({
      queryKey: customerKeys.insurance(customerId),
    });
  }, [open, customerId, queryClient]);

  // Hydrate values when (re-)opening the dialog.
  useEffect(() => {
    if (!open) return;
    if (mode === "add") {
      reset(EMPTY_DEFAULTS);
      return;
    }
    if (!insurance) {
      reset(EMPTY_DEFAULTS);
      return;
    }
    const choice = insurance.partner_insurer_id
      ? insurance.partner_insurer_id
      : insurance.insurer_name_freetext
        ? ANDERE_VALUE
        : "";
    reset({
      insurer_choice: choice,
      insurer_name_freetext: insurance.insurer_name_freetext ?? "",
      insurance_type: insurance.insurance_type,
      insurance_number: insurance.insurance_number ?? "",
      valid_from: insurance.valid_from ?? "",
      valid_to: insurance.valid_to ?? "",
      is_primary: insurance.is_primary,
    });
  }, [open, mode, insurance, reset]);

  const watchedChoice = watch("insurer_choice");
  const watchedType = watch("insurance_type");
  const watchedPrimary = watch("is_primary");

  const isPartnerChoice =
    watchedChoice !== "" && watchedChoice !== ANDERE_VALUE;
  const isAndereChoice = watchedChoice === ANDERE_VALUE;

  const selectedPartner = useMemo(
    () =>
      isPartnerChoice
        ? partnerInsurers.find((p) => p.id === watchedChoice) ?? null
        : null,
    [isPartnerChoice, partnerInsurers, watchedChoice],
  );

  const existingPrimary = useMemo(() => {
    if (!insurances) return null;
    return (
      insurances.find(
        (i) =>
          i.is_primary &&
          i.insurance_type === watchedType &&
          (!isEdit || i.id !== insurance?.id),
      ) ?? null
    );
  }, [insurances, isEdit, insurance?.id, watchedType]);

  const replaceWarning = watchedPrimary && existingPrimary;

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

  const createMutation = useCreateCustomerInsurance({
    onSuccess: () => {
      toast.success("Versicherung hinzugefügt.");
      reset(EMPTY_DEFAULTS);
      onOpenChange(false);
    },
    onError: (err) => {
      const code = (err as Partial<PostgrestError>).code;
      let message: string;
      if (code === "23505") {
        message =
          "Ein anderer Hauptversicherungs-Eintrag existiert bereits — bitte erneut versuchen.";
      } else if (code === "23514") {
        message =
          "Bitte entweder eine Partnerkasse oder einen freien Versicherungsnamen angeben.";
      } else {
        message = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
      }
      toast.error(message, { description: err.message });
    },
  });

  const updateMutation = useUpdateCustomerInsurance({
    onSuccess: () => {
      toast.success("Versicherung aktualisiert.");
      onOpenChange(false);
    },
    onError: (err) => {
      const code = (err as Partial<PostgrestError>).code;
      let message: string;
      if (code === "23505") {
        message =
          "Ein anderer Hauptversicherungs-Eintrag existiert bereits — bitte erneut versuchen.";
      } else if (code === "23514") {
        message =
          "Bitte entweder eine Partnerkasse oder einen freien Versicherungsnamen angeben.";
      } else {
        message = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
      }
      toast.error(message, { description: err.message });
    },
  });

  const deleteMutation = useSoftDeleteCustomerInsurance({
    onSuccess: (_data, variables) => {
      if (variables.restore) {
        toast.success("Versicherung wiederhergestellt.");
        return;
      }
      toast.success("Versicherung gelöscht.", {
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
    // Defense in depth: zodResolver also disables the submit button via
    // `isSubmitting`, but Enter-pressed-twice can fire onSubmit before React
    // re-renders the disabled state.
    if (createMutation.isPending || updateMutation.isPending) return;

    const partnerId =
      values.insurer_choice !== ANDERE_VALUE ? values.insurer_choice : null;
    const freetext =
      values.insurer_choice === ANDERE_VALUE
        ? nullIfEmpty(values.insurer_name_freetext)
        : null;

    const payload: CustomerInsuranceCreatePayload = {
      partner_insurer_id: partnerId,
      insurer_name_freetext: freetext,
      insurance_type: values.insurance_type,
      insurance_number: nullIfEmpty(values.insurance_number),
      is_primary: values.is_primary,
      valid_from: nullIfEmpty(values.valid_from),
      valid_to: nullIfEmpty(values.valid_to),
      is_active: true,
    };

    if (mode === "add") {
      createMutation.mutate({
        customerId,
        values: payload,
        setPrimary: values.is_primary,
      });
    } else if (insurance) {
      // Promote via RPC when:
      //   (a) the user toggled primary on, OR
      //   (b) primary stays on AND the insurance_type changed (the row enters
      //       a new partition that may already have a primary — naive UPDATE
      //       would hit 23505 against idx_customer_insurance_primary_unique).
      const primaryToggled = values.is_primary !== insurance.is_primary;
      const typeChangedWhilePrimary =
        values.is_primary &&
        values.insurance_type !== insurance.insurance_type;
      const setPrimary =
        primaryToggled || typeChangedWhilePrimary
          ? values.is_primary
          : undefined;
      updateMutation.mutate({
        customerId,
        insuranceId: insurance.id,
        values: payload,
        setPrimary,
      });
    }
  };

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const headerTitle =
    mode === "add" ? "Versicherung hinzufügen" : "Versicherung bearbeiten";

  function handleInsuranceTypeKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    onChange: (value: InsuranceType) => void,
  ) {
    const len = INSURANCE_TYPES.length;
    const last = len - 1;
    const currentIdx = INSURANCE_TYPES.findIndex(
      (t) => t.value === watchedType,
    );
    let nextIdx: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % len;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIdx = currentIdx < 0 ? last : (currentIdx - 1 + len) % len;
        break;
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = last;
        break;
      default:
        return;
    }
    if (nextIdx === null) return;
    event.preventDefault();
    const next = INSURANCE_TYPES[nextIdx]!.value;
    onChange(next);
    insuranceTypeRefs.current[nextIdx]?.focus();
  }

  const insurerSelectId = useId();
  const insurerFreetextId = useId();
  const insuranceTypeId = useId();
  const insuranceNumberId = useId();
  const validFromId = useId();
  const validToId = useId();
  const primaryId = useId();

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
            {/* Krankenkasse */}
            <Controller
              name="insurer_choice"
              control={control}
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={insurerSelectId}>Krankenkasse *</Label>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      if (v !== ANDERE_VALUE) {
                        setValue("insurer_name_freetext", "", {
                          shouldDirty: true,
                        });
                      } else {
                        // AC-AX: focus the conditional freetext input when
                        // "Andere" is picked. setTimeout defers until after
                        // the input has rendered.
                        setTimeout(() => {
                          insurerFreetextRef.current?.focus();
                        }, 0);
                      }
                    }}
                  >
                    <SelectTrigger
                      id={insurerSelectId}
                      aria-invalid={Boolean(errors.insurer_choice)}
                    >
                      <SelectValue placeholder="Krankenkasse wählen…" />
                    </SelectTrigger>
                    <SelectContent>
                      {partnerInsurers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={ANDERE_VALUE}>Andere</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.insurer_choice?.message ? (
                    <p role="alert" className="text-xs text-destructive">
                      {errors.insurer_choice.message}
                    </p>
                  ) : null}
                </div>
              )}
            />

            {selectedPartner ? (
              <Alert variant="info" role="status">
                <Info aria-hidden className="h-4 w-4" />
                <AlertTitle>Partnerkasse</AlertTitle>
                <AlertDescription>
                  Heimelig kann direkt mit der KK abrechnen.
                </AlertDescription>
              </Alert>
            ) : null}

            {/* Andere — Name der Versicherung */}
            {isAndereChoice ? (
              <Controller
                name="insurer_name_freetext"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={insurerFreetextId}>
                      Name der Versicherung *
                    </Label>
                    <Input
                      id={insurerFreetextId}
                      placeholder="z. B. Concordia"
                      aria-invalid={Boolean(errors.insurer_name_freetext)}
                      {...field}
                      ref={(node) => {
                        field.ref(node);
                        insurerFreetextRef.current = node;
                      }}
                    />
                    {errors.insurer_name_freetext?.message ? (
                      <p role="alert" className="text-xs text-destructive">
                        {errors.insurer_name_freetext.message}
                      </p>
                    ) : null}
                  </div>
                )}
              />
            ) : null}

            {/* Insurance type segmented control */}
            <Controller
              name="insurance_type"
              control={control}
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={insuranceTypeId}>Versicherungstyp *</Label>
                  <div
                    role="radiogroup"
                    id={insuranceTypeId}
                    aria-label="Versicherungstyp"
                    className="inline-flex w-fit gap-1 rounded-md bg-muted p-1"
                  >
                    {INSURANCE_TYPES.map((t, idx) => {
                      const selected = t.value === field.value;
                      return (
                        <button
                          key={t.value}
                          ref={(node) => {
                            insuranceTypeRefs.current[idx] = node;
                          }}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => field.onChange(t.value)}
                          onKeyDown={(e) =>
                            handleInsuranceTypeKeyDown(e, field.onChange)
                          }
                          className={cn(
                            "min-h-[44px] rounded px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            />

            {/* Versicherten-Nr. */}
            <Controller
              name="insurance_number"
              control={control}
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={insuranceNumberId}>
                    Versicherten-Nr.
                    {isPartnerChoice ? " *" : ""}
                  </Label>
                  <Input
                    id={insuranceNumberId}
                    placeholder="Versicherten-Nr. der Krankenkasse"
                    aria-invalid={Boolean(errors.insurance_number)}
                    {...field}
                  />
                  {errors.insurance_number?.message ? (
                    <p role="alert" className="text-xs text-destructive">
                      {errors.insurance_number.message}
                    </p>
                  ) : null}
                </div>
              )}
            />

            {/* Gültig von / Gültig bis */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Controller
                name="valid_from"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={validFromId}>Gültig von</Label>
                    <Input id={validFromId} type="date" {...field} />
                  </div>
                )}
              />
              <Controller
                name="valid_to"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={validToId}>Gültig bis</Label>
                    <Input
                      id={validToId}
                      type="date"
                      aria-invalid={Boolean(errors.valid_to)}
                      {...field}
                    />
                    {errors.valid_to?.message ? (
                      <p role="alert" className="text-xs text-destructive">
                        {errors.valid_to.message}
                      </p>
                    ) : null}
                  </div>
                )}
              />
            </div>

            {/* Hauptversicherung switch */}
            <section className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor={primaryId}>
                  Als Hauptversicherung markieren
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pro Versicherungstyp kann nur ein Eintrag als Hauptversicherung
                  markiert sein.
                </p>
                {replaceWarning && existingPrimary ? (
                  <p
                    role="status"
                    className="mt-1 text-xs font-medium text-amber-700"
                  >
                    {`${
                      existingPrimary.partner_insurers?.name ??
                      existingPrimary.insurer_name_freetext ??
                      "—"
                    } ist aktuell ${
                      existingPrimary.insurance_type === "grund"
                        ? "Grund"
                        : "Zusatz"
                    }-Hauptversicherung und wird ersetzt.`}
                  </p>
                ) : null}
              </div>
              <Controller
                name="is_primary"
                control={control}
                render={({ field }) => (
                  <Switch
                    id={primaryId}
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
              {isEdit && insurance ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={submitting || deleteMutation.isPending}
                >
                  <Trash2 aria-hidden />
                  Versicherung löschen
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

      {isEdit && insurance ? (
        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title="Versicherung löschen?"
          description={(() => {
            const insurer =
              insurance.partner_insurers?.name ??
              insurance.insurer_name_freetext ??
              "—";
            const typeLabel =
              insurance.insurance_type === "grund" ? "Grund" : "Zusatz";
            const customerHint = customerLabel?.trim()
              ? ` ${customerLabel.trim()}`
              : "";
            return `${insurer} (${typeLabel}) wird vom Kunden${customerHint} entfernt. Bestehende Verträge mit KK-Split bleiben unverändert.`;
          })()}
          confirmLabel="Löschen"
          variant="standard"
          onConfirm={async () => {
            await deleteMutation.mutateAsync({
              customerId,
              insuranceId: insurance.id,
            });
            setDeleteConfirmOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
