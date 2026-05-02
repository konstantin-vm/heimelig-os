// Swiss postcode → canton helper.
// Used by the S-003 Region filter (Story 2.5 Resolved decision 6).
//
// Swiss Post PLZ-prefix conventions are deterministic per the official
// Plzkanton lookup; the mapping below covers the leading-digit + leading-2-digit
// ranges that Swiss Post groups by canton. The lookup is a coarse-grained
// approximation suitable for the Sprint-1 region filter — a few border PLZs
// (Liechtenstein FL 9485-9498 → not a Swiss canton; some German exclaves)
// resolve to null. Callers should treat null as "kein Schweizer Kanton".
//
// Source: https://en.wikipedia.org/wiki/List_of_postal_codes_in_Switzerland +
// https://swisspost.opendatasoft.com — leading-2-digit ranges per canton.

import type { SwissCantonCode } from "@/lib/constants/swiss-cantons";

// Ordered most-specific (4-digit range) FIRST so first-match-wins resolves
// to the narrowest canton pocket. Each entry: [low, high, canton]. PLZ between
// low (incl.) and high (incl.) resolves to the canton. Coarse-grained Sprint-1
// approximation — a handful of border 4-digit codes resolve to the dominant
// canton of their range, not the literal owner.
const PLZ_RANGES: ReadonlyArray<[number, number, SwissCantonCode]> = [
  // ─── 1xxx — Genf / Waadt / Wallis / Freiburg / Neuenburg / Bern / Jura ──
  [1200, 1299, "GE"], // Genève pocket — must precede 1000-1299 VD shell
  [1860, 1899, "VS"], // Aigle/Bex VS pocket within 1800-1899 VD shell
  [1900, 1999, "VS"],
  [1600, 1699, "FR"],
  [1700, 1799, "FR"],
  [1000, 1199, "VD"],
  [1300, 1599, "VD"],
  [1800, 1859, "VD"],
  // 2xxx — NE / BE / JU
  [2000, 2099, "NE"],
  [2300, 2499, "NE"],
  [2500, 2799, "BE"],
  [2800, 2999, "JU"],
  // ─── 3xxx — Bern + Wallis ───────────────────────────────────────────────
  [3700, 3999, "VS"], // Wallis (Oberwallis)
  [3000, 3699, "BE"],
  // ─── 4xxx — Basel / Solothurn / Aargau ──────────────────────────────────
  [4000, 4099, "BS"],
  [4100, 4299, "BL"],
  [4300, 4399, "AG"],
  [4500, 4599, "SO"], // Solothurn pocket within 4400-4699 BL shell
  [4700, 4799, "SO"],
  [4400, 4499, "BL"],
  [4600, 4699, "BL"],
  [4800, 4899, "AG"],
  [4900, 4999, "BE"],
  // ─── 5xxx — Aargau ──────────────────────────────────────────────────────
  [5000, 5999, "AG"],
  // ─── 6xxx — Zentralschweiz / Tessin / Bündner Süd ───────────────────────
  [6370, 6390, "NW"], // Nidwalden pocket within 6300-6399 ZG shell
  [6300, 6399, "ZG"],
  [6460, 6469, "UR"], // Uri pocket — must precede 6440-6469 SZ shell
  [6470, 6499, "UR"],
  [6440, 6459, "SZ"],
  [6710, 6749, "GR"], // GR pocket within Tessin band
  [6500, 6699, "TI"],
  [6700, 6709, "TI"],
  [6750, 6999, "TI"],
  [6000, 6099, "LU"],
  [6100, 6299, "LU"],
  // ─── 7xxx — Graubünden ─────────────────────────────────────────────────
  [7000, 7999, "GR"],
  // ─── 8xxx — Zürich / Schaffhausen / Thurgau / SG / Glarus / Schwyz ─────
  [8200, 8299, "SH"], // SH pocket within 8100-8499 ZH band
  [8500, 8599, "TG"],
  [8700, 8799, "SZ"],
  [8840, 8849, "SZ"], // Einsiedeln pocket within 8800-8899
  [8850, 8852, "SZ"], // Lachener Vorland
  [8853, 8854, "SZ"], // Lachen / Galgenen-Süd
  [8855, 8864, "SG"], // March-Süd SG pocket
  [8865, 8898, "GL"], // Glarus
  [8899, 8899, "GL"],
  [8800, 8839, "ZH"], // Zürich-See linkes Ufer
  [8000, 8099, "ZH"],
  [8100, 8199, "ZH"],
  [8300, 8499, "ZH"],
  [8600, 8699, "ZH"],
  [8900, 8999, "ZH"],
  // ─── 9xxx — St. Gallen / Appenzell / Thurgau ───────────────────────────
  [9050, 9059, "AI"], // AI pocket within AR shell
  [9043, 9049, "AR"],
  [9050, 9056, "AR"], // (covered by AI above; harmless tail)
  [9100, 9199, "AR"],
  [9000, 9099, "SG"],
  [9200, 9249, "SG"],
  [9300, 9479, "SG"],
  // 9485-9498 — Liechtenstein (FL) — intentionally not mapped → returns null.
  [9500, 9599, "TG"],
  [9600, 9799, "SG"],
];

/**
 * Resolve a Swiss postcode to its canton. Returns null for non-Swiss
 * postcodes (FL Liechtenstein, DE/AT/FR/IT exclaves) or unparseable input.
 *
 * Sprint-1 use: the S-003 list page applies the Region filter client-side
 * because the customers table has no canton column (PLZ → canton derivation
 * is JS-only). If this becomes a perf bottleneck for the filter pass on
 * large customer sets, denormalise into a `customers.canton` column or a
 * generated column on `customer_addresses` — flagged as Sprint-2 follow-up.
 */
export function cantonFromZip(zip: string | null | undefined): SwissCantonCode | null {
  if (!zip) return null;
  const trimmed = zip.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n)) return null;

  // 9485–9498 = Liechtenstein, explicit exclude.
  if (n >= 9485 && n <= 9498) return null;

  for (const [lo, hi, canton] of PLZ_RANGES) {
    if (n >= lo && n <= hi) return canton;
  }
  return null;
}
