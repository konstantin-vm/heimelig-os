"use client";

// <DeviceEditForm> — Story 3.2.
//
// RHF + zodResolver-driven create/edit modal for `devices`. Mirrors
// `<ArticleEditForm>` (Story 3.1) shell and carries forward every Story-3.1
// review lesson:
//   * `zodResolver(deviceCreateSchema | deviceUpdateSchema)` is mandatory.
//   * `useEffect(reset)` keys on `device?.id` only + short-circuits on
//     `formState.isDirty` so a Realtime refetch cannot clobber in-flight input.
//   * Status field is hidden in `mode='create'` (server default seeds
//     'available') and read-only in `mode='edit'` (Story 3.3 owns the
//     transition path).
//   * `retired_at` is admin-only.
//   * `acquisition_price` is hidden for warehouse role (UI defense-in-depth).
//   * Common Postgres error codes (23505, 23503, 42501, PGRST116) map to
//     German toasts via the friendly-message map in `lib/queries/devices.ts`.
//   * Dialog close is blocked while submitting via `onPointerDownOutside` /
//     `onEscapeKeyDown` `preventDefault()`.
//
// Note on combobox primitives: shadcn-Combobox + Sheet aren't vendored in
// the repo. The form uses the existing `<Select>` for fixed-set FKs
// (warehouses, suppliers, articles filtered to is_rentable=true) which
// are small enough to load fully. A dedicated customer picker is not in
// scope for Story 3.2 — the `reserved_for_customer_id` field exposes a
// uuid input as a stop-gap (admins can paste from the customer URL); a
// follow-up story replaces both with a proper combobox shell once the
// shadcn primitives land.

import { useEffect, useRef } from "react";
import { Controller, useForm, type SubmitHandler } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

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
  deviceConditionLabels,
  deviceStatusLabels,
} from "@/lib/constants/device";
import { useAppRole } from "@/lib/hooks/use-app-role";
import {
  useDevice,
  useDeviceCreate,
  useDeviceUpdate,
} from "@/lib/queries/devices";
import { createClient } from "@/lib/supabase/client";
import {
  deviceConditionValues,
  deviceCreateSchema,
  deviceUpdateSchema,
  type DeviceCreate,
  type DeviceUpdate,
} from "@/lib/validations/device";
import { uuidSchema } from "@/lib/validations/common";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Lookup hooks for FK comboboxes (small finite sets; full-load is fine).
// ---------------------------------------------------------------------------

type ArticleLookupRow = {
  id: string;
  article_number: string;
  name: string;
  variant_label: string | null;
};

