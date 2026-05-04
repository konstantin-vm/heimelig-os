"use client";

// <BatchRegisterForm> — Story 3.6 / S-015 (no Pencil frame yet — UX-alignment
// follow-up story owns the design polish).
//
// Full-page form (NOT a modal — `<DeviceEditForm>` is the modal pattern).
// Wraps the SECURITY DEFINER RPC `public.batch_register_devices` (migration
// 00052) with role-gated input + a confirm-step for ≥ 20 device batches.
//
// Mirrors `<DeviceEditForm>` for:
//   * Inline `useQuery` lookups for articles / warehouses / suppliers
//     (small finite sets, full-load is cheap, 5 min staleTime).
//   * Section/Field helper shape.
//   * Role-gated `acquisition_price` input (warehouse hidden — matches the
//     server-side strip in the RPC).
//   * Sonner toast on success / error.
//
// Server-controlled fields (serial_number, qr_code, status='available',
// condition='gut', is_new=true) are NOT in this form — the RPC sets them.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

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
import { useAppRole } from "@/lib/hooks/use-app-role";
import { useBatchRegisterDevices } from "@/lib/queries/devices";
import { createClient } from "@/lib/supabase/client";
import {
  batchRegisterInputSchema,
  type BatchRegisterInput,
} from "@/lib/validations/device";
import { uuidSchema } from "@/lib/validations/common";
import { cn } from "@/lib/utils";

import { ConfirmDialog } from "./confirm-dialog";

// ---------------------------------------------------------------------------
// Lookup hooks — same staleTime + filter shape as DeviceEditForm's lookups so
// the cache slots are reused across both forms within a session.
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

type WarehouseLookupRow = {
  id: string;
  code: string;
  name: string;
  is_default_inbound: boolean;
};

