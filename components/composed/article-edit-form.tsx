"use client";

import { useEffect, useRef } from "react";
import { Controller, useForm, type SubmitHandler } from "react-hook-form";
import { Loader2 } from "lucide-react";
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
  articleCategoryLabels,
  articleTypeLabels,
  articleUnitLabels,
  articleVatRateLabels,
  priceListNameLabels,
  PRICE_LIST_DISPLAY_ORDER,
} from "@/lib/constants/article";
import { useAppRole } from "@/lib/hooks/use-app-role";
import {
  useArticle,
  useCreateArticle,
  useUpdateArticle,
} from "@/lib/queries/articles";
import {
  articleCategoryValues,
  articleCreateSchema,
  articleTypeValues,
  articleUnitValues,
  articleUpdateSchema,
  articleVatRateValues,
  type ArticleCreate,
  type ArticleUpdate,
} from "@/lib/validations/article";
import { cn } from "@/lib/utils";

export type ArticleEditFormMode = "create" | "edit";

export type ArticleEditFormProps = {
  mode: ArticleEditFormMode;
  /** Required for `mode='edit'`. */
  articleId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Form-shape values — strings for inputs, then coerced before submit.
type ArticleFormValues = {
  article_number: string;
  name: string;
  description: string;
  category: (typeof articleCategoryValues)[number] | "";
  type: (typeof articleTypeValues)[number] | "";
  is_rentable: boolean;
  is_sellable: boolean;
  vat_rate: (typeof articleVatRateValues)[number];
  unit: (typeof articleUnitValues)[number] | "";
  manufacturer: string;
  manufacturer_ref: string;
  weight_kg: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  purchase_price: string;
  min_stock: string;
  critical_stock: string;
  variant_label: string;
  bexio_article_id: string;
  notes: string;
  is_active: boolean;
  // Price-list inputs (create mode only). Strings for raw input; empty-string
  // entries are silently skipped in the create RPC payload.
  price_private: string;
  price_helsana: string;
  price_sanitas: string;
  price_visana: string;
  price_kpt: string;
};

const EMPTY_DEFAULTS: ArticleFormValues = {
  article_number: "",
  name: "",
  description: "",
  category: "",
  type: "physical",
  is_rentable: false,
  is_sellable: true,
  vat_rate: "standard",
  unit: "",
  manufacturer: "",
  manufacturer_ref: "",
  weight_kg: "",
  length_cm: "",
  width_cm: "",
  height_cm: "",
  purchase_price: "",
  min_stock: "",
  critical_stock: "",
  variant_label: "",
  bexio_article_id: "",
  notes: "",
  is_active: true,
  price_private: "",
  price_helsana: "",
  price_sanitas: "",
  price_visana: "",
  price_kpt: "",
};

function nullIfEmpty(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

// Strict numeric parsers — return `undefined` on a non-empty but unparseable
// string so the caller can attach a per-field error. Empty input returns null
// (the canonical "no value" representation in the DB and Zod schemas).
type ParseNumberResult = number | null | undefined;

function parseNumber(s: string): ParseNumberResult {
  const t = s.trim();
  if (t === "") return null;
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return undefined;
  const n = Number.parseFloat(t.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function parseInteger(s: string): ParseNumberResult {
  const t = s.trim();
  if (t === "") return null;
  if (!/^-?\d+$/.test(t)) return undefined;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function ArticleEditForm({
  mode,
  articleId,
  open,
  onOpenChange,
}: ArticleEditFormProps) {
  const { data: article, isLoading: isLoadingArticle } = useArticle(
    mode === "edit" ? (articleId ?? null) : null,
  );
  const { data: role } = useAppRole();
  const isAdmin = role === "admin";

  const {
    control,
    handleSubmit,
    register,
    reset,
    setError,
    setValue,
    watch,
    clearErrors,
    formState: { errors, isDirty },
  } = useForm<ArticleFormValues>({
    defaultValues: EMPTY_DEFAULTS,
  });

  // Hydrate form from the loaded article when entering edit mode. Track only
  // `article?.id` (and `mode`/`open`), NOT the article object itself — a
  // Realtime invalidation would otherwise re-fire `reset()` and clobber the
  // user's in-flight edits. Once hydrated for a given (id), subsequent
  // refetches for the same id leave the form alone.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    if (mode === "create") {
      if (hydratedFor.current !== "__create__") {
        reset(EMPTY_DEFAULTS);
        hydratedFor.current = "__create__";
      }
      return;
    }
    if (mode === "edit" && article && hydratedFor.current !== article.id) {
      reset({
        article_number: article.article_number,
        name: article.name,
        description: article.description ?? "",
        category: article.category,
        type: article.type,
        is_rentable: article.is_rentable,
        is_sellable: article.is_sellable,
        vat_rate: article.vat_rate,
        unit: article.unit,
        manufacturer: article.manufacturer ?? "",
        manufacturer_ref: article.manufacturer_ref ?? "",
        // Numeric fields hydrate via Number()→toFixed for two-decimal stability
        // (PostgREST serialises numeric as string; round-tripping a raw string
        // can flip isDirty on a no-op refetch).
        weight_kg:
          article.weight_kg !== null ? Number(article.weight_kg).toString() : "",
        length_cm: article.length_cm !== null ? String(article.length_cm) : "",
        width_cm: article.width_cm !== null ? String(article.width_cm) : "",
        height_cm: article.height_cm !== null ? String(article.height_cm) : "",
        purchase_price:
          article.purchase_price !== null
            ? Number(article.purchase_price).toFixed(2)
            : "",
        min_stock: article.min_stock !== null ? String(article.min_stock) : "",
        critical_stock:
          article.critical_stock !== null ? String(article.critical_stock) : "",
        variant_label: article.variant_label ?? "",
        bexio_article_id:
          article.bexio_article_id !== null ? String(article.bexio_article_id) : "",
        notes: article.notes ?? "",
        is_active: article.is_active,
        // Edit mode never exposes price inputs in the form (managed via
        // <PriceListCard> + <PriceListEditDialog> to avoid GIST races).
        price_private: "",
        price_helsana: "",
        price_sanitas: "",
        price_visana: "",
        price_kpt: "",
      });
      hydratedFor.current = article.id;
    }
  }, [mode, article, open, reset]);

  const watchType = watch("type");
  const watchIsRentable = watch("is_rentable");
  const watchIsSellable = watch("is_sellable");
  const isPhysical = watchType === "physical";
  const isService = watchType === "service";

  // When the user toggles `type`, normalise the cross-column flag state so
  // hidden fields don't carry stale truthy values into the submit payload
  // (Edge Case Hunter findings 6/7/8). On `service` both flags clear and the
  // stock fields (rental-only) clear. On `physical` ensure at least one flag
  // is true — default to `is_sellable=true` if both are off.
  useEffect(() => {
    if (watchType === "service") {
      if (watchIsRentable) setValue("is_rentable", false, { shouldDirty: false });
      if (watchIsSellable) setValue("is_sellable", false, { shouldDirty: false });
      setValue("min_stock", "", { shouldDirty: false });
      setValue("critical_stock", "", { shouldDirty: false });
    }
    if (watchType === "physical" && !watchIsRentable && !watchIsSellable) {
      setValue("is_sellable", true, { shouldDirty: false });
    }
    if (watchType !== "service" && !watchIsRentable) {
      // Stock fields are rental-only — clear when rentable=false.
      setValue("min_stock", "", { shouldDirty: false });
      setValue("critical_stock", "", { shouldDirty: false });
    }
  }, [watchType, watchIsRentable, watchIsSellable, setValue]);

  const createMutation = useCreateArticle({
    onSuccess: () => {
      toast.success("Artikel angelegt.");
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error("Artikel konnte nicht angelegt werden", {
        description: err.message,
      });
    },
  });

  const updateMutation = useUpdateArticle({
    onSuccess: () => {
      toast.success("Artikel aktualisiert.");
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error("Artikel konnte nicht aktualisiert werden", {
        description: err.message,
      });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Coerce a numeric form input. If the input is a non-empty unparseable
  // string, attach a "Ungültige Zahl" error to the named field and signal
  // failure to the caller via a sentinel.
  const coerceOrError = (
    raw: string,
    fieldName: keyof ArticleFormValues,
    parser: (s: string) => ParseNumberResult,
  ): { ok: true; value: number | null } | { ok: false } => {
    const result = parser(raw);
    if (result === undefined) {
      setError(fieldName, { type: "manual", message: "Ungültige Zahl" });
      return { ok: false };
    }
    return { ok: true, value: result };
  };

  const onSubmit: SubmitHandler<ArticleFormValues> = (values) => {
    clearErrors();

    // Pflichtfelder zuerst — required Selects use empty-string sentinel.
    let hasMissing = false;
    if (!values.category) {
      setError("category", { type: "manual", message: "Kategorie ist erforderlich" });
      hasMissing = true;
    }
    if (!values.type) {
      setError("type", { type: "manual", message: "Typ ist erforderlich" });
      hasMissing = true;
    }
    if (!values.unit) {
      setError("unit", { type: "manual", message: "Einheit ist erforderlich" });
      hasMissing = true;
    }
    if (hasMissing) return;

    // Coerce numeric form fields. Each call may attach a per-field error.
    const weightKg = coerceOrError(values.weight_kg, "weight_kg", parseNumber);
    const lengthCm = coerceOrError(values.length_cm, "length_cm", parseInteger);
    const widthCm = coerceOrError(values.width_cm, "width_cm", parseInteger);
    const heightCm = coerceOrError(values.height_cm, "height_cm", parseInteger);
    const purchasePrice = coerceOrError(
      values.purchase_price,
      "purchase_price",
      parseNumber,
    );
    const minStock = coerceOrError(values.min_stock, "min_stock", parseInteger);
    const criticalStock = coerceOrError(
      values.critical_stock,
      "critical_stock",
      parseInteger,
    );
    const bexioArticleId = coerceOrError(
      values.bexio_article_id,
      "bexio_article_id",
      parseInteger,
    );
    const pricePrivate = coerceOrError(values.price_private, "price_private", parseNumber);
    const priceHelsana = coerceOrError(values.price_helsana, "price_helsana", parseNumber);
    const priceSanitas = coerceOrError(values.price_sanitas, "price_sanitas", parseNumber);
    const priceVisana = coerceOrError(values.price_visana, "price_visana", parseNumber);
    const priceKpt = coerceOrError(values.price_kpt, "price_kpt", parseNumber);

    if (
      !weightKg.ok || !lengthCm.ok || !widthCm.ok || !heightCm.ok
      || !purchasePrice.ok || !minStock.ok || !criticalStock.ok
      || !bexioArticleId.ok
      || !pricePrivate.ok || !priceHelsana.ok || !priceSanitas.ok
      || !priceVisana.ok || !priceKpt.ok
    ) {
      return;
    }

    // The early-return on `hasMissing` already guarantees these are
    // non-empty enum values, but TypeScript can't narrow through the
    // imperative branch — re-assert at the boundary so the create/update
    // payload type-checks without `as any`.
    const category = values.category as Exclude<typeof values.category, "">;
    const type = values.type as Exclude<typeof values.type, "">;
    const unit = values.unit as Exclude<typeof values.unit, "">;

    if (mode === "create") {
      const articlePayload: ArticleCreate = {
        article_number: values.article_number.trim(),
        name: values.name.trim(),
        description: nullIfEmpty(values.description),
        category,
        type,
        is_rentable: values.is_rentable,
        is_sellable: values.is_sellable,
        vat_rate: values.vat_rate,
        unit,
        // variant_of_id UI deferred to Story 3.1.1 — see _bmad-output/implementation-artifacts/deferred-work.md
        variant_of_id: null,
        variant_label: nullIfEmpty(values.variant_label),
        manufacturer: nullIfEmpty(values.manufacturer),
        manufacturer_ref: nullIfEmpty(values.manufacturer_ref),
        weight_kg: weightKg.value,
        length_cm: lengthCm.value,
        width_cm: widthCm.value,
        height_cm: heightCm.value,
        purchase_price: purchasePrice.value,
        min_stock: minStock.value,
        critical_stock: criticalStock.value,
        is_active: values.is_active,
        bexio_article_id: bexioArticleId.value,
        notes: nullIfEmpty(values.notes),
      };

      const parsed = articleCreateSchema.safeParse(articlePayload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = issue.path[0];
          if (typeof field === "string") {
            setError(field as keyof ArticleFormValues, {
              type: "manual",
              message: issue.message,
            });
          }
        }
        return;
      }

      const prices = [
        { list_name: "private" as const, amount: pricePrivate.value },
        { list_name: "helsana" as const, amount: priceHelsana.value },
        { list_name: "sanitas" as const, amount: priceSanitas.value },
        { list_name: "visana" as const, amount: priceVisana.value },
        { list_name: "kpt" as const, amount: priceKpt.value },
      ];
      createMutation.mutate({ article: parsed.data, prices });
      return;
    }

    if (mode === "edit" && articleId) {
      const patch: ArticleUpdate = {
        article_number: values.article_number.trim(),
        name: values.name.trim(),
        description: nullIfEmpty(values.description),
        category,
        type,
        is_rentable: values.is_rentable,
        is_sellable: values.is_sellable,
        vat_rate: values.vat_rate,
        unit,
        variant_label: nullIfEmpty(values.variant_label),
        manufacturer: nullIfEmpty(values.manufacturer),
        manufacturer_ref: nullIfEmpty(values.manufacturer_ref),
        weight_kg: weightKg.value,
        length_cm: lengthCm.value,
        width_cm: widthCm.value,
        height_cm: heightCm.value,
        purchase_price: purchasePrice.value,
        min_stock: minStock.value,
        critical_stock: criticalStock.value,
        is_active: values.is_active,
        bexio_article_id: bexioArticleId.value,
        notes: nullIfEmpty(values.notes),
      };

      const parsed = articleUpdateSchema.safeParse(patch);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = issue.path[0];
          if (typeof field === "string") {
            setError(field as keyof ArticleFormValues, {
              type: "manual",
              message: issue.message,
            });
          }
        }
        return;
      }
      updateMutation.mutate({ id: articleId, patch: parsed.data });
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
        className={cn(
          "max-h-[90vh] overflow-y-auto sm:max-w-2xl",
        )}
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
              {mode === "create" ? "Neuer Artikel" : "Artikel bearbeiten"}
            </DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Erfasse die Artikelstammdaten. Preislisten können direkt mit angelegt oder später separat gepflegt werden."
                : "Aktualisiere die Artikelstammdaten. Preise werden über die Preislisten-Karte separat verwaltet."}
            </DialogDescription>
          </DialogHeader>

          {mode === "edit" && isLoadingArticle ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Daten werden geladen…
            </p>
          ) : (
            <div className="flex flex-col gap-6 py-4">
              {/* Basis */}
              <Section title="Basis">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Artikelnummer"
                    htmlFor="art-number"
                    required
                    error={errors.article_number?.message}
                  >
                    <Input
                      id="art-number"
                      {...register("article_number", {
                        required: "Artikelnummer ist erforderlich",
                      })}
                      autoComplete="off"
                    />
                  </Field>
                  <Field
                    label="Name"
                    htmlFor="art-name"
                    required
                    error={errors.name?.message}
                  >
                    <Input
                      id="art-name"
                      {...register("name", { required: "Name ist erforderlich" })}
                    />
                  </Field>
                </div>
                <Field
                  label="Beschreibung"
                  htmlFor="art-description"
                >
                  <Textarea
                    id="art-description"
                    rows={2}
                    {...register("description")}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Hersteller" htmlFor="art-manufacturer">
                    <Input
                      id="art-manufacturer"
                      {...register("manufacturer")}
                    />
                  </Field>
                  <Field
                    label="Hersteller-Ref."
                    htmlFor="art-manufacturer-ref"
                  >
                    <Input
                      id="art-manufacturer-ref"
                      {...register("manufacturer_ref")}
                    />
                  </Field>
                </div>
                <Field
                  label="Variante"
                  htmlFor="art-variant-label"
                >
                  <Input
                    id="art-variant-label"
                    placeholder="z. B. 110cm, 120cm"
                    {...register("variant_label")}
                  />
                </Field>
              </Section>

              {/* Klassifizierung */}
              <Section title="Klassifizierung">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Kategorie"
                    htmlFor="art-category"
                    required
                    error={errors.category?.message}
                  >
                    <Controller
                      control={control}
                      name="category"
                      rules={{ required: "Kategorie ist erforderlich" }}
                      render={({ field }) => (
                        <Select
                          value={field.value || undefined}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger id="art-category">
                            <SelectValue placeholder="Auswählen" />
                          </SelectTrigger>
                          <SelectContent>
                            {articleCategoryValues.map((c) => (
                              <SelectItem key={c} value={c}>
                                {articleCategoryLabels[c]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                  <Field
                    label="Typ"
                    htmlFor="art-type"
                    required
                    error={errors.type?.message}
                  >
                    <Controller
                      control={control}
                      name="type"
                      rules={{ required: "Typ ist erforderlich" }}
                      render={({ field }) => (
                        <Select
                          value={field.value || undefined}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger id="art-type">
                            <SelectValue placeholder="Auswählen" />
                          </SelectTrigger>
                          <SelectContent>
                            {articleTypeValues.map((t) => (
                              <SelectItem key={t} value={t}>
                                {articleTypeLabels[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Controller
                    control={control}
                    name="is_rentable"
                    render={({ field }) => (
                      <SwitchRow
                        id="art-rentable"
                        label="Vermietbar"
                        checked={field.value}
                        onChange={field.onChange}
                        disabled={isService}
                        error={errors.is_rentable?.message}
                      />
                    )}
                  />
                  <Controller
                    control={control}
                    name="is_sellable"
                    render={({ field }) => (
                      <SwitchRow
                        id="art-sellable"
                        label="Verkaufbar"
                        checked={field.value}
                        onChange={field.onChange}
                        disabled={isService}
                      />
                    )}
                  />
                </div>
                <Field
                  label="Einheit"
                  htmlFor="art-unit"
                  required
                  error={errors.unit?.message}
                >
                  <Controller
                    control={control}
                    name="unit"
                    rules={{ required: "Einheit ist erforderlich" }}
                    render={({ field }) => (
                      <Select
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger id="art-unit">
                          <SelectValue placeholder="Auswählen" />
                        </SelectTrigger>
                        <SelectContent>
                          {articleUnitValues.map((u) => (
                            <SelectItem key={u} value={u}>
                              {articleUnitLabels[u]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </Section>

              {/* Maße & Gewicht — only physical */}
              {isPhysical ? (
                <Section title="Maße & Gewicht">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Gewicht (kg)" htmlFor="art-weight">
                      <Input
                        id="art-weight"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        {...register("weight_kg")}
                      />
                    </Field>
                    <Field label="Länge (cm)" htmlFor="art-length">
                      <Input
                        id="art-length"
                        type="number"
                        min={1}
                        step={1}
                        {...register("length_cm")}
                      />
                    </Field>
                    <Field label="Breite (cm)" htmlFor="art-width">
                      <Input
                        id="art-width"
                        type="number"
                        min={1}
                        step={1}
                        {...register("width_cm")}
                      />
                    </Field>
                    <Field label="Höhe (cm)" htmlFor="art-height">
                      <Input
                        id="art-height"
                        type="number"
                        min={1}
                        step={1}
                        {...register("height_cm")}
                      />
                    </Field>
                  </div>
                </Section>
              ) : null}

              {/* Bestand & Lager — only when rentable */}
              {watchIsRentable ? (
                <Section title="Bestand & Lager">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Min. Lager" htmlFor="art-min-stock">
                      <Input
                        id="art-min-stock"
                        type="number"
                        min={0}
                        step={1}
                        {...register("min_stock")}
                      />
                    </Field>
                    <Field label="Krit. Lager" htmlFor="art-critical-stock">
                      <Input
                        id="art-critical-stock"
                        type="number"
                        min={0}
                        step={1}
                        {...register("critical_stock")}
                      />
                    </Field>
                  </div>
                </Section>
              ) : null}

              {/* Preise & Steuern */}
              <Section title="Preise & Steuern">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Einkaufspreis (CHF)" htmlFor="art-purchase-price">
                    <Input
                      id="art-purchase-price"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      {...register("purchase_price")}
                    />
                  </Field>
                  <Field
                    label="MwSt"
                    htmlFor="art-vat"
                    required
                    error={errors.vat_rate?.message}
                  >
                    <Controller
                      control={control}
                      name="vat_rate"
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={(v) =>
                            field.onChange(
                              v as (typeof articleVatRateValues)[number],
                            )
                          }
                        >
                          <SelectTrigger id="art-vat">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {articleVatRateValues.map((v) => (
                              <SelectItem key={v} value={v}>
                                {articleVatRateLabels[v]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                </div>
              </Section>

              {/* Preislisten — create mode only */}
              {mode === "create" ? (
                <Section title="Preislisten (optional)">
                  <p className="text-xs text-muted-foreground">
                    Trage hier Startpreise ein. Leere Felder werden ignoriert.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {PRICE_LIST_DISPLAY_ORDER.map((listName) => {
                      const fieldName = `price_${listName}` as const;
                      return (
                        <Field
                          key={listName}
                          label={`${priceListNameLabels[listName]} (CHF)`}
                          htmlFor={`art-${fieldName}`}
                        >
                          <Input
                            id={`art-${fieldName}`}
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            {...register(fieldName)}
                          />
                        </Field>
                      );
                    })}
                  </div>
                </Section>
              ) : null}

              {/* Status & Notizen */}
              <Section title="Status & Notizen">
                <Controller
                  control={control}
                  name="is_active"
                  render={({ field }) => (
                    <SwitchRow
                      id="art-active"
                      label="Aktiv"
                      checked={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
                <Field label="Notizen" htmlFor="art-notes">
                  <Textarea id="art-notes" rows={3} {...register("notes")} />
                </Field>
                {isAdmin ? (
                  <Field label="bexio Artikel-ID" htmlFor="art-bexio-id">
                    <Input
                      id="art-bexio-id"
                      type="number"
                      min={1}
                      step={1}
                      {...register("bexio_article_id")}
                    />
                  </Field>
                ) : null}
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
            <Button type="submit" disabled={isPending || (mode === "edit" && !isDirty)}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Speichern…
                </>
              ) : mode === "create" ? (
                "Anlegen"
              ) : (
                "Speichern"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SectionProps = { title: string; children: React.ReactNode };

function Section({ title, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

type FieldProps = {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string | undefined;
  children: React.ReactNode;
};

function Field({ label, htmlFor, required, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
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

type SwitchRowProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  error?: string;
};

function SwitchRow({ id, label, checked, onChange, disabled, error }: SwitchRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
