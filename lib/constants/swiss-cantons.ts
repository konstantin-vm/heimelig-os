// Swiss cantons — single source of truth for the S-003 Region filter.
// Sprint-1 scope (Story 2.5 Resolved decision 6): static list of all 26
// official cantons rather than dynamic derivation from the customer set.
// Auto-derivation (only show cantons with ≥1 customer) is a post-MVP polish.

export type SwissCantonCode =
  | "ZH" | "BE" | "LU" | "UR" | "SZ" | "OW" | "NW" | "GL" | "ZG" | "FR"
  | "SO" | "BS" | "BL" | "SH" | "AR" | "AI" | "SG" | "GR" | "AG" | "TG"
  | "TI" | "VD" | "VS" | "NE" | "GE" | "JU";

export type SwissCantonConfig = {
  code: SwissCantonCode;
  name: string;
};

export const SWISS_CANTONS: ReadonlyArray<SwissCantonConfig> = [
  { code: "ZH", name: "Zürich" },
  { code: "BE", name: "Bern" },
  { code: "LU", name: "Luzern" },
  { code: "UR", name: "Uri" },
  { code: "SZ", name: "Schwyz" },
  { code: "OW", name: "Obwalden" },
  { code: "NW", name: "Nidwalden" },
  { code: "GL", name: "Glarus" },
  { code: "ZG", name: "Zug" },
  { code: "FR", name: "Freiburg" },
  { code: "SO", name: "Solothurn" },
  { code: "BS", name: "Basel-Stadt" },
  { code: "BL", name: "Basel-Landschaft" },
  { code: "SH", name: "Schaffhausen" },
  { code: "AR", name: "Appenzell Ausserrhoden" },
  { code: "AI", name: "Appenzell Innerrhoden" },
  { code: "SG", name: "St. Gallen" },
  { code: "GR", name: "Graubünden" },
  { code: "AG", name: "Aargau" },
  { code: "TG", name: "Thurgau" },
  { code: "TI", name: "Tessin" },
  { code: "VD", name: "Waadt" },
  { code: "VS", name: "Wallis" },
  { code: "NE", name: "Neuenburg" },
  { code: "GE", name: "Genf" },
  { code: "JU", name: "Jura" },
] as const;

const CANTON_BY_CODE: Record<SwissCantonCode, SwissCantonConfig> =
  SWISS_CANTONS.reduce(
    (acc, c) => {
      acc[c.code] = c;
      return acc;
    },
    {} as Record<SwissCantonCode, SwissCantonConfig>,
  );

export function getCantonName(code: SwissCantonCode): string {
  return CANTON_BY_CODE[code]?.name ?? code;
}
