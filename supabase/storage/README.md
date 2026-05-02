# Heimelig OS — Storage Buckets

Reference for the three private Supabase Storage buckets shipped in Story 1.6.

**Master schema reference:** [`docs/internal/data-model-spec.md`](../../../docs/internal/data-model-spec.md) (§5.5 medical certs, §5.7/§5.8 signatures).
**Migrations:** [`00018_storage_buckets.sql`](../migrations/00018_storage_buckets.sql) + [`00019_storage_policies.sql`](../migrations/00019_storage_policies.sql).

## Buckets

| Bucket id | Public | Allowed MIME types | Size limit | Consumer story |
|-----------|--------|--------------------|------------|----------------|
| `medical-certs` | `false` | `application/pdf`, `image/jpeg`, `image/png` | 10 MB | Epic 5 Story 5.5 (medical certificate upload) |
| `qr-labels` | `false` | `application/pdf` | 5 MB | Epic 3 Story 3.7 (QR label generation) |
| `signatures` | `false` | `image/png` | 1 MB | Epic 8 Story 8.6 (technician digital signature) |

The bucket-level allowlist (`allowed_mime_types`) and `file_size_limit` run in the Storage HTTP layer **before** RLS evaluation. Anything that violates them is rejected by Supabase before our policies see it.

## Path conventions

| Bucket | Path pattern | First-segment binding |
|--------|--------------|------------------------|
| `medical-certs` | `{contract_id}/{filename}` | `rental_contracts.id` (Epic 5) |
| `qr-labels` | `{article_id}/{batch_id}.pdf` | `articles.id` (Epic 3); 2nd segment is the batch-print run id |
| `signatures` | `{tour_stop_id}/{timestamp}.png` | `tour_stops.id` (Epic 7); timestamp is `epoch_ms` for chronology |

The first segment is mandatorily a UUID. Today the policies enforce **shape only** (UUID regex via `public.storage_first_segment_is_uuid(text)`). Once the referenced entities exist (`rental_contracts` lands in Sprint 2; `tour_stops` in Sprint 4), the consumer-story migrations replace the shape check with an `EXISTS` join — same policy names, same predicate position, no rewriting of upload paths.

## Role matrix

Policies on `storage.objects`. Naming: `{bucket_underscore}_{role}_{op}` (e.g. `medical_certs_office_insert`). Empty cells = no policy = default DENY.

| Bucket | admin | office | warehouse | technician |
|--------|-------|--------|-----------|------------|
| `medical-certs` | INSERT/SELECT/UPDATE/DELETE | INSERT/SELECT/UPDATE/DELETE | — | — |
| `qr-labels` | INSERT/SELECT/UPDATE/DELETE | INSERT/SELECT/UPDATE/DELETE | INSERT/SELECT/UPDATE/DELETE | — |
| `signatures` | SELECT | SELECT | — | — |

### Deferred (technician scope)

`tour_stops` does not exist until Epic 7 (Sprint 4), so the technician policies that need to scope by `tour_stops.technician_id = auth.uid()` cannot ship yet. The two reserved names are:

- `qr_labels_technician_select` — Epic 7 follow-up.
- `signatures_technician_insert` — Epic 8 Story 8.6.

Until those land, technicians are deny-by-default on every storage bucket.

## nDSG / data residency

All three buckets live in the **Zürich** Supabase project. **Uploads go directly browser → Supabase Storage (Zürich) via the supabase-js client. Never route file uploads through `app/api/*` on Vercel Frankfurt** — that violates the PII boundary because Vercel sees the raw payload.

The path segments (`{contract_id}`, `{tour_stop_id}`, `{article_id}`) are UUIDs — opaque, not PII themselves. Filenames may contain readable strings (e.g. customer surname); keep them out of error logs (use IDs + structured codes only, per the global anti-pattern in `CLAUDE.md`).

## Helper

`public.storage_first_segment_is_uuid(p_name text) returns boolean`

Returns true iff the first folder segment of a storage object name matches the canonical UUID shape. Used by every storage policy in the matrix above. Unit cases (smoke `I:helper`):

| Input | Returns |
|-------|---------|
| `'<uuid>/foo.pdf'` | `true` |
| `'xyz/foo.pdf'` | `false` |
| `'foo.pdf'` (no folder) | `false` |
| `''` (empty) | `false` |

## Smoke matrix

`heimelig-os/scripts/smoke-1-6.sql` — 28 cases covering bucket config, role × operation × bucket RLS outcomes, path-shape rejection, helper unit checks, and anonymous-access denial. Run via:

```bash
npx supabase db query --linked -f scripts/smoke-1-6.sql
```

Target: 100 % PASS. The cleanup pass uses `session_replication_role = replica` to bypass `storage.protect_delete()` (Supabase's "use the Storage API" guard), which is fine for a script-driven test run but **never** something app code should do.

## What's intentionally NOT here

- **No upload UI / SDK helpers.** Each consumer story (5.5, 3.7, 8.6) ships its own UI and signed-URL logic.
- **No virus scan / EXIF stripping / content sniffing.** Phase-1 server-side guards are MIME allowlist + size limit only.
- **No storage-level audit trigger.** `storage.objects` rotates too frequently. Consumer stories call `log_activity(...)` from the app layer when an upload represents a business event (cert received, signature captured).
- **No orphan-object cleanup.** Retention / cleanup is an operations-playbook concern.

## Anti-patterns (Storage-specific)

- ❌ Public buckets (`public = true`) — every file is gated by RLS.
- ❌ Routing uploads through `app/api/*` on Vercel Frankfurt — direct browser → Supabase Storage (Zürich) only.
- ❌ Service-Role uploads from frontend code — Service-Role lives in Edge Functions only.
- ❌ Bypassing the bucket-level MIME / size allowlist via Service-Role or any other channel.
- ❌ `for all` shortcut in any storage policy — every (bucket × role × op) cell is explicit.
- ❌ Inline `auth.jwt() ->> 'app_role'` in storage policies — use the `is_admin()` / `is_office()` / `is_technician()` / `is_warehouse()` helpers.
