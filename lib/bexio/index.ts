// Story 2.6 — barrel re-export for the shared bexio Zod / helper surface.
// Per architecture.md, lib/bexio/ is the canonical home for bexio-side
// Zod schemas + small helpers consumed by the React/Server-side stack.
// The Edge Function side (Deno) duplicates these intentionally — it must
// not import from lib/.

export {
  BEXIO_CONTACT_API_REFERENCE_PREFIX,
  bexioContactApiReference,
  bexioContactCreateResponseSchema,
  bexioContactPatchSchema,
  bexioContactPayloadSchema,
  bexioContactRowSchema,
  bexioContactSearchResponseSchema,
  bexioContactUpdateResponseSchema,
} from "./contact";

export type {
  BexioContactCreateResponse,
  BexioContactPatch,
  BexioContactPayload,
  BexioContactRow,
  BexioContactSearchResponse,
  BexioContactUpdateResponse,
} from "./contact";
