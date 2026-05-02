-- Migration 00018 — Storage buckets for Sprint-1 storage foundation.
-- Story 1.6 (Storage Buckets & Role-Based Storage Policies).
-- See _bmad-output/implementation-artifacts/1-6-storage-buckets-role-based-storage-policies.md
--   AC1, AC2, AC4, AC5, AC6, AC12.
--
-- Three private buckets, all `public = false`, with bucket-level MIME-type
-- allowlist + size limit. RLS policies on storage.objects ship in 00019.
--
-- Consumer-story map (AC1):
--   medical-certs  — Epic 5 Story 5.5 (medical certificate upload)
--   qr-labels      — Epic 3 Story 3.7 (QR label generation + printing)
--   signatures     — Epic 8 Story 8.6 (technician digital customer signature)
--
-- Path conventions (AC2 — verbatim):
--   medical-certs/{contract_id}/{filename}
--     first segment is rental_contracts.id (Epic 5)
--   qr-labels/{article_id}/{batch_id}.pdf
--     first segment is articles.id (Epic 3); second is batch-print run id
--   signatures/{tour_stop_id}/{timestamp}.png
--     first segment is tour_stops.id (Epic 7); timestamp is epoch_ms
--
-- Today only the first-segment SHAPE (UUID) is enforced — entity-existence
-- joins land in the consumer-story migrations, once the referenced tables
-- (rental_contracts in Sprint 2, tour_stops in Sprint 4) exist.
--
-- Deferred technician scope (AC7):
--   qr_labels_technician_select   — Epic 7 follow-up (needs tour_stops)
--   signatures_technician_insert  — Epic 8 Story 8.6 (same dependency)
--   Both reserved policy names; technician is deny-by-default today.
--
-- nDSG / data residency (AC12):
--   All Storage buckets live in the Zürich Supabase project. File uploads
--   go directly browser → Supabase Storage (Zürich) via supabase-js — never
--   through Vercel Frankfurt. The path segments ({contract_id}, {tour_stop_id},
--   {article_id}) are UUIDs — opaque, not PII themselves.
--
-- Region check (AC12):
--   Project region is set at the Supabase project level, not per-bucket.
--   Verify via the project metadata endpoint or Supabase Dashboard
--   (Settings → General → Region = "Switzerland (eu-central-2 / Zürich)").
--
-- Bucket-id naming (AC6):
--   Bucket ids contain hyphens (`medical-certs`, `qr-labels`); RLS policy
--   names use underscores (`medical_certs_*`) because PostgreSQL identifiers
--   cannot contain hyphens unquoted. Documented to prevent typo flagging.
--
-- Idempotency (AC1):
--   Upsert via `insert ... on conflict (id) do update set ...`. A second
--   `supabase db push --linked` is a no-op (zero rows changed).

-- ---------------------------------------------------------------------------
-- Bucket upserts
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('medical-certs', 'medical-certs', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png']),
  ('qr-labels',     'qr-labels',     false,  5242880,
    array['application/pdf']),
  ('signatures',    'signatures',    false,  1048576,
    array['image/png'])
on conflict (id) do update set
  name               = excluded.name,
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Defensive guard against accidental anonymous access (AC4).
--
-- Supabase Storage has no default `anon` policies on `storage.objects` for
-- non-public buckets — `public = false` (above) is the primary guard.
-- We add no policies for `anon` here; 00019 only creates `to authenticated`
-- policies. The smoke matrix Case Z asserts the empty-anon postcondition.
-- ---------------------------------------------------------------------------

-- (No grants/revokes needed — Supabase ships safe defaults for storage.objects;
--  any later migration that grants to `anon` would be a regression caught by
--  smoke Case Z.)
