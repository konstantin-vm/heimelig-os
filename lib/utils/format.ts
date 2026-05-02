// Display-formatting helpers for customer-domain tables and cards.
// Story 2.5 — single source for formatPhone() + formatDate() so the list page,
// profile cards, and badges all render identically.

const DATE_FMT_DE_CH = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Format a phone string for display. Swiss-friendly: keeps the leading "+"
 * and inserts spaces in the canonical "+41 79 123 45 67" / "+41 44 123 45 67"
 * grouping when the input parses cleanly; otherwise returns the input as-is
 * (preserves quirky imports from Blue-Office without mangling them).
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "—";

  // Strip everything but digits and a leading "+".
  const compact = trimmed.replace(/[^\d+]/g, "");
  if (!compact) return trimmed;

  // Swiss canonical: +41XXXXXXXXX (12 chars) → "+41 XX XXX XX XX"
  if (/^\+41\d{9}$/.test(compact)) {
    return `${compact.slice(0, 3)} ${compact.slice(3, 5)} ${compact.slice(
      5,
      8,
    )} ${compact.slice(8, 10)} ${compact.slice(10, 12)}`;
  }
  // Domestic 0XXXXXXXXX (10 chars) → "0XX XXX XX XX"
  if (/^0\d{9}$/.test(compact)) {
    return `${compact.slice(0, 3)} ${compact.slice(3, 6)} ${compact.slice(
      6,
      8,
    )} ${compact.slice(8, 10)}`;
  }
  return trimmed;
}

/**
 * Format an ISO date or Date instance as Swiss-style "dd.MM.yyyy".
 * Returns the em-dash placeholder when the input is null/undefined or
 * unparseable.
 */
export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_FMT_DE_CH.format(d);
}

/**
 * Format a customer address (street + zip + city) for inline display in the
 * S-003 list rows. Returns "—" when no street is available. Country only
 * appears when not 'CH'.
 */
export function formatPrimaryAddressLine(addr: {
  street?: string | null;
  street_number?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
} | null | undefined): string {
  if (!addr || !addr.street) return "—";
  const street = [addr.street, addr.street_number ?? ""].filter(Boolean).join(" ").trim();
  const cityLine = [addr.zip, addr.city].filter(Boolean).join(" ");
  const parts = [street, cityLine].filter(Boolean);
  if (addr.country && addr.country !== "CH") parts.push(addr.country);
  return parts.join(", ");
}
