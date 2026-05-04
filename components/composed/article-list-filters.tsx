"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

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
import {
  articleCategoryLabels,
  articleTypeLabels,
} from "@/lib/constants/article";
import { articleCategoryValues, articleTypeValues } from "@/lib/validations/article";

const SEARCH_DEBOUNCE_MS = 250;

const ALL = "all";

type ParsedFilters = {
  category: string;
  type: string;
  isRentable: string;
  isSellable: string;
  status: string;
};

export type ArticleListFiltersProps = {
  /** Committed search term, owned by parent. */
  searchTerm: string;
  /** Called once the debounced input has settled. */
  onSearchTermChange: (next: string) => void;
};

type ReadonlyURLSearchParams = ReturnType<typeof useSearchParams>;

export function readArticleFiltersFromSearchParams(
  params: URLSearchParams | ReadonlyURLSearchParams,
): ParsedFilters {
  const get = (key: string) => params.get(key) ?? "";
  return {
    category: get("category"),
    type: get("type"),
    isRentable: get("rentable"),
    isSellable: get("sellable"),
    status: get("status"),
  };
}

export function ArticleListFilters({
  searchTerm,
  onSearchTermChange,
}: ArticleListFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = readArticleFiltersFromSearchParams(searchParams);

  const [draft, setDraft] = useState<string | null>(null);
  const searchValue = draft !== null ? draft : searchTerm;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushFilters(next: Partial<ParsedFilters>) {
    // Read the latest URL params at call time (window.location is the
    // source of truth) instead of the React state-snapshot of
    // `searchParams` — two filter selects fired in rapid succession would
    // otherwise both build their next-URL from the same stale snapshot,
    // and the second router.replace() would silently undo the first.
    const current =
      typeof window !== "undefined"
        ? window.location.search.replace(/^\?/, "")
        : searchParams.toString();
    const params = new URLSearchParams(current);
    const apply = (key: string, value: string | undefined) => {
      if (!value) params.delete(key);
      else params.set(key, value);
    };
    if ("category" in next) apply("category", next.category ?? "");
    if ("type" in next) apply("type", next.type ?? "");
    if ("isRentable" in next) apply("rentable", next.isRentable ?? "");
    if ("isSellable" in next) apply("sellable", next.isSellable ?? "");
    if ("status" in next) apply("status", next.status ?? "");
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

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const hasFilters = useMemo(
    () =>
      Boolean(
        searchTerm ||
          initial.category ||
          initial.type ||
          initial.isRentable ||
          initial.isSellable ||
          initial.status,
      ),
    [
      searchTerm,
      initial.category,
      initial.type,
      initial.isRentable,
      initial.isSellable,
      initial.status,
    ],
  );

  function resetAll() {
    setDraft(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearchTermChange("");
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ["category", "type", "rentable", "sellable", "status", "page"]) {
      params.delete(k);
    }
    const queryStr = params.toString();
    router.replace(queryStr ? `?${queryStr}` : "?", { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex flex-1 min-w-[240px] flex-col gap-1">
        <Label htmlFor="article-list-search" className="text-xs text-muted-foreground">
          Suche
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="article-list-search"
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Name, Artikelnummer oder Hersteller suchen…"
            className="pl-8"
            autoComplete="off"
          />
        </div>
      </div>

      <FilterSelect
        id="filter-category"
        label="Kategorie"
        value={initial.category || ALL}
        onChange={(v) => pushFilters({ category: v === ALL ? "" : v })}
        options={[
          { value: ALL, label: "Alle Kategorien" },
          ...articleCategoryValues.map((c) => ({
            value: c,
            label: articleCategoryLabels[c],
          })),
        ]}
      />

      <FilterSelect
        id="filter-type"
        label="Typ"
        value={initial.type || ALL}
        onChange={(v) => pushFilters({ type: v === ALL ? "" : v })}
        options={[
          { value: ALL, label: "Alle" },
          ...articleTypeValues.map((t) => ({
            value: t,
            label: articleTypeLabels[t],
          })),
        ]}
      />

      <FilterSelect
        id="filter-rentable"
        label="Vermietbar"
        value={initial.isRentable || ALL}
        onChange={(v) => pushFilters({ isRentable: v === ALL ? "" : v })}
        options={[
          { value: ALL, label: "Beide" },
          { value: "true", label: "Ja" },
          { value: "false", label: "Nein" },
        ]}
      />

      <FilterSelect
        id="filter-sellable"
        label="Verkaufbar"
        value={initial.isSellable || ALL}
        onChange={(v) => pushFilters({ isSellable: v === ALL ? "" : v })}
        options={[
          { value: ALL, label: "Beide" },
          { value: "true", label: "Ja" },
          { value: "false", label: "Nein" },
        ]}
      />

      <FilterSelect
        id="filter-status"
        label="Status"
        // AC6 — default chip is "Aktiv" (preselected) when no URL param.
        // The table parser also defaults the missing URL param to "active",
        // so the two views stay in sync. Picking "Alle" emits explicit
        // `?status=all` so the table can disable the filter.
        value={initial.status || "active"}
        onChange={(v) => pushFilters({ status: v === ALL ? "all" : v })}
        options={[
          { value: "active", label: "Aktiv" },
          { value: "inactive", label: "Inaktiv" },
          { value: ALL, label: "Alle" },
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
    <div className="flex w-full flex-col gap-1 sm:w-[160px]">
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