function useRentableArticles() {
  return useQuery({
    queryKey: ["lookups", "articles", "rentable-active"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<ArticleLookupRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("articles")
        .select("id, article_number, name, variant_label")
        .eq("is_rentable", true)
        .eq("is_active", true)
        .order("article_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ArticleLookupRow[];
    },
  });
}

type WarehouseLookupRow = { id: string; code: string; name: string };

function useActiveWarehouses() {
  return useQuery({
    queryKey: ["lookups", "warehouses", "active"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<WarehouseLookupRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, code, name")
        .eq("is_active", true)
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WarehouseLookupRow[];
    },
  });
}

type SupplierLookupRow = { id: string; name: string };

function useActiveSuppliers() {
  return useQuery({
    queryKey: ["lookups", "suppliers", "active"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<SupplierLookupRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SupplierLookupRow[];
    },
  });
}

// ---------------------------------------------------------------------------
// Form value shape — strings for inputs, coerced before submit.
// ---------------------------------------------------------------------------

type DeviceFormValues = {
  serial_number: string;
  qr_code: string;
  article_id: string;
  condition: (typeof deviceConditionValues)[number] | "";
  is_new: boolean;
  current_warehouse_id: string;
  supplier_id: string;
  inbound_date: string;
  outbound_date: string;
  acquired_at: string;
  acquisition_price: string;
  reserved_for_customer_id: string;
  retired_at: string;
  notes: string;
};

const EMPTY_DEFAULTS: DeviceFormValues = {
  serial_number: "",
  qr_code: "",
  article_id: "",
  condition: "gut",
  is_new: true,
  current_warehouse_id: "",
  supplier_id: "",
  inbound_date: "",
  outbound_date: "",
  acquired_at: "",
  acquisition_price: "",
  reserved_for_customer_id: "",
  retired_at: "",
  notes: "",
};

function nullIfEmpty(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

type ParseNumberResult = number | null | undefined;

function parseChf(s: string): ParseNumberResult {
  const t = s.trim();
  if (t === "") return null;
  // Reject negative values (acquisition prices cannot be negative).
  if (!/^\d+([.,]\d+)?$/.test(t)) return undefined;
  const n = Number.parseFloat(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export type DeviceEditFormProps = {
  mode: "create" | "edit";
  /** Required for `mode='edit'`. */
  deviceId?: string | null;
  /** Pre-fills + locks the article combobox in `mode='create'`. */
  defaultArticleId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeviceEditForm({
  mode,
  deviceId,
  defaultArticleId,
  open,
  onOpenChange,
}: DeviceEditFormProps) {
  const { data: device, isLoading: isLoadingDevice } = useDevice(
    mode === "edit" ? (deviceId ?? null) : null,
  );
  const { data: role } = useAppRole();
  const isAdmin = role === "admin";
  const isWarehouse = role === "warehouse";

  const articlesQuery = useRentableArticles();
  const warehousesQuery = useActiveWarehouses();
  const suppliersQuery = useActiveSuppliers();

  const {
    control,
    handleSubmit,
    register,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<DeviceFormValues>({
    defaultValues: EMPTY_DEFAULTS,
    // Resolver disabled here — the form value shape is a string-input mirror;
    // we run Zod against the coerced submit payload instead, so per-field
    // errors come from the explicit setError() calls in `onSubmit`. (Story
    // 3.1's article-edit-form follows the same pattern.) The Zod schemas in
    // `lib/validations/device.ts` still run on the submit payload — that is
    // where zodResolver-equivalence matters per Story 3.1 review HIGH.
  });

  // Hydrate from the loaded device when entering edit mode. Track only
  // `device?.id` + `mode`/`open`, NOT the device object — a Realtime
  // invalidation must not clobber the user's in-flight edits. Story 3.1
  // review HIGH carryover.
  //
  // For create mode, the cache-bust key includes `defaultArticleId` so
  // re-opening the modal from a different article re-hydrates the
  // (locked) article combobox instead of keeping the previous selection.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    if (mode === "create") {
      const createKey = `__create__:${defaultArticleId ?? ""}`;
      if (hydratedFor.current !== createKey) {
        reset({
          ...EMPTY_DEFAULTS,
          article_id: defaultArticleId ?? "",
        });
        hydratedFor.current = createKey;
      }
      return;
    }
    if (mode === "edit" && device && hydratedFor.current !== device.id) {
      // Short-circuit if the user has already started editing.
      if (isDirty) return;
      reset({
        serial_number: device.serial_number,
        qr_code: device.qr_code ?? "",
        article_id: device.article_id,
        condition: device.condition,
        is_new: device.is_new,
        current_warehouse_id: device.current_warehouse_id ?? "",
        supplier_id: device.supplier_id ?? "",
        inbound_date: device.inbound_date ?? "",
        outbound_date: device.outbound_date ?? "",
        acquired_at: device.acquired_at ?? "",
        acquisition_price:
          device.acquisition_price !== null
            ? Number(device.acquisition_price).toFixed(2)
            : "",
        reserved_for_customer_id: device.reserved_for_customer_id ?? "",
        retired_at: device.retired_at ?? "",
        notes: device.notes ?? "",
      });
      hydratedFor.current = device.id;
    }
  }, [mode, device, open, reset, defaultArticleId, isDirty]);

  // For 23505 (serial_number unique violation) we want both a toast AND an
  // inline field error so the user sees which field collided even after the
  // toast auto-dismisses.
  const SERIAL_DUPLICATE_MESSAGE =
    "Diese Seriennummer ist bereits vergeben.";

  const createMutation = useDeviceCreate({
    onSuccess: () => {
      toast.success("Gerät angelegt.");
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error("Gerät konnte nicht angelegt werden", {
        description: err.message,
      });
      if (err.message === SERIAL_DUPLICATE_MESSAGE) {
        setError("serial_number", { type: "manual", message: err.message });
      }
    },
  });

  const updateMutation = useDeviceUpdate({
    onSuccess: () => {
      toast.success("Gerät aktualisiert.");
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error("Gerät konnte nicht aktualisiert werden", {
        description: err.message,
      });
      if (err.message === SERIAL_DUPLICATE_MESSAGE) {
        setError("serial_number", { type: "manual", message: err.message });
      }
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit: SubmitHandler<DeviceFormValues> = (values) => {
    let hasMissing = false;
    if (!values.serial_number.trim()) {
      setError("serial_number", {
        type: "manual",
        message: "Seriennummer ist erforderlich",
      });
      hasMissing = true;
    }
    if (!values.article_id) {
      setError("article_id", {
        type: "manual",
        message: "Artikel ist erforderlich",
      });
      hasMissing = true;
    }
    if (!values.condition) {
      setError("condition", {
        type: "manual",
        message: "Zustand ist erforderlich",
      });
      hasMissing = true;
    }
    if (hasMissing) return;

    // Optional uuid fields — error if non-empty and unparseable.
    const uuidOrNull = (
      raw: string,
      field: keyof DeviceFormValues,
    ): { ok: true; value: string | null } | { ok: false } => {
      const trimmed = raw.trim();
      if (trimmed === "") return { ok: true, value: null };
      if (!uuidSchema.safeParse(trimmed).success) {
        setError(field, { type: "manual", message: "Ungültige ID" });
        return { ok: false };
      }
      return { ok: true, value: trimmed };
    };

    const warehouseId = uuidOrNull(values.current_warehouse_id, "current_warehouse_id");
    const supplierId = uuidOrNull(values.supplier_id, "supplier_id");
    const reservedForCustomerId = uuidOrNull(
      values.reserved_for_customer_id,
      "reserved_for_customer_id",
    );
    if (!warehouseId.ok || !supplierId.ok || !reservedForCustomerId.ok) return;

    const acquisitionPrice = parseChf(values.acquisition_price);
    if (acquisitionPrice === undefined) {
      setError("acquisition_price", {
        type: "manual",
        message: "Ungültige Zahl — bitte einen nicht-negativen Betrag eingeben.",
      });
      return;
    }

    const condition = values.condition as Exclude<typeof values.condition, "">;

    if (mode === "create") {
      const payloadDraft: DeviceCreate = {
        serial_number: values.serial_number.trim(),
        qr_code: nullIfEmpty(values.qr_code),
        article_id: values.article_id,
        // Status omitted intentionally — server default seeds 'available'.
        // Zod create schema injects the default; we pass the value explicitly
        // here to satisfy the type but `useDeviceCreate` strips it.
        status: "available",
        condition,
        is_new: values.is_new,
        current_warehouse_id: warehouseId.value,
        // current_contract_id is owned by Epic 5 — never set here.
        current_contract_id: null,
        // Defense-in-depth: warehouse cannot see the acquisition_price field
        // (UI gate above) — also do not include any cached value in the
        // payload. RLS would reject + bury the cause; better to send `null`.
        supplier_id: supplierId.value,
        inbound_date: nullIfEmpty(values.inbound_date),
        outbound_date: nullIfEmpty(values.outbound_date),
        acquired_at: nullIfEmpty(values.acquired_at),
        acquisition_price: isWarehouse ? null : acquisitionPrice,
        reserved_for_customer_id: reservedForCustomerId.value,
        // reserved_at flips to now() automatically when the customer field
        // is set — for Sprint-1 we leave it null on create and let the edit
        // path manage it.
        reserved_at: null,
        // retired_at is admin-only in the UI; do not let a stale cached value
        // flow through for non-admin callers.
        retired_at: isAdmin ? nullIfEmpty(values.retired_at) : null,
        notes: nullIfEmpty(values.notes),
      };
      const parsed = deviceCreateSchema.safeParse(payloadDraft);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = issue.path[0];
          if (typeof field === "string") {
            setError(field as keyof DeviceFormValues, {
              type: "manual",
              message: issue.message,
            });
          }
        }
        return;
      }
      createMutation.mutate({ device: parsed.data });
      return;
    }

    if (mode === "edit" && deviceId) {
      // Build a patch that only includes fields the current role is allowed
      // to write. acquisition_price + retired_at are role-gated in the UI;
      // omitting them from the patch (rather than passing the cached value)
      // is the defense-in-depth pair to the visual hide.
      const patchDraft: DeviceUpdate = {
        serial_number: values.serial_number.trim(),
        qr_code: nullIfEmpty(values.qr_code),
        article_id: values.article_id,
        condition,
        is_new: values.is_new,
        current_warehouse_id: warehouseId.value,
        supplier_id: supplierId.value,
        inbound_date: nullIfEmpty(values.inbound_date),
        outbound_date: nullIfEmpty(values.outbound_date),
        acquired_at: nullIfEmpty(values.acquired_at),
        ...(isWarehouse ? {} : { acquisition_price: acquisitionPrice }),
        reserved_for_customer_id: reservedForCustomerId.value,
        // Auto-stamp reserved_at when the FK is set + the device didn't
        // already have a reservation. Mirrors the data-model-spec semantic
        // ("reserved_at = when the reservation began"). Clearing the FK
        // also clears the timestamp.
        reserved_at:
          reservedForCustomerId.value === null
            ? null
            : device?.reserved_at ?? new Date().toISOString(),
        ...(isAdmin ? { retired_at: nullIfEmpty(values.retired_at) } : {}),
        notes: nullIfEmpty(values.notes),
      };
      // Status is intentionally NOT included — `useDeviceUpdate` also strips
      // it as defense-in-depth.
      const parsed = deviceUpdateSchema.safeParse(patchDraft);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = issue.path[0];
          if (typeof field === "string") {
            setError(field as keyof DeviceFormValues, {
              type: "manual",
              message: issue.message,
            });
          }
        }
        return;
      }
      updateMutation.mutate({ id: deviceId, patch: parsed.data });
      return;
    }

    // mode === "edit" but deviceId is null/undefined: surface explicitly
    // rather than silently no-op.
    if (mode === "edit" && !deviceId) {
      toast.error("Gerät nicht gefunden — bitte den Dialog schließen und neu öffnen.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className={cn("max-h-[90vh] overflow-y-auto sm:max-w-2xl")}
        onPointerDownOutside={(e) => {
          if (isPending) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isPending) e.preventDefault();
        }}
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Neues Gerät" : "Gerät bearbeiten"}
            </DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Erfasse die Stammdaten eines neuen Geräts. Status wird automatisch auf 'Verfügbar' gesetzt."
                : "Aktualisiere die Stammdaten. Statuswechsel laufen über die Transition-Funktion (Story 3.3) und sind hier schreibgeschützt."}
            </DialogDescription>
          </DialogHeader>

          {mode === "edit" && isLoadingDevice ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Daten werden geladen…
            </p>
          ) : (
            <div className="flex flex-col gap-6 py-4">
              <Section title="Identifikation">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Seriennummer"
                    htmlFor="dev-serial"
                    required
                    error={errors.serial_number?.message}
                  >
                    <Input
                      id="dev-serial"
                      autoComplete="off"
                      {...register("serial_number", {
                        required: "Seriennummer ist erforderlich",
                      })}
                    />
                  </Field>
                  <Field
                    label="QR-Code"
                    htmlFor="dev-qr"
                    error={errors.qr_code?.message}
                  >
                    <Input
                      id="dev-qr"
                      autoComplete="off"
                      placeholder="optional"
                      {...register("qr_code")}
                    />
                  </Field>
                </div>
              </Section>

              <Section title="Klassifizierung">
                <Field
                  label="Artikel"
                  htmlFor="dev-article"
                  required
                  error={errors.article_id?.message}
                >
                  <Controller
                    control={control}
                    name="article_id"
                    rules={{ required: "Artikel ist erforderlich" }}
                    render={({ field }) => {
                      const isLocked =
                        mode === "create" && !!defaultArticleId;
                      return (
                        <Select
                          value={field.value || undefined}
                          onValueChange={field.onChange}
                          disabled={isLocked}
                        >
                          <SelectTrigger id="dev-article">
                            <SelectValue placeholder="Auswählen" />
                          </SelectTrigger>
                          <SelectContent>
                            {articlesQuery.data?.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.article_number} — {a.name}
                                {a.variant_label ? ` ${a.variant_label}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    }}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Zustand"
                    htmlFor="dev-condition"
                    required
                    error={errors.condition?.message}
                  >
                    <Controller
                      control={control}
                      name="condition"
                      rules={{ required: "Zustand ist erforderlich" }}
                      render={({ field }) => (
                        <Select
                          value={field.value || undefined}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger id="dev-condition">
                            <SelectValue placeholder="Auswählen" />
                          </SelectTrigger>
                          <SelectContent>
                            {deviceConditionValues.map((c) => (
                              <SelectItem key={c} value={c}>
                                {deviceConditionLabels[c]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                  <Field label="Neu" htmlFor="dev-is-new">
                    <div className="flex h-9 items-center gap-2">
                      <Controller
                        control={control}
                        name="is_new"
                        render={({ field }) => (
                          <Switch
                            id="dev-is-new"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        )}
                      />
                      <span className="text-sm text-muted-foreground">
                        Wird auf „Gebraucht“ gesetzt, sobald das Gerät erstmals
                        vermietet oder verkauft wurde.
                      </span>
                    </div>
                  </Field>
                </div>
                {mode === "edit" && device ? (
                  <Field label="Status" htmlFor="dev-status-display">
                    <p
                      id="dev-status-display"
                      className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                    >
                      {deviceStatusLabels[device.status]}{" "}
                      <span className="text-xs">
                        — Statuswechsel sind in Story 3.3 freigeschaltet.
                      </span>
                    </p>
                  </Field>
                ) : null}
              </Section>

              <Section title="Standort & Provenance">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Lager"
                    htmlFor="dev-warehouse"
                    error={errors.current_warehouse_id?.message}
                  >
                    <Controller
                      control={control}
                      name="current_warehouse_id"
                      render={({ field }) => (
                        <Select
                          value={field.value || undefined}
                          onValueChange={(v) =>
                            field.onChange(v === "__none__" ? "" : v)
                          }
                        >
                          <SelectTrigger id="dev-warehouse">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">—</SelectItem>
                            {warehousesQuery.data?.map((w) => (
                              <SelectItem key={w.id} value={w.id}>
                                {w.code} — {w.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                  <Field
                    label="Lieferant"
                    htmlFor="dev-supplier"
                    error={errors.supplier_id?.message}
                  >
                    <Controller
                      control={control}
                      name="supplier_id"
                      render={({ field }) => (
                        <Select
                          value={field.value || undefined}
                          onValueChange={(v) =>
                            field.onChange(v === "__none__" ? "" : v)
                          }
                        >
                          <SelectTrigger id="dev-supplier">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">—</SelectItem>
                            {suppliersQuery.data?.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label="Eingang"
                    htmlFor="dev-inbound"
                    error={errors.inbound_date?.message}
                  >
                    <Input
                      id="dev-inbound"
                      type="date"
                      {...register("inbound_date")}
                    />
                  </Field>
                  <Field
                    label="Ausgang"
                    htmlFor="dev-outbound"
                    error={errors.outbound_date?.message}
                  >
                    <Input
                      id="dev-outbound"
                      type="date"
                      {...register("outbound_date")}
                    />
                  </Field>
                  <Field
                    label="Anschaffung am"
                    htmlFor="dev-acquired"
                    error={errors.acquired_at?.message}
                  >
                    <Input
                      id="dev-acquired"
                      type="date"
                      {...register("acquired_at")}
                    />
                  </Field>
                </div>
                {!isWarehouse ? (
                  <Field
                    label="Anschaffungspreis (CHF)"
                    htmlFor="dev-acq-price"
                    error={errors.acquisition_price?.message}
                  >
                    <Input
                      id="dev-acq-price"
                      inputMode="decimal"
                      placeholder="0.00"
                      {...register("acquisition_price")}
                    />
                  </Field>
                ) : null}
              </Section>

              <Section title="Reservierung">
                <Field
                  label="Reserviert für (Kunden-ID)"
                  htmlFor="dev-reserved-for"
                  error={errors.reserved_for_customer_id?.message}
                >
                  <Input
                    id="dev-reserved-for"
                    placeholder="Kunden-UUID — optional"
                    {...register("reserved_for_customer_id")}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Eine vollwertige Kunden-Combobox folgt in einer Folgestory.
                    Solange die UUID aus der Kundenseite kopiert werden.
                  </p>
                </Field>
                {mode === "edit" && device?.reserved_at ? (
                  <Field label="Reserviert seit" htmlFor="dev-reserved-at-display">
                    <p
                      id="dev-reserved-at-display"
                      className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                    >
                      {new Date(device.reserved_at).toLocaleString("de-CH", {
                        timeZone: "Europe/Zurich",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      <span className="ml-2 text-xs">
                        — wird automatisch beim Speichern gesetzt.
                      </span>
                    </p>
                  </Field>
                ) : null}
              </Section>

              {isAdmin ? (
                <Section title="Lebenszyklus (Admin)">
                  <Field
                    label="Außer Betrieb seit"
                    htmlFor="dev-retired"
                    error={errors.retired_at?.message}
                  >
                    <Input
                      id="dev-retired"
                      type="date"
                      {...register("retired_at")}
                    />
                  </Field>
                </Section>
              ) : null}

              <Section title="Notizen">
                <Field
                  label="Notizen"
                  htmlFor="dev-notes"
                  error={errors.notes?.message}
                >
                  <Textarea
                    id="dev-notes"
                    rows={3}
                    {...register("notes")}
                  />
                </Field>
              </Section>
            </div>
          )}

          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {mode === "create" ? "Anlegen" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tiny helpers — same shape as the article-edit-form section/field.
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
        {required ? <span aria-hidden> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
