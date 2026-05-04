"use client";

// <DeviceListFilters> — Story 3.2.
//
// URL-driven filter row for the article-detail device list. Mirrors
// `<ArticleListFilters>` (Story 3.1): debounced search owned by the parent,
// chip-style multi-selects pushed to `?status=` / `?condition=` / `?isNew=` /
// `?retired=`. The list of accepted URL tokens lives in
// `parseDeviceListFilters()` next to `<DeviceTable>` so both views agree.
//
// Search is sanitized inside the query layer (escape + 100-char cap); this
// component only debounces and lifts the term into the URL.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deviceConditionLabels,
  deviceStatusLabels,
  deviceIsNewLabels,
} from "@/lib/constants/device";
import {
  deviceConditionValues,
  deviceStatusValues,
} from "@/lib/validations/device";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 250;

export type DeviceListFiltersProps = {
  searchTerm: string;
  onSearchTermChange: (next: string) => void;
};

type Toggle = "on" | "off";

function readSet(param: string | null, allowed: ReadonlySet<string>): string[] {
  if (!param) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowed.has(s));
}

const STATUS_SET: ReadonlySet<string> = new Set(deviceStatusValues);
const CONDITION_SET: ReadonlySet<string> = new Set(deviceConditionValues);

export function DeviceListFilters({
  searchTerm,
  onSearchTermChange,
}: DeviceListFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedStatus = readSet(searchParams.get("status"), STATUS_SET);
  const selectedCondition = readSet(searchParams.get("condition"), CONDITION_SET);
  const isNewRaw = searchParams.get("new");
  const includeRetired = searchParams.get("retired") === "1";

  const [draft, setDraft] = useState<string | null>(null);
  const searchValue = draft !== null ? draft : searchTerm;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParam(key: string, value: string | null) {
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

  function toggleInSet(
    key: "status" | "condition",
    value: string,
    current: string[],
  ) {
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    pushParam(key, next.length > 0 ? next.join(",") : null);
  }

  function setIsNew(next: "true" | "false" | null) {
    pushParam("new", next);
  }

  function setIncludeRetired(next: Toggle) {
    pushParam("retired", next === "on" ? "1" : null);
  }

  function onSearchChange(value: string) {
    setDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchTermChange(value);
      setDraft(null);
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
          selectedStatus.length > 0 ||
          selectedCondition.length > 0 ||
          isNewRaw === "true" ||
          isNewRaw === "false" ||
          includeRetired,
      ),
    [
      searchTerm,
      selectedStatus.length,
      selectedCondition.length,
      isNewRaw,
      includeRetired,
    ],
  );

  function resetAll() {
    setDraft(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearchTermChange("");
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ["status", "condition", "new", "retired", "page"]) {
      params.delete(k);
    }
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="device-list-search" className="text-xs text-muted-foreground">
          Suche
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="device-list-search"
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Seriennummer oder QR-Code suchen…"
            className="pl-8"
            autoComplete="off"
          />
        </div>
      </div>

      <ChipGroup
        legend="Status"
        items={deviceStatusValues.map((s) => ({
          value: s,
          label: deviceStatusLabels[s],
        }))}
        selected={selectedStatus}
        onToggle={(v) => toggleInSet("status", v, selectedStatus)}
      />

      <ChipGroup
        legend="Zustand"
        items={deviceConditionValues.map((c) => ({
          value: c,
          label: deviceConditionLabels[c],
        }))}
        selected={selectedCondition}
        onToggle={(v) => toggleInSet("condition", v, selectedCondition)}
      />

      <ChipGroup
        legend="Neu / Gebraucht"
        items={[
          { value: "true", label: deviceIsNewLabels.true },
          { value: "false", label: deviceIsNewLabels.false },
        ]}
        selected={isNewRaw === "true" || isNewRaw === "false" ? [isNewRaw] : []}
        onToggle={(v) =>
          setIsNew(isNewRaw === v ? null : (v as "true" | "false"))
        }
        single
      />

      <div className="flex items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={includeRetired}
            onChange={(e) => setIncludeRetired(e.target.checked ? "on" : "off")}
          />
          Ausgemusterte Geräte mit anzeigen
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
  /**
   * Marker that the parent enforces single-select via `onToggle` semantics
   * (`isNewRaw === v ? null : ...`). The chip rendering itself is always
   * toggle-based; we keep the prop as documentation + future-proofing for
   * a multi-select variant — no behavioural difference today.
   */
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

// Re-exported for `<DeviceTable>` to keep URL-token parsing in one place.
export function parseDeviceListFiltersFromSearchParams(
  params: URLSearchParams,
): {
  status: string[];
  condition: string[];
  isNew: boolean | null;
  includeRetired: boolean;
} {
  const status = readSet(params.get("status"), STATUS_SET);
  const condition = readSet(params.get("condition"), CONDITION_SET);
  const isNewRaw = params.get("new");
  const isNew = isNewRaw === "true" ? true : isNewRaw === "false" ? false : null;
  const includeRetired = params.get("retired") === "1";
  return { status, condition, isNew, includeRetired };
}
