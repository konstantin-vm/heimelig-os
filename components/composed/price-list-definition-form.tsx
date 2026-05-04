"use client";

// Story 3.1.1 — create / edit dialog for `price_list_definitions`.
//
// System rows (is_system=true): only `name`, `sort_order`, `is_active` are
// editable; `slug` is rendered read-only with a tooltip explaining the lock.
// Custom rows: all fields editable. Slug auto-derives from name on create
// until the user manually overrides.

import { useEffect, useId, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  useCreatePriceListDefinition,
  useUpdatePriceListDefinition,
} from "@/lib/queries/price-list-definitions";
import {
  deriveSlug,
  priceListDefinitionCreateSchema,
  priceListDefinitionUpdateSchema,
  type PriceListDefinition,
} from "@/lib/validations/price-list-definition";

export type PriceListDefinitionFormProps = {
  mode: "create" | "edit";
  /** Required for `mode='edit'`. */
  definition?: PriceListDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormState = {
  slug: string;
  name: string;
  sort_order: string;
  is_active: boolean;
  // Tracks whether the user has manually edited the slug; when false, the
  // slug field is kept in sync with the auto-derived value from `name`.
  slug_dirty: boolean;
};

const EMPTY: FormState = {
  slug: "",
  name: "",
  sort_order: "0",
  is_active: true,
  slug_dirty: false,
};

export function PriceListDefinitionForm({
  mode,
  definition,
  open,
  onOpenChange,
}: PriceListDefinitionFormProps) {
  const [state, setState] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  // Hydrate on open / definition change. Closing wipes the local state.
  // TODO(Story 3.1.1 follow-up): React 19 lint flags setState-in-effect.
  // The dialog's local state is intentionally driven by the `open` /
  // `definition` props — could be derived at render time via a `key=` reset.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(EMPTY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(null);
      return;
    }
    if (mode === "edit" && definition) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({
        slug: definition.slug,
        name: definition.name,
        sort_order: String(definition.sort_order),
        is_active: definition.is_active,
        slug_dirty: true,
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(null);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(EMPTY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
  }, [open, mode, definition]);

  const isSystem = mode === "edit" && definition?.is_system === true;
  const slugReadOnly = isSystem;

  const createMutation = useCreatePriceListDefinition({
    onSuccess: () => {
      toast.success("Preisliste angelegt.");
      onOpenChange(false);
    },
    onError: (err) => setError(err.message),
  });
  const updateMutation = useUpdatePriceListDefinition({
    onSuccess: () => {
      toast.success("Preisliste aktualisiert.");
      onOpenChange(false);
    },
    onError: (err) => setError(err.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onNameChange(next: string) {
    setState((prev) => ({
      ...prev,
      name: next,
      // Auto-sync slug while it's still untouched.
      slug: prev.slug_dirty ? prev.slug : deriveSlug(next),
    }));
  }

  function onSlugChange(next: string) {
    setState((prev) => ({ ...prev, slug: next, slug_dirty: true }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const sortOrder = Number.parseInt(state.sort_order.trim(), 10);
    if (!Number.isFinite(sortOrder)) {
      setError("Sortier-Reihenfolge muss eine ganze Zahl sein.");
      return;
    }

    if (mode === "create") {
      const parsed = priceListDefinitionCreateSchema.safeParse({
        slug: state.slug.trim(),
        name: state.name.trim(),
        sort_order: sortOrder,
        is_active: state.is_active,
      });
      if (!parsed.success) {
        setError(
          parsed.error.issues[0]?.message ??
            "Ungültige Eingabe — bitte Pflichtfelder prüfen.",
        );
        return;
      }
      createMutation.mutate(parsed.data);
      return;
    }

    if (mode === "edit" && definition) {
      const patchInput: Record<string, unknown> = {
        name: state.name.trim(),
        sort_order: sortOrder,
        is_active: state.is_active,
      };
      // Only allow slug change for non-system rows.
      if (!isSystem && state.slug.trim() !== definition.slug) {
        patchInput.slug = state.slug.trim();
      }
      const parsed = priceListDefinitionUpdateSchema.safeParse(patchInput);
      if (!parsed.success) {
        setError(
          parsed.error.issues[0]?.message ??
            "Ungültige Eingabe — bitte Pflichtfelder prüfen.",
        );
        return;
      }
      updateMutation.mutate({ id: definition.id, patch: parsed.data });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={(e) => {
          if (isPending) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isPending) e.preventDefault();
        }}
      >
        <form id={formId} onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {mode === "create"
                ? "Neue Preisliste"
                : "Preisliste bearbeiten"}
            </DialogTitle>
            <DialogDescription>
              {isSystem
                ? "Diese System-Preisliste kann umbenannt, sortiert und deaktiviert werden. Der Slug ist gesperrt — er ist Teil der Datenintegrität."
                : "Lege fest, wie die Preisliste in Artikel-Karten und Auftrags-Formularen angezeigt wird. Der Slug wird intern verwendet (z. B. helsana, mein-grosskunde)."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pld-name" required>Name</Label>
              <Input
                id="pld-name"
                value={state.name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="z. B. Helsana"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="pld-slug" required={!slugReadOnly}>
                Slug
                {slugReadOnly ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (System — gesperrt)
                  </span>
                ) : null}
              </Label>
              <Input
                id="pld-slug"
                value={state.slug}
                onChange={(e) => onSlugChange(e.target.value)}
                placeholder="z. B. helsana"
                readOnly={slugReadOnly}
                aria-readonly={slugReadOnly}
                className={slugReadOnly ? "bg-muted/50" : undefined}
                required
              />
              <p className="text-xs text-muted-foreground">
                Kleinbuchstaben, Ziffern, Bindestriche, Unterstriche.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="pld-sort">Sortier-Reihenfolge</Label>
                <Input
                  id="pld-sort"
                  type="number"
                  step={1}
                  value={state.sort_order}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, sort_order: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="pld-active">Aktiv</Label>
                <div className="flex h-9 items-center rounded-md border bg-card px-3">
                  <Switch
                    id="pld-active"
                    checked={state.is_active}
                    onCheckedChange={(next) =>
                      setState((prev) => ({ ...prev, is_active: next }))
                    }
                  />
                </div>
              </div>
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

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
