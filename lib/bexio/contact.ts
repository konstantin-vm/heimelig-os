// Story 2.6 — Zod schemas for the bexio Contact API payload + responses.
//
// Lives in `lib/bexio/` per architecture.md (the canonical home for shared
// bexio Zod schemas). The Edge Function `bexio-contact-sync` does NOT
// import from here (Edge Functions cannot import from `lib/` per CLAUDE.md
// anti-patterns) — `supabase/functions/_shared/bexio-contact-mapper.ts`
// keeps a structurally identical Deno-imported copy. Reviewers spot-check.
//
// References:
//   * bexio Contact API:  https://docs.bexio.com/#tag/Contacts
//   * Idempotenz-Pattern: docs/internal/data-model-spec.md §"Idempotenz-Pattern (bexio-Integration)"
//   * Integration limits: docs/internal/data-model-spec.md §"Integration-Grenzen bexio"
//
// nDSG note:
//   These schemas can carry raw customer PII (mail, phone, address). They
//   MUST only be instantiated inside an Edge Function (Zürich) — never on
//   the client side and never inside a Server Component on Vercel
//   Frankfurt.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants — Search-Before-POST deterministic key.
// ---------------------------------------------------------------------------

export const BEXIO_CONTACT_API_REFERENCE_PREFIX = "heimelig-customer-" as const;

/**
 * Returns the deterministic `api_reference` key the bexio-contact-sync flow
 * uses for Search-Before-POST recovery. The customer UUID is the single
 * source of truth — whatever happens on the bexio side, the same UUID
 * always resolves to the same logical contact.
 *
 * Story 2.6 AC7.
 */
export function bexioContactApiReference(customerId: string): string {
  return `${BEXIO_CONTACT_API_REFERENCE_PREFIX}${customerId}`;
}

// ---------------------------------------------------------------------------
// Outbound payload — what we POST to bexio.
// ---------------------------------------------------------------------------

/**
 * The subset of the bexio Contact create/update body our mapper produces.
 * bexio accepts more fields (e.g. updated_at, fax, url, contact_group_ids);
 * we deliberately keep our outbound surface narrow so a future bexio-side
 * field added by a human operator survives the next round-trip.
 *
 * Story 2.6 AC6.
 */
// 2026-05-03 deploy-time finding: bexio /2.0/contact rejects both
// `address` and `api_reference` ("Unexpected extra form field"). They
// were in the story spec's mapping but the live trial API does NOT
// accept them. Both removed from the create payload; the Edge Function
// mapper duplicates this shape and is the source of truth.
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

/**
 * The PATCH-style payload sent on update — only the fields the user can
 * change in Heimelig OS that map to bexio fields. Skipping `owner_id` /
 * `user_id` / `country_id` / `language_id` here minimises the chance of
 * overwriting a value a bexio operator changed manually.
 *
 * Story 2.6 AC8.
 */
export const bexioContactPatchSchema = z.object({
  name_1: z.string().min(1).max(255),
  name_2: z.string().max(255).nullable().optional(),
  salutation_id: z.number().int().positive().nullable().optional(),
  mail: z.string().max(255).nullable().optional(),
  phone_fixed: z.string().max(64).nullable().optional(),
  phone_mobile: z.string().max(64).nullable().optional(),
  postcode: z.string().max(64).nullable().optional(),
  city: z.string().max(255).nullable().optional(),
});

export type BexioContactPatch = z.infer<typeof bexioContactPatchSchema>;

// ---------------------------------------------------------------------------
// Inbound responses — what bexio returns.
// ---------------------------------------------------------------------------

/**
 * Shape of a single bexio contact row we care about. bexio returns ~40
 * fields per contact; we read just what we need (id + api_reference) so a
 * bexio schema addition does not break our parse.
 */
export const bexioContactRowSchema = z
  .object({
    id: z.number().int().positive(),
    api_reference: z.string().nullable().optional(),
  })
  .passthrough();

export type BexioContactRow = z.infer<typeof bexioContactRowSchema>;

/**
 * Response from `POST /2.0/contact` — bexio returns the freshly created
 * contact row. We read `id` to populate `customers.bexio_contact_id`.
 *
 * Story 2.6 AC6.
 */
export const bexioContactCreateResponseSchema = bexioContactRowSchema;

export type BexioContactCreateResponse = z.infer<
  typeof bexioContactCreateResponseSchema
>;

/**
 * Response from `POST /2.0/contact/{id}` (update). bexio echoes the row.
 *
 * Story 2.6 AC6.
 */
export const bexioContactUpdateResponseSchema = bexioContactRowSchema;

export type BexioContactUpdateResponse = z.infer<
  typeof bexioContactUpdateResponseSchema
>;

/**
 * Response from `POST /2.0/contact/search` — bexio returns an array of
 * matching rows. We expect 0 (POST a fresh contact), 1 (link existing —
 * Search-Before-POST recovery), or >1 (data-corruption: log critical +
 * skip).
 *
 * Story 2.6 AC6 / AC7.
 */
export const bexioContactSearchResponseSchema = z.array(bexioContactRowSchema);

export type BexioContactSearchResponse = z.infer<
  typeof bexioContactSearchResponseSchema
>;
