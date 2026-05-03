// Story 2.6 — Customer + primary address → bexio Contact payload.
//
// Edge Function-side mapper. Lives in `_shared/` so both the cron sweep
// and the single-customer manual trigger speak the same outbound shape.
//
// CLAUDE.md anti-pattern check: Edge Functions cannot import from `lib/`.
// The Zod schemas here are deliberately a duplicate of `lib/bexio/contact.ts`
// — keep the field set + types in lock-step (reviewers spot-check). When
// you change one, change the other.
//
// Mapping decisions (each one referenced in story 2.6 AC6):
//
//   * contact_type_id: customer_type='private' → 1, 'institution' → 2
//   * name_1:          company_name  (institution)  OR  last_name (private)
//                      For salutation='erbengemeinschaft' we keep last_name
//                      in name_1 so the "Familie X / Erbengemeinschaft"
//                      surname is preserved; the literal "Erbengemeinschaft"
//                      goes into name_2 (see below).
//   * name_2:          first_name (private only). For institutions name_2
//                      is null. For Erbengemeinschaft we put the literal
//                      "Erbengemeinschaft" into name_2 because bexio's
//                      standard salutation list does not include the
//                      Heimelig-internal value.
//   * salutation_id:   herr → 1, frau → 2, divers → null,
//                      erbengemeinschaft → null
//                      (final mapping confirmed at run time against
//                      `GET /2.0/salutation` — see TODO below).
//   * language_id:     de → 1, en → 2, fr → 3, it → 4
//                      (confirm against `GET /2.0/language` on first run).
//   * country_id:      CH → 1, DE → 23, AT → 39, FR → 60, IT → 73, FL → 78
//                      (confirm against `GET /2.0/country` on first run).
//   * mail:            customers.email
//   * phone_fixed:     customers.phone
//   * phone_mobile:    customers.mobile
//   * address:         street + ' ' + street_number (trimmed)
//   * postcode, city:  primary address (Hauptadresse, address_type='primary',
//                      is_default_for_type=true).
//   * user_id, owner_id: opts.defaultUserId — the bexio user that "owns"
//                      newly-created Heimelig contacts. Read once from
//                      `GET /2.0/users` and persisted as Edge Function
//                      env BEXIO_DEFAULT_USER_ID.
//   * api_reference:   BEXIO_CONTACT_API_REFERENCE_PREFIX + customer.id —
//                      Search-Before-POST deterministic key (AC7).
//
// TODOs marked here are NON-blocking for shipping the migration; they
// must be resolved before the first office user actually clicks "In
// bexio anlegen". See story 2.6 §"Pre-implementation blockers — MEDIUM".

import { z } from "https://esm.sh/zod@3.23.8";

// ---------------------------------------------------------------------------
// Constants — mirror lib/bexio/contact.ts.
// ---------------------------------------------------------------------------

export const BEXIO_CONTACT_API_REFERENCE_PREFIX = "heimelig-customer-" as const;

export function bexioContactApiReference(customerId: string): string {
  return `${BEXIO_CONTACT_API_REFERENCE_PREFIX}${customerId}`;
}

// TODO(story-2.6): confirm against bexio Trial via `GET /2.0/salutation`.
// Source of truth lives here until then. If a value drifts, change the
// constant and redeploy — do not introduce a settings table for 4 ids.
const SALUTATION_ID_MAP: Record<string, number | null> = {
  herr: 1,
  frau: 2,
  divers: null,
  erbengemeinschaft: null,
};

// TODO(story-2.6): confirm against `GET /2.0/language` on first connect.
const LANGUAGE_ID_MAP: Record<string, number> = {
  de: 1,
  en: 2,
  fr: 3,
  it: 4,
};

// TODO(story-2.6): confirm against `GET /2.0/country` on first connect.
// `customers` country CHECK enum is ('CH','FL','DE','AT','FR','IT').
const COUNTRY_ID_MAP: Record<string, number> = {
  CH: 1,
  DE: 23,
  AT: 39,
  FR: 60,
  IT: 73,
  FL: 78,
};

