// Article-domain runtime constants + German labels (Story 3.1).

import {
  articleCategoryValues,
  articleTypeValues,
  articleUnitValues,
  articleVatRateValues,
} from "@/lib/validations/article";
import { priceListNameValues } from "@/lib/validations/price-list";

export const ARTICLE_LIST_PAGE_SIZE = 25;

export type ArticleListSortColumn =
  | "article_number"
  | "name"
  | "category"
  | "created_at";

export type ArticleListSortDir = "asc" | "desc";

export const ARTICLE_LIST_DEFAULT_SORT: {
  col: ArticleListSortColumn;
  dir: ArticleListSortDir;
} = {
  col: "article_number",
  dir: "asc",
};

export const SORTABLE_ARTICLE_LIST_COLUMNS: ReadonlySet<ArticleListSortColumn> =
  new Set(["article_number", "name", "category", "created_at"]);

// German labels for the Zod enums. Kept here (not in the validations layer)
// so server-side schemas stay UI-copy free.

export const articleCategoryLabels: Record<
  (typeof articleCategoryValues)[number],
  string
> = {
  pflegebetten: "Pflegebetten",
  mobilitaet: "Mobilität",
  matratzen: "Matratzen",
  zubehoer: "Zubehör",
  moebel: "Möbel",
};

export const articleTypeLabels: Record<
  (typeof articleTypeValues)[number],
  string
> = {
  physical: "Physisches Produkt",
  service: "Dienstleistung",
};

export const articleUnitLabels: Record<
  (typeof articleUnitValues)[number],
  string
> = {
  Mte: "Monat (Mte)",
  "Stk.": "Stück (Stk.)",
  "Std.": "Stunde (Std.)",
  Paar: "Paar",
  Pauschal: "Pauschal",
};

// VAT rate label includes the percent for clarity in dropdown + display rows.
// Schweizer MWST 2024+: 8.1% / 2.6% / 3.8%.
export const articleVatRateLabels: Record<
  (typeof articleVatRateValues)[number],
  string
> = {
  standard: "Standard 8.1%",
  reduced: "Reduziert 2.6%",
  accommodation: "Beherbergung 3.8%",
};

// Price-list display labels (Hauptpartnerkassen + Privat).
export const priceListNameLabels: Record<
  (typeof priceListNameValues)[number],
  string
> = {
  helsana: "Helsana",
  sanitas: "Sanitas",
  visana: "Visana",
  kpt: "KPT",
  private: "Privat",
};

// Display order for the price-list card (Privat first, then partner KKs).
export const PRICE_LIST_DISPLAY_ORDER: ReadonlyArray<
  (typeof priceListNameValues)[number]
> = ["private", "helsana", "sanitas", "visana", "kpt"];
