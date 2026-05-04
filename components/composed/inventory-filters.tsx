"use client";

// <InventoryFilters> — Story 3.4. URL-driven filter row for the
// `/articles/inventory` page. Mirrors `<DeviceListFilters>` (Story 3.2):
// debounced search owned by the parent, chip multi-selects pushed to URL
// via `useSearchParams` + `router.replace`. The list of accepted URL
// tokens is parsed in `parseInventoryFiltersFromSearchParams()` so the
// `<InventoryGrid>` consumer reads the same shape.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { articleCategoryLabels } from "@/lib/constants/article";
import {
  availabilityBucketLabels,
  INVENTORY_SEARCH_MAX_LEN,
} from "@/lib/constants/inventory";
import { articleCategoryValues } from "@/lib/validations/article";
import {
  availabilityBucketValues,
  type AvailabilityBucket,
} from "@/lib/validations/inventory";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 250;

const CATEGORY_SET: ReadonlySet<string> = new Set(articleCategoryValues);
const BUCKET_SET: ReadonlySet<string> = new Set(availabilityBucketValues);

export type InventoryFiltersProps = {
  searchTerm: string;
  onSearchTermChange: (next: string) => void;
};

function readSet(param: string | null, allowed: ReadonlySet<string>): string[] {
  if (!param) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowed.has(s));
}

export function InventoryFilters({
  searchTerm,
  onSearchTermChange,
}: InventoryFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedCategories = readSet(
    searchParams.get("category"),
    CATEGORY_SET,
  );
  const warningsOnly = searchParams.get("warningsOnly") === "true";
  const bucketRaw = searchParams.get("bucket");
  const selectedBucket: AvailabilityBucket | null =
    bucketRaw && BUCKET_SET.has(bucketRaw)
      ? (bucketRaw as AvailabilityBucket)
      : null;

  const [draft, setDraft] = useState<string | null>(null);
  // Cap the local draft to mirror what the query layer will use, so the
  // user sees the truncation immediately rather than after debounce.
  const searchValue = (draft !== null ? draft : searchTerm).slice(
    0,
    INVENTORY_SEARCH_MAX_LEN,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParam(key: string, value: string | null) {
    // Read latest URL at call time — same fix as `<ArticleListFilters>`
    // line 75 (rapid-fire chip toggles must not stale-overwrite).
    const current =
      typeof window !== "undefined"
        ? window.location.search.replace(/^\?/, "")
        : searchParams.toString();
    const params = new URLSearchParams(current);
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    params.delete("page");
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  function toggleCategory(value: string) {
    const next = selectedCategories.includes(value)
      ? selectedCategories.filter((v) => v !== value)
      : [...selectedCategories, value];
    pushParam("category", next.length > 0 ? next.join(",") : null);
  }

  function setBucket(next: AvailabilityBucket | null) {
    pushParam("bucket", next);
  }

  function setWarningsOnly(next: boolean) {
    pushParam("warningsOnly", next ? "true" : null);
  }

  function onSearchChange(value: string) {
    const capped = value.slice(0, INVENTORY_SEARCH_MAX_LEN);
    setDraft(capped);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchTermChange(capped);
      setDraft(null);
      // Typing into search invalidates the current page slot — mirror
      // `pushParam`'s implicit `params.delete("page")` so the user does
      // not land on a phantom out-of-range page after narrowing.
      const current =
        typeof window !== "undefined"
          ? window.location.search.replace(/^\?/, "")
          : searchParams.toString();
      const params = new URLSearchParams(current);
      if (params.has("page")) {
        params.delete("page");
        const queryStr = params.toString();
        router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const hasFilters = useMemo(
    () =>
      Boolean(
        searchTerm ||
          selectedCategories.length > 0 ||
          warningsOnly ||
          selectedBucket,
      ),
    [searchTerm, selectedCategories.length, warningsOnly, selectedBucket],
  );

  function resetAll() {
    setDraft(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearchTermChange("");
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ["category", "warningsOnly", "bucket", "page"]) {
      params.delete(k);
    }
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-col gap-1">
        <Label
          htmlFor="inventory-list-search"
          className="text-xs text-muted-foreground"
        >
          Suche
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="inventory-list-search"
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Name, Artikelnummer oder Hersteller suchen…"
            className="pl-8"
            autoComplete="off"
            maxLength={INVENTORY_SEARCH_MAX_LEN}
          />
        </div>
      </div>

      <ChipGroup
        legend="Kategorie"
        items={articleCategoryValues.map((c) => ({
          value: c,
          label: articleCategoryLabels[c],
        }))}
        selected={selectedCategories}
        onToggle={toggleCategory}
      />

      <ChipGroup
        legend="Verfügbarkeit"
        items={availabilityBucketValues.map((b) => ({
          value: b,
          label: availabilityBucketLabels[b],
        }))}
        selected={selectedBucket ? [selectedBucket] : []}
        onToggle={(v) =>
          setBucket(
            selectedBucket === v ? null : (v as AvailabilityBucket),
          )
        }
        single
      />

      <div className="flex items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={warningsOnly}
            onChange={(e) => setWarningsOnly(e.target.checked)}
          />
          Nur mit Warnung anzeigen
        </label>
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetAll}
            className="ml-auto"
          >
            <X className="h-4 w-4" aria-hidden />
            Filter zurücksetzen
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type ChipGroupProps = {
  legend: string;
  items: ReadonlyArray<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  /** Marker only — the toggle semantic is enforced by the parent's onToggle. */
  single?: boolean;
};

function ChipGroup({ legend, items, selected, onToggle }: ChipGroupProps) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs text-muted-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => {
          const isOn = selected.includes(it.value);
          return (
            <button
              key={it.value}
              type="button"
              onClick={() => onToggle(it.value)}
              aria-pressed={isOn}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                isOn
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-card text-foreground hover:bg-muted",
              )}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// Re-exported so `<InventoryGrid>` reads the same URL token shape.
export function parseInventoryFiltersFromSearchParams(
  params: URLSearchParams,
): {
  categories: string[];
  warningsOnly: boolean;
  bucket: AvailabilityBucket | null;
  page: number;
} {
  const categories = readSet(params.get("category"), CATEGORY_SET);
  const warningsOnly = params.get("warningsOnly") === "true";
  const bucketRaw = params.get("bucket");
  const bucket: AvailabilityBucket | null =
    bucketRaw && BUCKET_SET.has(bucketRaw)
      ? (bucketRaw as AvailabilityBucket)
      : null;
  const pageRaw = params.get("page");
  const page = pageRaw ? Math.max(1, Number.parseInt(pageRaw, 10) || 1) : 1;
  return { categories, warningsOnly, bucket, page };
}