// ---------------------------------------------------------------------------
// Narrow input types — do NOT use Supabase generated types (Edge Functions
// cannot import from lib/). The Edge Function selects the columns we need
// and hands them in here.
// ---------------------------------------------------------------------------

export interface CustomerForBexio {
  id: string;
  customer_type: "private" | "institution";
  salutation: "herr" | "frau" | "divers" | "erbengemeinschaft" | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  language: "de" | "fr" | "it" | "en";
}

export interface PrimaryAddressForBexio {
  street: string;
  street_number: string | null;
  zip: string;
  city: string;
  country: "CH" | "FL" | "DE" | "AT" | "FR" | "IT";
}

export interface CustomerToBexioOpts {
  defaultUserId: number;
}

// ---------------------------------------------------------------------------
// Zod schemas — DUPLICATE of lib/bexio/contact.ts (keep in lock-step).
// ---------------------------------------------------------------------------

// IMPORTANT (2026-05-03 deploy-time finding):
// bexio's /2.0/contact endpoint REJECTS both `address` and `api_reference`
// as "Unexpected extra form field". They appear in older docs but the
// live trial API does not honor them. So:
//   - `address` (street) cannot be sent via /2.0/contact POST. Bexio
//     stores postcode + city only on the contact itself; the full
//     street/number address lives on a separate /2.0/contact/{id}/address
//     resource (TODO post-MVP — Story 2.6 ships postcode+city only).
//   - `api_reference` is unsupported as both write field AND search field
//     on /2.0/contact, so the Search-Before-POST recovery key from AC7 is
//     not viable on this endpoint version. Recovery is degraded: a POST
//     that times out after bexio commits but before we receive the
//     response will create a duplicate. The risk window is the bexio TLS
//     timeout (rare) and the deferred fix is to migrate to /3.0/contact
//     once the schema differences are mapped.
export const bexioContactPayloadSchema = z.object({
  contact_type_id: z.union([z.literal(1), z.literal(2)]),
  name_1: z.string().min(1).max(255),
  name_2: z.string().max(255).nullable().optional(),
  salutation_id: z.number().int().positive().nullable().optional(),
  language_id: z.number().int().positive().nullable().optional(),
  country_id: z.number().int().positive().nullable().optional(),
  mail: z.string().max(255).nullable().optional(),
  phone_fixed: z.string().max(64).nullable().optional(),
  phone_mobile: z.string().max(64).nullable().optional(),
  postcode: z.string().max(64).nullable().optional(),
  city: z.string().max(255).nullable().optional(),
  user_id: z.number().int().positive(),
  owner_id: z.number().int().positive(),
});

export type BexioContactPayload = z.infer<typeof bexioContactPayloadSchema>;

// Review round 1 M1 — patch payload restricted to BEXIO_RETRIGGER + BEXIO_ADDRESS
// surface only (per AC8). Phone + salutation are NOT in the retrigger field
// list (`customer-edit-form.tsx:176`), so editing them never enqueues a sync;
// shipping them in the patch payload would unconditionally overwrite values a
// bexio operator may have edited manually. Removed: salutation_id, phone_fixed,
// phone_mobile.
export const bexioContactPatchSchema = z.object({
  name_1: z.string().min(1).max(255),
  name_2: z.string().max(255).nullable().optional(),
  mail: z.string().max(255).nullable().optional(),
  postcode: z.string().max(64).nullable().optional(),
  city: z.string().max(255).nullable().optional(),
});

export type BexioContactPatch = z.infer<typeof bexioContactPatchSchema>;

export const bexioContactRowSchema = z
  .object({
    id: z.number().int().positive(),
    api_reference: z.string().nullable().optional(),
  })
  .passthrough();

export type BexioContactRow = z.infer<typeof bexioContactRowSchema>;

export const bexioContactCreateResponseSchema = bexioContactRowSchema;
export const bexioContactUpdateResponseSchema = bexioContactRowSchema;
export const bexioContactSearchResponseSchema = z.array(bexioContactRowSchema);

export type BexioContactSearchResponse = z.infer<
  typeof bexioContactSearchResponseSchema
>;

