"use client";

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { priceListNameLabels } from "@/lib/constants/article";
import { useReplacePriceListEntry } from "@/lib/queries/price-lists";
import type { PriceListNameValue } from "@/lib/validations/price-list";

export type PriceListEditDialogProps = {
  articleId: string;
  listName: PriceListNameValue;
  /** Current active amount (null when not yet maintained). */
  currentAmount: number | null;
  /** Current open-row notes — pre-populated to avoid wiping on amount-only edits. */
  currentNotes: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Compute today in Europe/Zurich. The previous `new Date().toISOString()` was
// UTC and produced the wrong date around midnight CET.
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

const AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

export function PriceListEditDialog({
  articleId,
  listName,
  currentAmount,
  currentNotes,
  open,
  onOpenChange,
}: PriceListEditDialogProps) {
  // The parent (<PriceListCard>) only mounts this dialog when `editingList`
  // is non-null, and re-creates it for each pencil click — initial state is
  // fresh on every open without needing an effect.
  const [amount, setAmount] = useState<string>(
    currentAmount !== null ? currentAmount.toFixed(2) : "",
  );
  const [validFrom, setValidFrom] = useState<string>(todayIso());
  const [notes, setNotes] = useState<string>(currentNotes ?? "");
  const [error, setError] = useState<string | null>(null);

  const replace = useReplacePriceListEntry({
    onSuccess: () => {
      toast.success(`${priceListNameLabels[listName]}-Preis aktualisiert.`);
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Use a strict decimal regex on the raw string instead of round-trip
    // float comparison — the latter falsely fails edge cases like "0.10"
    // due to FP rounding.
    const normalised = amount.trim().replace(",", ".");
    if (!AMOUNT_REGEX.test(normalised)) {
      setError("Bitte einen gültigen Betrag (max. 2 Nachkommastellen) eingeben.");
      return;
    }
    const parsed = Number.parseFloat(normalised);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Bitte einen gültigen Betrag (≥ 0) eingeben.");
      return;
    }
    if (!validFrom || !/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
      setError("Gültig ab muss ein Datum im Format YYYY-MM-DD sein.");
      return;
    }
    // Round-trip the date through Date() to reject semantically invalid
    // values like "2099-13-99" that the bare regex accepts.
    const dateRoundTrip = new Date(`${validFrom}T00:00:00Z`);
    if (
      Number.isNaN(dateRoundTrip.getTime())
      || dateRoundTrip.toISOString().slice(0, 10) !== validFrom
    ) {
      setError("Gültig ab ist kein gültiges Datum.");
      return;
    }

    replace.mutate({
      articleId,
      listName,
      amount: parsed,
      validFrom,
      // Preserve the existing notes when the user didn't touch the field
      // (the trimmed-empty-string convention here aligns with the
      // `coalesce(p_notes, notes)` in migration 00046's same-day branch).
      notes: notes.trim() === "" ? null : notes.trim(),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block close while pending so an in-flight RPC isn't orphaned by
        // a Radix close transition.
        if (!next && replace.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => {
          if (replace.isPending) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (replace.isPending) e.preventDefault();
        }}
      >
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {priceListNameLabels[listName]}-Preis aktualisieren
            </DialogTitle>
            <DialogDescription>
              Der bisherige Preis bleibt für bestehende Verträge erhalten
              (Bestandsschutz). Der neue Preis gilt für neue Aufträge ab dem
              gewählten Datum.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="price-amount">Betrag (CHF)</Label>
              <Input
                id="price-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
                required
                aria-invalid={error ? "true" : "false"}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="price-valid-from">Gültig ab</Label>
              <Input
                id="price-valid-from"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="price-notes">Notizen (optional)</Label>
              <Textarea
                id="price-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
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
              disabled={replace.isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={replace.isPending}>
              {replace.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Speichern…
                </>
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
