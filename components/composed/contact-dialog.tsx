"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type SubmitHandler, type FieldPath } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CONTACT_ROLES,
  type ContactRole,
} from "@/lib/constants/contact-roles";
import {
  customerKeys,
  useContactPersons,
  useCreateContactPerson,
  useSoftDeleteContactPerson,
  useUpdateContactPerson,
  type ContactPersonCreatePayload,
} from "@/lib/queries/customers";
import {
  contactPersonFormCreateSchema,
  salutationValues,
  SALUTATION_LABELS,
  type ContactPerson,
} from "@/lib/validations/customer";

import { ConfirmDialog } from "./confirm-dialog";
import { ContactRolePicker } from "./contact-role-picker";

export type ContactDialogMode = "add" | "edit";

export type ContactDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ContactDialogMode;
  customerId: string;
  customerLabel?: string;
  contact?: ContactPerson;
};

type FormValues = {
  role: ContactRole | null;
  salutation: "" | (typeof salutationValues)[number];
  title: string;
  first_name: string;
  last_name: string;
  organization: string;
  phone: string;
  email: string;
  notes: string;
  is_primary_contact: boolean;
};

const EMPTY_DEFAULTS: FormValues = {
  role: null,
  salutation: "",
  title: "",
  first_name: "",
  last_name: "",
  organization: "",
  phone: "",
  email: "",
  notes: "",
  is_primary_contact: false,
};