function useActiveWarehouses() {
  return useQuery({
    queryKey: ["lookups", "warehouses", "active+default-inbound"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<WarehouseLookupRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, code, name, is_default_inbound")
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

// Client-side serial preview — purely informational. The server's advisory
// lock + MAX+1 counter is the truth; the success toast carries the actual
// range. This guess is what the user "would" get if they submitted right now.
function useSerialPreview(articleId: string | null) {
  return useQuery({
    queryKey: ["lookups", "devices", "next-serial-guess", articleId ?? "none"],
    enabled: !!articleId && uuidSchema.safeParse(articleId).success,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<{
      article_number: string;
      next_suffix: number;
    } | null> => {
      const supabase = createClient();
      // Pull the article number + the highest existing serial in one round-trip.
      const { data: article, error: articleError } = await supabase
        .from("articles")
        .select("article_number")
        .eq("id", articleId!)
        .single();
      if (articleError || !article) return null;

      // Pull all serial_numbers for this article and compute the numeric MAX
      // of the 5-digit suffix in JS — PostgREST's `.order(...desc).limit(1)`
      // returns the lexicographic max, which is wrong when the most-recent
      // MMYY is greater than the highest-suffix MMYY (e.g. `…-1124-00002`
      // sorts above `…-0526-00009`). Mirrors the server-side
      // `max((substring(serial_number from '\d{5}$'))::int)` exactly so the
      // preview matches the toast when the batch lands. Per-article rows
      // are bounded (<<1000 in practice for this catalog) so the full pull
      // is cheap; switch to a SECURITY INVOKER `peek_next_serial` RPC if
      // device counts grow beyond a few thousand per article.
      const { data: rows } = await supabase
        .from("devices")
        .select("serial_number")
        .eq("article_id", articleId!);

      let next = 1;
      if (rows && rows.length > 0) {
        const articleNumber = article.article_number as string;
        // Same `^{article_number}[MK]-\d{4}-\d{5}$` shape as the server.
        // Escape regex metacharacters in article_number so a value like
        // `10.32` doesn't wildcard-match unrelated rows.
        const escaped = articleNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`^${escaped}[MK]-\\d{4}-(\\d{5})$`);
        let maxSuffix = 0;
        for (const r of rows) {
          const match = re.exec((r.serial_number as string) ?? "");
          if (match?.[1]) {
            const n = parseInt(match[1], 10);
            if (n > maxSuffix) maxSuffix = n;
          }
        }
        next = maxSuffix + 1;
      }
      return { article_number: article.article_number as string, next_suffix: next };
    },
  });
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function todayCET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatMmyy(isoDate: string): string {
  // isoDate is YYYY-MM-DD. Returns MMYY.
  const m = isoDate.slice(5, 7);
  const y = isoDate.slice(2, 4);
  return `${m}${y}`;
}

const NONE = "__none__";

const CONFIRM_THRESHOLD = 20;

export type BatchRegisterFormProps = {
  preselectedArticleId: string | null;
};

export function BatchRegisterForm({
  preselectedArticleId,
}: BatchRegisterFormProps) {
  const router = useRouter();
  const { data: role } = useAppRole();
  const isWarehouse = role === "warehouse";
  const isAdminOrOffice = role === "admin" || role === "office";

  const articlesQuery = useRentableArticles();
  const warehousesQuery = useActiveWarehouses();
  const suppliersQuery = useActiveSuppliers();

  const today = todayCET();

  const defaultValues = useMemo<BatchRegisterInput>(
    () => ({
      article_id: preselectedArticleId ?? "",
      quantity: 10,
      current_warehouse_id: null,
      supplier_id: null,
      acquired_at: today,
      acquisition_price: null,
      inbound_date: today,
      notes: null,
    }),
    // `today` is stable for the lifetime of the page mount (CET date doesn't
    // change mid-session in any meaningful way for an entry form).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preselectedArticleId],
  );

  const {
    control,
    handleSubmit,
    register,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BatchRegisterInput>({
    resolver: zodResolver(batchRegisterInputSchema),
    defaultValues,
  });

  // Auto-select the default-inbound warehouse once the lookup resolves (only
  // if the user hasn't already picked one). Use `setValue` rather than
  // `reset` so a slow-loading warehouses query can't blow away the user's
  // unsaved input on `notes` / `quantity` mid-typing or steal focus.
  const watchedWarehouse = watch("current_warehouse_id");
  useEffect(() => {
    if (watchedWarehouse) return;
    const defaultRow = warehousesQuery.data?.find((w) => w.is_default_inbound);
    if (defaultRow) {
      setValue("current_warehouse_id", defaultRow.id, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
    // intentionally only depends on the lookup result + initial nullness
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehousesQuery.data]);

  const watchedArticle = watch("article_id");
  const watchedQuantity = watch("quantity");
  const watchedAcquired = watch("acquired_at");

  const previewQuery = useSerialPreview(watchedArticle || null);

  const previewLines = useMemo(() => {
    if (!previewQuery.data) return null;
    const qty = Number(watchedQuantity);
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) return null;
    const mmyy = formatMmyy(watchedAcquired || today);
    const first = previewQuery.data.next_suffix;
    const last = first + qty - 1;
    const fmt = (n: number) =>
      `${previewQuery.data!.article_number}M-${mmyy}-${String(n).padStart(5, "0")}`;
    return { first: fmt(first), last: fmt(last), count: qty };
  }, [previewQuery.data, watchedQuantity, watchedAcquired, today]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<BatchRegisterInput | null>(
    null,
  );

  const mutation = useBatchRegisterDevices({
    onSuccess: (devices, vars) => {
      if (devices.length === 0) {
        toast.error("Sammelregistrierung ergab keine Geräte.");
        return;
      }
      const first = devices[0]!.serial_number;
      const last = devices[devices.length - 1]!.serial_number;
      toast.success(
        `${devices.length} Geräte registriert: ${first} bis ${last}`,
      );
      router.push(`/articles/${vars.article_id}`);
    },
    onError: (err) => {
      toast.error("Sammelregistrierung fehlgeschlagen", {
        description: err.message,
      });
    },
  });

  const isPending = mutation.isPending;

  const onSubmit: SubmitHandler<BatchRegisterInput> = (values) => {
    // Defense-in-depth: warehouse callers' acquisition_price is also stripped
    // server-side inside the RPC, but null it here too so it never crosses
    // the network for non-privileged users.
    const sanitized: BatchRegisterInput = {
      ...values,
      acquisition_price: isWarehouse ? null : values.acquisition_price,
    };
    if (sanitized.quantity >= CONFIRM_THRESHOLD) {
      setPendingPayload(sanitized);
      setConfirmOpen(true);
      return;
    }
    mutation.mutate(sanitized);
  };

  // While the ConfirmDialog is open we lock the form region so the values
  // the user authorized in the dialog can't drift from the values the
  // mutation will fire — `pendingPayload` is the snapshot, but leaving
  // the form interactive let the on-screen state and the snapshot diverge
  // (review P8). The submit row is hidden while pending too — the dialog
  // owns the next action.
  const formLocked = pendingPayload !== null || isPending;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-6"
    >
      <fieldset
        disabled={formLocked}
        className="flex flex-col gap-6 disabled:opacity-60"
      >
      <Section title="Identifikation">
        <Field
          label="Artikel"
          htmlFor="batch-article"
          required
          error={errors.article_id?.message}
        >
          <Controller
            control={control}
            name="article_id"
            render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={field.onChange}
              >
                <SelectTrigger id="batch-article">
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
            )}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Nur vermietbare, aktive Artikel. Geräte werden mit Status
            „Verfügbar“, Zustand „Gut“ und Markierung „Neu“ angelegt.
          </p>
        </Field>

        <Field
          label="Anzahl"
          htmlFor="batch-quantity"
          required
          error={errors.quantity?.message}
        >
          <Input
            id="batch-quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            step={1}
            {...register("quantity", { valueAsNumber: true })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            1 bis 50 Geräte pro Sammelregistrierung. Größere Importe laufen
            über das Migrationswerkzeug (Story 9.1).
          </p>
        </Field>
      </Section>

      <Section title="Klassifizierung">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Lager"
            htmlFor="batch-warehouse"
            error={errors.current_warehouse_id?.message}
          >
            <Controller
              control={control}
              name="current_warehouse_id"
              render={({ field }) => (
                <Select
                  value={field.value ?? undefined}
                  onValueChange={(v) =>
                    field.onChange(v === NONE ? null : v)
                  }
                >
                  <SelectTrigger id="batch-warehouse">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
                    {warehousesQuery.data?.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.code} — {w.name}
                        {w.is_default_inbound ? " (Wareneingang)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field
            label="Lieferant"
            htmlFor="batch-supplier"
            error={errors.supplier_id?.message}
          >
            <Controller
              control={control}
              name="supplier_id"
              render={({ field }) => (
                <Select
                  value={field.value ?? undefined}
                  onValueChange={(v) =>
                    field.onChange(v === NONE ? null : v)
                  }
                >
                  <SelectTrigger id="batch-supplier">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
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
      </Section>

      <Section title="Provenance">
        <div
          className={cn(
            "grid gap-3",
            isAdminOrOffice ? "sm:grid-cols-3" : "sm:grid-cols-2",
          )}
        >
          <Field
            label="Eingangsdatum"
            htmlFor="batch-inbound"
            error={errors.inbound_date?.message}
          >
            <Input
              id="batch-inbound"
              type="date"
              max={today}
              {...register("inbound_date", {
                setValueAs: (v) => (v === "" ? null : v),
              })}
            />
          </Field>
          <Field
            label="Anschaffungsdatum"
            htmlFor="batch-acquired"
            error={errors.acquired_at?.message}
          >
            <Input
              id="batch-acquired"
              type="date"
              max={today}
              {...register("acquired_at", {
                setValueAs: (v) => (v === "" ? null : v),
              })}
            />
          </Field>
          {isAdminOrOffice ? (
            <Field
              label="Anschaffungspreis (CHF)"
              htmlFor="batch-acq-price"
              error={errors.acquisition_price?.message}
            >
              <Input
                id="batch-acq-price"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                placeholder="optional"
                {...register("acquisition_price", {
                  setValueAs: (v) =>
                    v === "" || v === null || v === undefined ? null : Number(v),
                })}
              />
            </Field>
          ) : null}
        </div>
      </Section>

      <Section title="Notizen">
        <Field
          label="Notizen (auf alle Geräte angewendet)"
          htmlFor="batch-notes"
          error={errors.notes?.message}
        >
          <Textarea
            id="batch-notes"
            rows={3}
            {...register("notes", {
              setValueAs: (v) => (typeof v === "string" && v.trim() === "" ? null : v),
            })}
          />
        </Field>
      </Section>

      {previewLines ? (
        <section
          aria-labelledby="batch-preview-heading"
          className="rounded-md border border-input bg-muted/40 p-4"
        >
          <h3
            id="batch-preview-heading"
            className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
          >
            Vorschau (Schätzung)
          </h3>
          <p className="mt-2 text-sm">
            {previewLines.count} Geräte werden mit Seriennummern{" "}
            <code className="rounded bg-background px-1 py-0.5 text-xs">
              {previewLines.first}
            </code>{" "}
            bis{" "}
            <code className="rounded bg-background px-1 py-0.5 text-xs">
              {previewLines.last}
            </code>{" "}
            angelegt. Die Vorschau ist eine Schätzung — die endgültigen
            Seriennummern werden serverseitig unter Sperre vergeben.
          </p>
        </section>
      ) : null}

      <div
        className={cn(
          "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
          // Mobile sticky-bottom for tablet warehouse workflows.
          "sticky bottom-0 -mx-4 border-t bg-background px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0",
        )}
      >
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            router.push(
              preselectedArticleId
                ? `/articles/${preselectedArticleId}`
                : "/articles",
            )
          }
          disabled={isPending}
        >
          Abbrechen
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : null}
          Sammelregistrierung anlegen
        </Button>
      </div>
      </fieldset>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPendingPayload(null);
        }}
        title="Große Sammelregistrierung bestätigen"
        description={
          previewLines && pendingPayload ? (
            <span>
              Möchtest du wirklich {pendingPayload.quantity} Geräte registrieren?
              Voraussichtlich{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {previewLines.first}
              </code>{" "}
              bis{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {previewLines.last}
              </code>
              {" "}— die endgültigen Seriennummern werden vom Server vergeben
              und können bei gleichzeitiger Registrierung leicht abweichen.
              Die tatsächliche Spanne erscheint in der Bestätigungs-Meldung.
            </span>
          ) : (
            <span>
              Möchtest du wirklich {pendingPayload?.quantity ?? 0} Geräte
              registrieren? Die Seriennummern werden vom Server vergeben.
            </span>
          )
        }
        confirmLabel="Anlegen"
        onConfirm={() => {
          if (!pendingPayload) {
            setConfirmOpen(false);
            return;
          }
          const payload = pendingPayload;
          setConfirmOpen(false);
          setPendingPayload(null);
          mutation.mutate(payload);
        }}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Section / Field — same shape as `<DeviceEditForm>`'s inline helpers so the
// vertical rhythm matches across forms in the same task flow.
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
