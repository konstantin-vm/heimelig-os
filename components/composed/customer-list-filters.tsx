"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SWISS_CANTONS } from "@/lib/constants/swiss-cantons";
import type {
  CustomerInsurerFilter,
  CustomerStatusFilter,
  CustomerTimeframeFilter,
} from "@/lib/queries/customers";

const SEARCH_DEBOUNCE_MS = 250;

type ParsedFilters = {
  region: string;
  insurer: string;
  timeframe: string;
  status: string;
};

export type CustomerListFiltersProps = {
  /** Committed search term, owned by parent (never URL-synced — nDSG). */
  searchTerm: string;
  /** Called once the debounced input has settled. */
  onSearchTermChange: (next: string) => void;
};

const ALL_REGIONS = "all";
const ALL_INSURERS = "all";
const ALL_TIMEFRAMES = "all";
const ALL_STATUS = "all";

const INSURERS: ReadonlyArray<{ value: CustomerInsurerFilter; label: string }> = [
  { value: "helsana", label: "Helsana" },
  { value: "sanitas", label: "Sanitas" },
  { value: "kpt", label: "KPT" },
  { value: "visana", label: "Visana" },
  { value: "other", label: "Andere" },
  { value: "none", label: "Keine" },
];

const TIMEFRAMES: ReadonlyArray<{ value: CustomerTimeframeFilter; label: string }> = [
  { value: "30d", label: "Letzte 30 Tage" },
  { value: "6m", label: "Letzte 6 Monate" },
  { value: "1y", label: "Letztes Jahr" },
  { value: "older", label: "Älter" },
];

const STATUSES: ReadonlyArray<{ value: CustomerStatusFilter; label: string }> = [
  { value: "active", label: "Aktiv" },
  { value: "inactive", label: "Inaktiv" },
];

export function readFiltersFromSearchParams(
  params: URLSearchParams | ReadonlyURLSearchParams,
): ParsedFilters {
  const get = (key: string) => params.get(key) ?? "";
  return {
    region: get("region"),
    insurer: get("insurer"),
    timeframe: get("timeframe"),
    status: get("status"),
  };
}

// next/navigation's ReadonlyURLSearchParams type alias.
type ReadonlyURLSearchParams = ReturnType<typeof useSearchParams>;

export function CustomerListFilters({
  searchTerm,
  onSearchTermChange,
}: CustomerListFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = readFiltersFromSearchParams(searchParams);

  // Search input local draft: keystrokes drive a local state, debounce
  // commits to the parent (which holds the search term in component state —
  // it's never written to the URL because raw customer names would otherwise
  // land in Vercel Frankfurt access logs).
  const [draft, setDraft] = useState<string | null>(null);
  const searchValue = draft !== null ? draft : searchTerm;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushFilters(next: Partial<ParsedFilters>) {
    const params = new URLSearchParams(searchParams.toString());
    const apply = (key: string, value: string | undefined) => {
      if (!value) params.delete(key);
      else params.set(key, value);
    };
    if ("region" in next) apply("region", next.region ?? "");
    if ("insurer" in next) apply("insurer", next.insurer ?? "");
    if ("timeframe" in next) apply("timeframe", next.timeframe ?? "");
    if ("status" in next) apply("status", next.status ?? "");
    // Filter changes always reset to page 1.
    params.delete("page");
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  function onSearchChange(value: string) {
    setDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchTermChange(value);
      setDraft(null);
    }, SEARCH_DEBOUNCE_MS);
  }

  // Clear the debounce on unmount so a navigate-then-update doesn't fire
  // a stale commit.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const hasFilters = useMemo(
    () =>
      Boolean(
        searchTerm ||
          initial.region ||
          initial.insurer ||
          initial.timeframe ||
          initial.status,
      ),
    [searchTerm, initial.region, initial.insurer, initial.timeframe, initial.status],
  );

  function resetAll() {
    setDraft(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearchTermChange("");
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ["region", "insurer", "timeframe", "status", "page"]) {
      params.delete(k);
    }
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex flex-1 min-w-[240px] flex-col gap-1">
        <Label htmlFor="customer-list-search" className="text-xs text-muted-foreground">
          Suche
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="customer-list-search"
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Name, Adresse, E-Mail oder Telefon suchen…"
            className="pl-8"
            autoComplete="off"
          />
        </div>
      </div>

      <FilterSelect
        id="filter-region"
        label="Region"
        value={initial.region || ALL_REGIONS}
        onChange={(v) =>
          pushFilters({ region: v === ALL_REGIONS ? "" : v })
        }
        options={[
          { value: ALL_REGIONS, label: "Alle Regionen" },
          ...SWISS_CANTONS.map((c) => ({
            value: c.code,
            label: `${c.code} — ${c.name}`,
          })),
        ]}
      />

      <FilterSelect
        id="filter-insurer"
        label="Versicherung"
        value={initial.insurer || ALL_INSURERS}
        onChange={(v) =>
          pushFilters({ insurer: v === ALL_INSURERS ? "" : v })
        }
        options={[
          { value: ALL_INSURERS, label: "Alle Versicherungen" },
          ...INSURERS.map((i) => ({ value: i.value, label: i.label })),
        ]}
      />

      <FilterSelect
        id="filter-timeframe"
        label="Zeit"
        value={initial.timeframe || ALL_TIMEFRAMES}
        onChange={(v) =>
          pushFilters({ timeframe: v === ALL_TIMEFRAMES ? "" : v })
        }
        options={[
          { value: ALL_TIMEFRAMES, label: "Alle Zeiträume" },
          ...TIMEFRAMES.map((t) => ({ value: t.value, label: t.label })),
        ]}
      />

      <FilterSelect
        id="filter-status"
        label="Status"
        value={initial.status || ALL_STATUS}
        onChange={(v) =>
          pushFilters({ status: v === ALL_STATUS ? "" : v })
        }
        options={[
          { value: ALL_STATUS, label: "Alle" },
          ...STATUSES.map((s) => ({ value: s.value, label: s.label })),
        ]}
      />

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetAll}
          className="self-end"
        >
          <X className="h-4 w-4" aria-hidden />
          Filter zurücksetzen
        </Button>
      ) : null}
    </div>
  );
}

type FilterSelectProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
};

function FilterSelect({ id, label, value, onChange, options }: FilterSelectProps) {
  return (
    <div className="flex w-full flex-col gap-1 sm:w-[180px]">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