// ---------------------------------------------------------------------------
// Mapping helpers — kept private; tested via the public mapper functions.
// ---------------------------------------------------------------------------

function buildName1(c: CustomerForBexio): string {
  if (c.customer_type === "institution") {
    const value = c.company_name?.trim();
    if (value && value.length > 0) return value;
    // Schema-level CHECK guarantees company_name is set for institutions, but
    // an external mutation could have nulled it. Fall back to last_name so we
    // never POST an invalid empty name_1.
    return c.last_name?.trim() ?? "";
  }
  return c.last_name?.trim() ?? "";
}

function buildName2(c: CustomerForBexio): string | null {
  if (c.salutation === "erbengemeinschaft") {
    return "Erbengemeinschaft";
  }
  if (c.customer_type === "institution") {
    return null;
  }
  const value = c.first_name?.trim();
  return value && value.length > 0 ? value : null;
}

function buildAddress(addr: PrimaryAddressForBexio): string {
  const street = addr.street.trim();
  const num = addr.street_number?.trim() ?? "";
  return num.length > 0 ? `${street} ${num}` : street;
}

function mapSalutation(c: CustomerForBexio): number | null {
  if (c.salutation === null) return null;
  // Object-Map with explicit fallback so an unexpected (post-migration)
  // salutation value cannot index into a non-mapped position.
  return SALUTATION_ID_MAP[c.salutation] ?? null;
}

function mapLanguage(c: CustomerForBexio): number | null {
  return LANGUAGE_ID_MAP[c.language] ?? null;
}

function mapCountry(addr: PrimaryAddressForBexio): number | null {
  return COUNTRY_ID_MAP[addr.country] ?? null;
}

// ---------------------------------------------------------------------------
// Public mappers.
// ---------------------------------------------------------------------------

/**
 * Full create payload. Mode "create" — every field bexio accepts on
 * `POST /2.0/contact` is populated.
 *
 * Story 2.6 AC6.
 */
export function customerToBexioContactPayload(
  customer: CustomerForBexio,
  primaryAddress: PrimaryAddressForBexio,
  opts: CustomerToBexioOpts,
): BexioContactPayload {
  const payload: BexioContactPayload = {
    contact_type_id: customer.customer_type === "institution" ? 2 : 1,
    name_1: buildName1(customer),
    name_2: buildName2(customer),
    salutation_id: mapSalutation(customer),
    language_id: mapLanguage(customer),
    country_id: mapCountry(primaryAddress),
    mail: nullIfEmpty(customer.email),
    phone_fixed: nullIfEmpty(customer.phone),
    phone_mobile: nullIfEmpty(customer.mobile),
    postcode: primaryAddress.zip,
    city: primaryAddress.city,
    user_id: opts.defaultUserId,
    owner_id: opts.defaultUserId,
  };
  // `buildAddress(primaryAddress)` no longer ships in the create payload
  // (bexio /2.0/contact rejects it). Reference kept for future migration
  // to /3.0/contact + /3.0/contact-address pair.
  void buildAddress;
  // Validate so an internal contract drift surfaces here, not as a
  // bexio 4xx three steps later. The Zod parse is cheap (~µs).
  return bexioContactPayloadSchema.parse(payload);
}

/**
 * PATCH-style payload — only the BEXIO_RETRIGGER + BEXIO_ADDRESS field
 * surface. Skipping owner_id / user_id / country_id / language_id minimises
 * the chance of overwriting a bexio-side change a human operator made.
 *
 * Story 2.6 AC8.
 */
export function customerToBexioContactPatch(
  customer: CustomerForBexio,
  primaryAddress: PrimaryAddressForBexio,
): BexioContactPatch {
  const patch: BexioContactPatch = {
    name_1: buildName1(customer),
    name_2: buildName2(customer),
    mail: nullIfEmpty(customer.email),
    postcode: primaryAddress.zip,
    city: primaryAddress.city,
  };
  return bexioContactPatchSchema.parse(patch);
}

// Review round 1 M12 — coerce empty strings to null. The customers schema
// allows '' for nullable text columns (no NOT NULL constraint); bexio
// 422s on `mail: ""`, so callers must normalize before POST.
function nullIfEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
