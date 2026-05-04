// Feature flags — small public-env booleans that gate UI surfaces while the
// underlying code stays in the tree. The flags below are read by both server
// and client components (Next exposes `NEXT_PUBLIC_*` to both), so the same
// helper is safe to call anywhere.
//
// Sprint-5 features (Story 3.5 mobile QR scan, Story 3.6 batch register,
// Story 3.7 QR-label print/history) shipped early in Sprint 1 but are gated
// off by default for stakeholder demos until Sprint 5 (~end of June 2026).
// Code stays in the repo — flip `NEXT_PUBLIC_SHOW_SPRINT5_FEATURES=true` in
// `.env.local` (or Vercel env) to turn the entry points back on.

export function isSprint5Enabled(): boolean {
  return process.env.NEXT_PUBLIC_SHOW_SPRINT5_FEATURES === "true";
}