function nullIfEmpty(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

export function ContactDialog({
  open,
  onOpenChange,
  mode,
  customerId,
  customerLabel,
  contact,
}: ContactDialogProps) {
  const isEdit = mode === "edit";
  const queryClient = useQueryClient();
  const { data: contacts } = useContactPersons(customerId);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: EMPTY_DEFAULTS,
    mode: "onBlur",
  });

  // Refetch contacts when the dialog opens so the replace-warning reflects
  // the current server state (avoids races against parallel-session edits).
  useEffect(() => {
    if (!open || !customerId) return;
    queryClient.invalidateQueries({
      queryKey: customerKeys.contacts(customerId),
    });
  }, [open, customerId, queryClient]);

  // Hydrate values when (re-)opening the dialog.
  useEffect(() => {
    if (!open) return;
    if (mode === "add") {
      reset(EMPTY_DEFAULTS);
      return;
    }
    if (!contact) {
      // Defensive: never carry stale edit values when the contact is missing.
      reset(EMPTY_DEFAULTS);
      return;
    }
    reset({
      role: contact.role,
      salutation: (contact.salutation ?? "") as FormValues["salutation"],
      title: contact.title ?? "",
      first_name: contact.first_name,
      last_name: contact.last_name,
      organization: contact.organization ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      notes: contact.notes ?? "",
      is_primary_contact: contact.is_primary_contact,
    });
  }, [open, mode, contact, reset]);

  const watchedPrimary = watch("is_primary_contact");

  const existingPrimary = useMemo(() => {
    if (!contacts) return null;
    return (
      contacts.find(
        (c) => c.is_primary_contact && (!isEdit || c.id !== contact?.id),
      ) ?? null
    );
  }, [contacts, isEdit, contact?.id]);

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

  const createMutation = useCreateContactPerson({
    onSuccess: () => {
      toast.success("Kontakt hinzugefügt.");
      reset(EMPTY_DEFAULTS);
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error("Speichern fehlgeschlagen. Bitte erneut versuchen.", {
        description: err.message,
      });
    },
  });

  const updateMutation = useUpdateContactPerson({
    onSuccess: () => {
      toast.success("Kontakt aktualisiert.");
      onOpenChange(false);
    },
    onError: (err) => {
      const code = (err as Partial<PostgrestError>).code;
      const isPartialUniqueRace = code === "23505";
      toast.error(
        isPartialUniqueRace
          ? "Ein anderer Hauptkontakt existiert bereits — bitte erneut versuchen."
          : "Speichern fehlgeschlagen. Bitte erneut versuchen.",
        { description: err.message },
      );
    },
  });

  const deleteMutation = useSoftDeleteContactPerson({
    onSuccess: (_data, variables) => {
      // Only show the Undo affordance for the actual delete — restoring
      // again would re-show the toast and create a flip-flop loop.
      if (variables.restore) {
        toast.success("Kontakt wiederhergestellt.");
        return;
      }
      toast.success("Kontakt gelöscht.", {
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
      const code = (err as Partial<PostgrestError>).code;
      const isPartialUniqueRace = code === "23505";
      toast.error(
        isPartialUniqueRace
          ? "Wiederherstellen nicht möglich — ein anderer Kontakt ist inzwischen Hauptkontakt."
          : "Löschen fehlgeschlagen.",
        { description: err.message },
      );
    },
  });

  const submitting =
    isSubmitting || createMutation.isPending || updateMutation.isPending;

  // Submit ------------------------------------------------------------------

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    if (values.role === null) {
      toast.error("Bitte Rolle auswählen.");
      return;
    }

    const payload: ContactPersonCreatePayload = {
      role: values.role,
      salutation: values.salutation === "" ? null : values.salutation,
      title: nullIfEmpty(values.title),
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      organization: nullIfEmpty(values.organization),
      phone: nullIfEmpty(values.phone),
      email: nullIfEmpty(values.email),
      notes: nullIfEmpty(values.notes),
      is_primary_contact: values.is_primary_contact,
      is_active: true,
    };

    const parsed = contactPersonFormCreateSchema.safeParse({
      ...payload,
      customer_id: customerId,
    });
    if (!parsed.success) {
      // Render Zod issues inline at each offending field (AC6) instead of
      // surfacing only the first one via toast.
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (typeof path !== "string") continue;
        if (path === "customer_id") continue; // not a form field
        setError(path as FieldPath<FormValues>, {
          type: "zod",
          message: issue.message,
        });
      }
      return;
    }

    if (mode === "add") {
      createMutation.mutate({
        customerId,
        values: payload,
        setPrimary: values.is_primary_contact,
      });
    } else if (contact) {
      const setPrimary =
        values.is_primary_contact !== contact.is_primary_contact
          ? values.is_primary_contact
          : undefined;
      updateMutation.mutate({
        customerId,
        contactId: contact.id,
        values: payload,
        setPrimary,
      });
    }
  };

  // Delete confirm ----------------------------------------------------------

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const headerTitle =
    mode === "add" ? "Kontakt hinzufügen" : "Kontakt bearbeiten";

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
            {/* Rolle */}
            <section className="flex flex-col gap-2">
              <Label htmlFor="contact-role" required>Rolle</Label>
              <Controller
                name="role"
                control={control}
                rules={{ required: "Bitte Rolle auswählen." }}
                render={({ field, fieldState }) => (
                  <ContactRolePicker
                    id="contact-role"
                    value={field.value}
                    onChange={(role) => field.onChange(role)}
                    invalid={Boolean(fieldState.error)}
                  />
                )}
              />
              {errors.role?.message ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.role.message}
                </p>
              ) : null}
            </section>

            {/* Hauptkontakt switch */}
            <section className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="contact-primary">
                  Als Hauptkontakt festlegen
                </Label>
                <p className="text-xs text-muted-foreground">
                  Hauptkontakte erscheinen oben in der Kontaktliste und werden
                  bei Touren-Anrufen zuerst kontaktiert.
                </p>
                {replaceWarning && existingPrimary ? (
                  <p
                    role="status"
                    className="mt-1 text-xs font-medium text-warning-foreground"
                  >
                    {`${[existingPrimary.first_name, existingPrimary.last_name]
                      .filter((s) => s)
                      .join(" ")} ist aktuell Hauptkontakt und wird ersetzt.`}
                  </p>
                ) : null}
              </div>
              <Controller
                name="is_primary_contact"
                control={control}
                render={({ field }) => (
                  <Switch
                    id="contact-primary"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </section>

            {/* Anrede + Titel */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Controller
                name="salutation"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="contact-salutation">Anrede</Label>
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange((v ?? "") as FormValues["salutation"])
                      }
                    >
                      <SelectTrigger id="contact-salutation">
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
                    <Label htmlFor="contact-title">Titel</Label>
                    <Input
                      id="contact-title"
                      placeholder="Dr. med."
                      {...field}
                    />
                  </div>
                )}
              />
            </div>

            {/* Vorname + Nachname */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Controller
                name="first_name"
                control={control}
                rules={{ required: "Vorname ist erforderlich" }}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="contact-first-name" required>Vorname</Label>
                    <Input
                      id="contact-first-name"
                      autoComplete="given-name"
                      aria-invalid={Boolean(errors.first_name)}
                      {...field}
                    />
                    {errors.first_name?.message ? (
                      <p role="alert" className="text-xs text-destructive">
                        {errors.first_name.message}
                      </p>
                    ) : null}
                  </div>
                )}
              />
              <Controller
                name="last_name"
                control={control}
                rules={{ required: "Nachname ist erforderlich" }}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="contact-last-name" required>Nachname</Label>
                    <Input
                      id="contact-last-name"
                      autoComplete="family-name"
                      aria-invalid={Boolean(errors.last_name)}
                      {...field}
                    />
                    {errors.last_name?.message ? (
                      <p role="alert" className="text-xs text-destructive">
                        {errors.last_name.message}
                      </p>
                    ) : null}
                  </div>
                )}
              />
            </div>

            {/* Organisation */}
            <Controller
              name="organization"
              control={control}
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contact-organization">Organisation</Label>
                  <Input
                    id="contact-organization"
                    placeholder="z. B. Spitex Winterthur Süd"
                    {...field}
                  />
                </div>
              )}
            />

            {/* Telefon + E-Mail */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Controller
                name="phone"
                control={control}
                rules={{ required: "Telefon ist erforderlich" }}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="contact-phone" required>Telefon</Label>
                    <Input
                      id="contact-phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="044 123 45 67"
                      aria-invalid={Boolean(errors.phone)}
                      {...field}
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
                name="email"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="contact-email">E-Mail (optional)</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      autoComplete="email"
                      placeholder="name@beispiel.ch"
                      {...field}
                    />
                  </div>
                )}
              />
            </div>

            {/* Notizen */}
            <Controller
              name="notes"
              control={control}
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contact-notes">Notizen (optional)</Label>
                  <Textarea
                    id="contact-notes"
                    rows={3}
                    placeholder="z. B. Bevorzugte Anrufzeiten, Einsätze, etc."
                    {...field}
                  />
                </div>
              )}
            />

            <DialogFooter
              className={cn(
                "-mx-6 -mb-6 mt-2 border-t border-border bg-card px-6 py-4",
                isEdit ? "sm:justify-between" : "sm:justify-end",
              )}
            >
              {isEdit && contact ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={submitting || deleteMutation.isPending}
                >
                  <Trash2 aria-hidden />
                  Kontakt löschen
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
                <Button
                  type="submit"
                  disabled={submitting || (isEdit && !isDirty)}
                >
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

      {isEdit && contact ? (
        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title="Kontakt löschen?"
          description={(() => {
            const fullName = [contact.first_name, contact.last_name]
              .filter((s) => s)
              .join(" ");
            const config = CONTACT_ROLES.find((r) => r.value === contact.role);
            const customerHint = customerLabel?.trim()
              ? ` ${customerLabel.trim()}`
              : "";
            return `${fullName} (${config?.label ?? contact.role}) wird vom Kunden${customerHint} entfernt.`;
          })()}
          confirmLabel="Löschen"
          variant="standard"
          onConfirm={async () => {
            await deleteMutation.mutateAsync({
              customerId,
              contactId: contact.id,
            });
            setDeleteConfirmOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
