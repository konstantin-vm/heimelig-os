# Heimelig OS — Database Migrations

**Master schema reference:** [`docs/internal/data-model-spec.md`](../../../docs/internal/data-model-spec.md) (in the agency repo). The spec is the single source of truth for every table, constraint, and RLS policy. This README defines the *process*; the spec defines the *target state*. If a conflict surfaces mid-implementation, the spec wins — amend the spec in a dedicated commit, then update the code.

## File naming

```
NNNNN_description.sql
```

- `NNNNN` is zero-padded to 5 digits (`00001`, `00002`, …).
- `description` uses `snake_case` and names the primary subject (one domain per migration where practical).
- Example: `00006_customers.sql`.

## Reserved number ranges

| Range          | Owner / purpose                                      |
|----------------|------------------------------------------------------|
| `00001–00009`  | Story 1.3 — foundation schema + RLS (applied).      |
| `00010`        | Story 1.3 review round 1 fixes (applied).           |
| `00011`        | Story 1.3 review round 2 fixes (applied).           |
| `00012–00014`  | Story 1.5 — audit_log / error_log infrastructure (applied). |
| `00015`        | Story 1.5 review round 1 fixes (applied 2026-04-27). |
| `00016`        | Story 1.5 review round 2 fixes — FK-cascade-vs-immutability narrow exception (applied 2026-04-27). |
| `00017`        | Story 1.5 review round 3 fixes — dual-cascade gap on error_log + decomposed guard (applied 2026-04-27). |
| `00018`        | Story 1.6 — storage buckets (`medical-certs`, `qr-labels`, `signatures`) with bucket-level MIME / size allowlist (applied 2026-04-29). |
| `00019`        | Story 1.6 — role-based RLS policies on `storage.objects` for admin / office / warehouse + `storage_first_segment_is_uuid()` helper (applied 2026-04-29). |
| `00020`        | Story 1.6 reserved (unused). Kept for a potential review fix-up before the slot is released. |
| `00021`        | Story 1.7 — `bexio_credentials` + `bexio_oauth_states` + encryption helpers (Vault key `bexio_token_key`) + status view + admin/service-role read functions + `bexio_complete_oauth` + `bexio_record_token_refresh` + `bexio_set_credentials_revoked` + audit trigger binding with token-column suppression + pg_cron purge of oauth_states (applied 2026-04-29). |
| `00022`        | Story 1.7 fix-up — drop `vault` from the encryption helpers' `search_path`. Calling REVOKEd `bexio_encrypt_token` from a `set role authenticated` context terminates the Supabase Cloud pooler connection because the `authenticated` role lacks USAGE on the locked-down `vault` schema; helper body uses fully-qualified `vault.decrypted_secrets` so the schema doesn't need to be on the search_path (applied 2026-04-29). |
| `00023`        | Story 2.1 — `customer_number_seq` + `gen_next_customer_number()` + `create_customer_with_primary_address()` (applied 2026-04-28). |
| `00024`        | Story 2.2 — `set_primary_contact_person(uuid)` RPC (atomic Hauptkontakt promote+demote). |
| `00025`        | Story 2.1 review fixes — drop `pg_temp` from SECURITY DEFINER search_path; admin/office gate on `gen_next_customer_number()`; explicit NULL/name-vs-type guards on create RPC; new `update_customer_with_primary_address()` for atomic edit (applied 2026-04-28). |
| `00026`        | Story 2.1 review round 2 — re-emit `update_customer_with_primary_address()` with `ON CONFLICT` predicate aligned to `idx_customer_addresses_default_per_type_unique` (`is_default_for_type AND is_active`) — fixes 42P10 on every edit. |
| `00027`        | Story 2.3 — `customer_insurance` partial-unique alignment + `set_primary_customer_insurance(uuid)` RPC (applied 2026-04-29). |
| `00028`        | Story 2.1.1 — `customers.iv_marker` + `customers.iv_dossier_number` + extended `salutation` enum (`'erbengemeinschaft'`) on `customers` and `contact_persons`. Re-emits `create_customer_with_primary_address` + `update_customer_with_primary_address` to thread the two new IV columns through the atomic create + update RPCs. Source: MTG-009 (2026-04-28); applied 2026-04-29. |
| `00029`        | Story 2.1 review round 3 fixes — `gen_next_customer_number()` background-caller carve-out (auth.uid() IS NULL bypass); `update_customer_with_primary_address()` ROW_COUNT check + case-when guards on UPSERT DO UPDATE (so absent keys don't null existing data) + customer_number-immutable raise (applied 2026-04-29). |
| `00030`        | Story 2.1.1 review fix — replay-safety re-emit of `update_customer_with_primary_address()` (00029 had stripped the iv columns; on numerical replay this restores them) + btrim defense on `iv_dossier_number` for direct API callers (applied 2026-04-29). |
| `00031`        | Story 2.3 review fixes — `set_primary_customer_insurance` `is_active` guard (rejects soft-deleted targets P0002); defensive cleanup of duplicate primaries before re-asserting `idx_customer_insurance_primary_unique`; back-fill is_primary=false on inactive rows (aligns to soft-delete-clears-is_primary contract) (applied 2026-04-29). |
| `00032`        | Story 1.6 review fix — re-declare `storage_first_segment_is_uuid()` as `STABLE` (was `IMMUTABLE` in 00019). Wraps `storage.foldername()` which is upstream `STABLE`; the original `IMMUTABLE` declaration was a contract violation that allowed planner constant-folding across rows. |
| `00033`        | Story 1.7 review fixes — `bexio_oauth_states.created_by` (admin attribution); `bexio_complete_oauth` advisory lock + `p_initiated_by` propagating into `bexio_credentials.created_by`; cron purge predicate switched from `created_at` to `used_at OR expires_at`; `bexio_set_credentials_revoked` audit on lost race; `bexio_decrypt_token` empty-string handling; vault-secret error messages distinguish "not found" vs "null payload"; `bexio_credentials_status_for_admin` `LIMIT 1` defense-in-depth; consolidated `bexio_credentials_status_label()` helper used by both view + admin function; stronger comment on the deny-all view; `bexio_get_active_credential_decrypted` returns `created_at` (so the Edge Function can anchor proactive refresh on creation when `last_refreshed_at IS NULL`). |
| `00034`        | Story 2.4 — `set_default_customer_address(uuid)` SECURITY DEFINER RPC for atomic Hauptadresse-pro-Typ promote+demote within the (customer_id, address_type) partition. Mirrors `set_primary_customer_insurance` (00027 + 00031): admin/office gate, `set search_path = public`, is_active guard (P0002 on inactive targets), rejects `address_type='primary'` (22023 — primary defaults are managed by Story 2.1 RPCs). Audit rows emitted via existing audit_trigger_fn binding from 00014 (applied 2026-05-02). |
| `00035`        | Story 2.5 — `create extension if not exists pg_trgm` + 9 idempotent GIN trigram indexes (`gin_trgm_ops`) on the search-relevant customer-domain columns: `customers.first_name / .last_name / .company_name / .customer_number / .phone / .email` + `customer_addresses.street / .city / .zip`. Accelerates the S-003 list's `.or(...ilike '%q%'...)` substring scan to sub-100 ms even at ~5k rows. No schema-shape change — `pnpm db:types` byte-identical pre/post. |
| `00036`        | Story 2.4 review fixes — re-emit `set_default_customer_address` with a partition-wide `for update` lock before demote+promote (closes the concurrent-promote race that 00034 left open); back-fill `is_default_for_type = false` on soft-deleted rows so a stale partial-unique slot cannot block new defaults of the same type (mirrors the insurance back-fill in 00031). Idempotent on replay. |
| `00037`        | Story 2.4 review round 2 fix — re-emit `set_default_customer_address` with deterministic partition lock order (`order by id for update` over the entire active partition, no `id <> p_address_id` exclusion). The 00036 version locked the target row first, then PERFORMed `for update` on the rest of the partition; two concurrent promotes on different targets in the same partition could each lock their own target first and then mutually wait on each other → 40P01 deadlock. Idempotent on replay. |
| `00038`        | Story 2.5 — wires the customer-domain tables (`customers`, `customer_addresses`, `customer_insurance`, `contact_persons`) into the `supabase_realtime` publication so the postgres_changes channels mounted by Stories 2.2/2.3/2.4/2.5 actually fire on row mutations. Discovered during 2.5 smoke matrix Case G (publication had 0 tables; channels were mounted but functionally dead since 2.2). Idempotent on replay via membership check. nDSG-safe — Realtime runs in Supabase Zürich, no Vercel Frankfurt path. |
| `00039`        | Story 2.5 review round 1 — adds `public.search_customer_ids(q text)` SQL function so the customer list satisfies AC2 verbatim (substring search across customer columns AND embedded `customer_addresses.{street,city,zip}`). Routes around PostgREST's inability to OR across a to-many embed without forcing `!inner`. `STABLE` / `SECURITY INVOKER`, `GRANT EXECUTE TO authenticated`. Trigram indexes from 00035 cover all nine columns the function reads. Smoke Case A extended with `A:rpc-name` + `A:rpc-street` assertions. |
| `00040`        | Story 2.6 — bexio Contact Synchronization. Enables `pg_net` extension; adds three SECURITY DEFINER service_role-only RPCs: `claim_pending_bexio_contact_syncs(p_limit int)` (FOR UPDATE SKIP LOCKED batch claim of `customers.bexio_sync_status='pending' AND is_active=true`, ordered by `updated_at` ASC, p_limit clamped [1,100]), `mark_bexio_contact_synced(p_customer_id uuid, p_bexio_contact_id int)` (idempotent success write + `bexio_contact_synced` audit row), `mark_bexio_contact_sync_failed(p_customer_id uuid, p_error_code text)` (sticky-failure write — keeps `bexio_contact_id` intact + `bexio_contact_sync_failed` audit row). Idempotent pg_cron schedule `bexio-contact-sync-sweep` (`*/5 * * * *`) calling `net.http_post` against the Edge Function URL with `x-cron-secret` header; URL + secret read from `app.bexio_contact_sync_url` + `app.bexio_cron_secret` GUCs (RAISE NOTICE-skipped when unset so the migration applies cleanly on un-bootstrapped environments). All `mark_*` audits use `actor_system='contact_sync'` (the audit_log enum value reserved by Story 1.5 for this exact integration). |
| `00041`        | Story 2.6 review round 1 — concurrency + observability fixes on top of 00040. Adds `'in_progress'` to the `customers.bexio_sync_status` CHECK constraint + new `bexio_sync_started_at` column. Replaces `claim_pending_bexio_contact_syncs` to atomically flip claimed rows to `'in_progress'` (with started-at stamp) AND a 10-min watchdog that resets stale reservations back to `'pending'` so a killed Edge Function does not orphan rows. New `claim_single_for_bexio_sync(uuid)` for the manual button (reservation guard against rapid double-clicks). New `release_bexio_sync_to_pending(uuid)` for retriable failures. `mark_bexio_contact_synced` and `mark_bexio_contact_sync_failed` re-emitted with `returns boolean` and a status-machine gate (only `in_progress` → terminal); a stale-write returns `false` and the Edge Function logs an info-level `stale_sync_skipped` so the next sweep re-processes with fresh data (closes the lost-update race). Cron schedule recreated reading the secret from `current_setting('app.bexio_cron_secret', true)` at fire-time so `cron.job.command` no longer carries the plaintext secret. When GUCs are unset, the migration writes a `critical` `error_log` row (alongside the existing RAISE NOTICE) so the admin error dashboard surfaces the missing bootstrap. Idempotent on replay. |
| `00042`        | Story 2.6 review round 1 follow-up — restores the `bexio-contact-sync-sweep` pg_cron schedule that 00041 unscheduled but couldn't re-register because the `app.bexio_contact_sync_url` / `app.bexio_cron_secret` GUCs aren't bootstrappable from a Cloud-Management migration (`ALTER DATABASE` requires a role privilege the migration runner lacks). 00042 reads the GUCs at apply-time via `current_setting('...', true)` and skips the schedule when either is missing, with a sentinel `critical` `error_log` row written so the admin dashboard surfaces the missing bootstrap. Idempotent on replay. |
| `00043`        | Story 3.1 — Article master data + price lists. Adds `articles.is_rentable` / `articles.is_sellable` (orthogonal flags replacing the `('rental','purchase','service')` mutex per MTG-009 + Story 3.1's data-model-spec amendment), `articles.vat_rate text not null default 'standard'` CHECK in `('standard','reduced','accommodation')` (Schweizer MWST 2024+ — display-only, mapped to bexio `tax_id` in Epic 6), `articles.critical_stock integer` CHECK >= 0 (rotes Warnungs-Threshold consumed from `2026-04-30_review.md`). Back-fills `is_rentable=(type='rental')` / `is_sellable=(type='purchase')` / `vat_rate='standard'`, re-maps `'rental'`+`'purchase'` rows to `'physical'`, swaps the `articles_type_check` to `('physical','service')`. Re-emits `articles_default_is_serialized` trigger function keying off `new.is_rentable = true` (was `new.type = 'rental'`). Adds view `public.technician_articles` (column-redacted SELECT excluding `purchase_price`) running as owner so technicians can read article metadata without leaking Einkaufspreis; drops `articles_technician_select` policy so technicians have no direct SELECT on the table — view is the only path. Adds SQL helper `current_price_for_article(p_article_id, p_list_name)` (`STABLE` `SECURITY INVOKER`) that returns the currently-active amount for a (article, list) pair. Adds two SECURITY DEFINER RPCs: `replace_price_list_entry(p_article_id, p_list_name, p_amount, p_valid_from, p_notes)` (admin/office gated, atomic close-old via `valid_to = p_valid_from` + insert-new with GIST `[)`-disjointness, returns new id; preserves Bestandsschutz for Epic-5 `rental_contracts.price_snapshot_source_id`) and `create_article_with_prices(p_article jsonb, p_prices jsonb)` (admin/office gated, single transaction inserting into articles + up to 5 price_lists rows, sparse-input tolerant). Both RPCs `revoke execute from public, anon` + `grant to authenticated`. Adds `articles` + `price_lists` to the `supabase_realtime` publication via the idempotent membership check from 00038. Idempotent on replay. |
| `00044`        | Story 3.1 round-1 patch — `replace_price_list_entry` re-emitted to handle the same-day re-edit case via in-place UPDATE on `amount`+`notes` when the open entry's `valid_from` already equals `p_valid_from`. The 00043 logic closed the old via `valid_to = p_valid_from` and inserted a new row, but for an open entry already valid-from-today the close produced an empty/inverted range that the `price_lists_valid_range` CHECK rejected, then the INSERT collided on the GIST exclusion (23P01). The same-day path is exercised by the typo-correction UX in `<PriceListEditDialog>` (admin enters wrong amount, immediately re-submits with corrected amount). The in-place UPDATE preserves the row id so any contract that referenced it earlier today picks up the corrected amount, which matches user intent. Idempotent on replay. |
| `00045`        | Story 3.1 round-1 patch — re-emit `replace_price_list_entry` + `create_article_with_prices` to drop the redundant `errcode = '42501'` option on `raise insufficient_privilege` (PG 14+ rejects "RAISE option already specified" at function call time, not at create time, so the bug shipped invisibly until the technician path was exercised by the smoke matrix). Both functions ship with the corrected `raise insufficient_privilege using message = ...` form. Idempotent on replay. |
| `00047`        | Story 3.2 — Device Tracking by Serial Number. Adds `devices.is_new boolean not null default true` (data-model-spec §5.4.1 line 571 + MTG-009; was missing from 00008). Adds view `public.technician_devices` (column-redacted SELECT excluding `acquisition_price`) joined through `public.technician_articles` so soft-deleted articles silently hide their devices from the technician — closes the deferred-work follow-up from Story 3.1 review (`deferred-work.md` line 229). Adds `devices` to the `supabase_realtime` publication via the idempotent membership check from 00038 / 00043 (the article-detail device card + Story 3.4 inventory page subscribe to postgres_changes on public.devices). Audit-trigger binding for `devices` was already wired in 00014; the generic delta function picks up the new `is_new` column automatically. RLS policies on `devices` unchanged (admin ALL, office/warehouse SELECT/INSERT/UPDATE per 00009 lines 309–336); technician has no direct SELECT policy — RLS denies by default, view is the only path. Status transitions deferred to Story 3.3 (`transition_device_status` SECURITY DEFINER RPC); Story 3.2 only seeds the initial status server-side via the existing default `'available'`. Idempotent on replay. |
| `00048`        | Story 3.2 review fix-up. (1) Back-fills `devices.is_new = false` for seed rows already in `status IN ('rented','sold')` — 00047's `default true` seeded every existing row as new, but per spec the flag flips on first rental/sale completion. (2) Re-emits `public.technician_devices` via `create or replace view` (was `drop view + create view` in 00047) so future Story 3.4 / 3.5 migrations can re-emit the view without tripping `2BP01 dependent objects`. Same column list + grants as 00047. Idempotent on replay. |
| `00049`        | Story 3.3 — Controlled Device Status Transitions. Adds `public.transition_device_status(p_device_id uuid, p_new_status text, p_context jsonb default '{}'::jsonb) returns public.devices` SECURITY DEFINER RPC validating the directed state machine (available→{rented,repair,sold} \| rented→{cleaning} \| cleaning→{available,repair} \| repair→{available,sold} \| sold→terminal), role-gating admin/office/warehouse via `is_admin()`/`is_office()`/`is_warehouse()` (technician + others raise `42501`), `for update` row-locking to serialise concurrent transitions. The SECURITY DEFINER UPDATE inside the function fires the existing `trg_devices_audit` (00014) → generic delta row; the function additionally calls `log_activity('device.status_transition', ...)` for the rich semantic event row (paired audit-trail rows, established 1.5/2.1 pattern). Closes the CLAUDE.md anti-pattern *"Direct UPDATE on status columns — always via PostgreSQL Function"* via `revoke update (status) on public.devices from authenticated;` — the SECURITY DEFINER function pierces the revoke as its owner; same shape used by `replace_price_list_entry` (00043+44+45) on `price_lists` writes. PG-version trap honoured (`raise insufficient_privilege using message = '...'` only — no `errcode` option). Idempotent on replay (`create or replace`; `revoke` + `grant` are idempotent). |
| `00050`        | Story 3.7 — QR Label Generation & Printing. Adds `public.qr_label_runs` per-print-run audit table (article_id + batch_id UUID + device_ids[] + status + storage_path with `qr-labels/{article_id}/{batch_id}.pdf` CHECK constraint + audit columns). RLS: admin ALL, office + warehouse SELECT + INSERT, technician deny by default. Adds SECURITY DEFINER RPC `public.set_device_qr_code(p_device_id uuid, p_qr_code text)` — the only sanctioned writer for `devices.qr_code` outside the future Blue-Office migration script (Story 9.1). RPC is idempotent (sets when NULL or already equal), raises `22023` on conflict (caller surfaces a German "QR-Code-Konflikt — bitte Gerät neu laden" toast), `42501` for technician + other roles. Audit-trigger binding for `qr_label_runs` via 00014 `audit_trigger_fn`. Realtime publication membership for `qr_label_runs` via the idempotent check from 00038/43/47 (powers the `/articles/labels` history table's two-session live updates). Storage bucket + 12 `qr_labels_*` policies were already provisioned by Story 1.6 (00018 + 00019); this migration adds only the per-row audit + write-back path. Q5 (QR-format compatibility with Blue Office) was OPEN at story start (2026-05-04) — encoding contract single-sourced in `lib/qr-labels/encode.ts` so a contract change costs ONE line. Bumped from the originally-planned slot 00049 because Story 3.3 reserved 00049 for `transition_device_status`. Idempotent on replay. |
| `00051`        | **RESERVED placeholder** for an orphan remote-applied slot. A parallel branch applied a migration to the linked Supabase remote at version 00051 whose canonical SQL never landed in this submodule. Local file is `00051_reserved_orphan_remote_slot.sql` containing `select 1;` (no-op) so `supabase db push --linked` reconciles the local↔remote migration-history consistency check. When the owning story commits its canonical 00051 content, overwrite the placeholder file in-place — `supabase db push --linked` detects the body change and applies the canonical SQL on the next push. Decision logged in Story 3.6 review (D2, 2026-05-04). |
| `00052`        | Story 3.6 — Batch Device Registration. Adds SECURITY DEFINER RPC `public.batch_register_devices(...)` for atomic N-row INSERT into `public.devices` generating `{article_number}M-{MMYY}-{NNNNN}` serials; advisory-lock-serialised counter; quantity capped at 50; `acquisition_price` admin/office only with function-layer strip for warehouse. Idempotent on replay. |
| `00053`        | Story 3.4 — `public.inventory_overview` view (per-article rentable rollup with derived `availability_bucket` ∈ {green/yellow/red} + `stock_warning` ∈ {none/low/critical}, SECURITY INVOKER, joined to `supabase_realtime` publication via the idempotent membership check from 00038/43/47) + `public.warehouse_devices` view (column-redacted clone of `public.devices` dropping `acquisition_price` only — pays back Story 3.2 deferred-work line 244; smoke contract `lib/queries/__smoke__/warehouse-devices.ts`). Slot bumped from the 00049 the story originally reserved: parallel-WIP on Stories 3.3 (00049 transition_device_status), 3.7 (00050 qr_label_runs), an unresolved cloud-only 00051, and 3.6 (00052 batch_register_devices) consumed earlier slots ahead of doc state. Idempotent on replay (`create or replace view` + `revoke` + `grant` + `do $$ if not exists ... end $$` membership check). |
| `00054`        | Story 3.6 review fix-up — re-emits `batch_register_devices` with: P1 escape POSIX-regex metacharacters in `article_number` before concatenation into the counter MAX regex (free-form values like `10.32` would otherwise wildcard-match unrelated serials or raise `invalid_regular_expression`); P2 reject batches that would spill into a 6-digit suffix (regex `\d{5}$` would silently re-extract `00001` from `100001` and re-collide on the UNIQUE constraint); P3 explicit `auth.uid() IS NOT NULL` precondition (defense-in-depth on top of the role gate); D1 coalesce `acquired_at` + `inbound_date` into the INSERT so the column matches the MMYY encoded in the serial. Decisions logged in Story 3.6 review (D1 = coalesce column, 2026-05-04). Idempotent on replay. |
| `00055+`       | Epic 3–9 stories. Range gets reserved when the story is created.  |

## Coordination protocol

**Solo workflow (current state):** `ls supabase/migrations/` → take the next free number in your story's reserved range (see "Reserved number ranges" above). No further coordination needed. Update the reserved-range table to mark the consumed numbers as applied; leave any unused slot in the range as "reserved (unused)".

**Multi-dev workflow:** Reinstate when a second developer is actively pushing migrations. Then: `git pull` once at session start (not per migration). On `git push` non-fast-forward, the loser writes a fix-up migration with the next free number — never rewrite history or edit an applied migration.

Always: never edit an applied migration. Write a follow-up migration instead.

## Applying migrations

Cloud-only — no local Postgres. The Supabase project (`zjrlpczyljgcibhdqccp`, Zürich) is the single environment until Go-Live.

```bash
# From heimelig-os/
supabase db push --linked          # push every unapplied migration to Zürich
supabase gen types typescript \    # regenerate lib/supabase/types.ts
  --project-id zjrlpczyljgcibhdqccp \
  > lib/supabase/types.ts
# or: pnpm db:types (alias)
```

**After every migration:** regenerate types. A second `pnpm db:types` run must produce no diff — that is the idempotency gate.

## RLS baseline (mandatory on every table)

Every new table in `public.*` must, in its own migration:

```sql
alter table public.<table> enable row level security;
alter table public.<table> force row level security;
```

Policies must:

- use the helper functions from Migration `00001_helper_functions.sql` (`is_admin()`, `is_office()`, `is_technician()`, `is_warehouse()`) — never reference `auth.jwt()` directly;
- target the `authenticated` role;
- follow the naming convention `{table}_{role}_{action}` (e.g., `customers_office_select`, `invoices_admin_all`).

The role matrix for Sprint-1 tables lives at the top of `00009_rls_policies.sql` and in data-model-spec §Rollen-Modell.

## State-machine convention

Every entity with a `status` column gets a dedicated SQL function:

```sql
transition_<entity>_status(
  p_<entity>_id uuid,
  p_new_status  text,
  p_context     jsonb default '{}'::jsonb
) returns void
```

Rules:

1. The function validates the transition against a hard-coded allowlist. On invalid input it `RAISE EXCEPTION`s with SQL state `'P0001'`.
2. The function writes `audit_log` with `from_status`, `to_status`, and `context`. *(Note — `log_activity()` ships with Story 1.5. Transition functions written between Stories 1.3 and 1.5 must carry a `-- TODO(1.5): log_activity` comment where the call will land.)*
3. Direct `UPDATE SET status = …` is blocked for anon/authenticated via a `BEFORE UPDATE` trigger; only the transition function (owned by `postgres`, `SECURITY DEFINER`) may mutate the column.

Skeleton (paste + rename when implementing a transition for a given entity):

```sql
create or replace function public.transition_<entity>_status(
  p_<entity>_id uuid,
  p_new_status  text,
  p_context     jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
begin
  select status into v_old from public.<entity> where id = p_<entity>_id for update;
  if v_old is null then
    raise exception '<entity> % not found', p_<entity>_id using errcode = 'P0002';
  end if;

  -- Allowlist: edit per entity.
  if (v_old, p_new_status) not in (
    ('available','rented'),
    ('rented','cleaning'),
    ('cleaning','available')
    -- …
  ) then
    raise exception 'Invalid <entity> status transition % → %', v_old, p_new_status
      using errcode = 'P0001';
  end if;

  update public.<entity> set status = p_new_status, updated_at = now() where id = p_<entity>_id;

  -- TODO(1.5): log_activity(
  --   'status_transition', '<entity>', p_<entity>_id,
  --   jsonb_build_object('from', v_old),
  --   jsonb_build_object('to', p_new_status),
  --   p_context
  -- );
end;
$$;
```

List of entities that will receive a transition function (ownership by story):

| Entity             | Function                             | Story |
|--------------------|--------------------------------------|-------|
| `devices`          | `transition_device_status`           | 3.3   |
| `orders`           | `transition_order_status`            | 4.6   |
| `rental_contracts` | `transition_rental_contract_status`  | 5.x   |
| `invoices`         | `transition_invoice_status`          | 6.x   |
| `tours`            | `transition_tour_status`             | 7.x   |
| `tour_stops`       | `transition_tour_stop_status`        | 7.x / 8.x |
| `billing_runs`     | `transition_billing_run_status`      | 6.x   |

## Naming conventions (reminder)

| Artefact             | Convention                                      |
|----------------------|-------------------------------------------------|
| Tables               | `snake_case`, plural — `customers`, `tour_stops` |
| Columns              | `snake_case` — `created_at`                    |
| Primary keys         | `uuid`, default `gen_random_uuid()`            |
| Foreign keys         | `{referenced_table_singular}_id`               |
| Indexes              | `idx_{table}_{columns}`                        |
| Partial-unique       | `idx_{table}_{purpose}_unique`                 |
| RLS policies         | `{table}_{role}_{action}`                      |
| Trigger functions    | `trg_{table}_{purpose}` (bound trigger name) / `{table}_{purpose}_trigger` (fn name) |
| State transitions    | `transition_{entity}_status`                   |
| Timestamps           | `timestamptz` — never `timestamp`              |
| Money                | `numeric(10,2)` — never `float`/`real`         |
| Enumerations         | `text` + `CHECK` constraint — never PG `enum`  |

Forbidden: `any` in TypeScript, `bigint`/`serial`/`identity` PKs, `console.log` for error handling, direct `UPDATE SET status`, Service-Role in the frontend, routing PII through Vercel Frankfurt.

## Types regeneration workflow

```bash
pnpm db:types   # supabase gen types typescript --project-id zjrlpczyljgcibhdqccp > lib/supabase/types.ts
```

- Commit the regenerated `lib/supabase/types.ts` **in the same commit** as the migration that changed the schema.
- Zod schemas live in `lib/validations/`. If Zod and the regenerated types disagree, **types win** (DB is the truth) — adapt the Zod schema and commit both together.

## `log_activity()` — audit write path

`log_activity()` ships as of migration `00012_audit_log.sql` (Story 1.5). Signature:

```sql
log_activity(
  p_action    text,
  p_entity    text,
  p_entity_id uuid,
  p_before    jsonb default null,
  p_after     jsonb default null,
  p_details   jsonb default '{}'::jsonb
) returns uuid
```

- `SECURITY DEFINER`, `set search_path = public, pg_temp`.
- Resolves `actor_user_id` from `auth.uid()`. For service-role / pg_cron callers (`auth.uid()` is NULL), pass `p_details = jsonb_build_object('actor_system', '<source>')` where `<source>` is one of `pg_cron | billing_run | payment_sync | contact_sync | dunning_run | migration | other`.
- Writes happen inside the caller's transaction. On failure the caller's transaction rolls back — this is the Audit-First rule.
- `audit_log` rows are immutable (trigger `audit_log_immutable` rejects UPDATE/DELETE with SQLSTATE 42501).

Every `transition_*` function + every DB function that changes business state must call `log_activity()` at least once. Reviewers reject PRs that mutate state without a `log_activity` call.

## bexio-credentials encryption (Story 1.7)

`public.bexio_credentials` stores `access_token_encrypted` + `refresh_token_encrypted` as base64-encoded `pgp_sym_encrypt` ciphertexts. The AES-256 key lives in **Supabase Vault** under secret name `bexio_token_key`. The key never touches a migration body, audit row, log line, or `pg_dump` output.

**One-time ops setup** (Dashboard SQL editor, NOT a migration):

```sql
select vault.create_secret(
  encode(gen_random_bytes(32), 'base64'),
  'bexio_token_key',
  'AES-256 key for bexio_credentials.access_token_encrypted / refresh_token_encrypted'
);
```

**Helpers** (migrations 00021 + 00022):

| Function | Purpose | GRANT EXECUTE |
|---|---|---|
| `public.bexio_encrypt_token(text)` | base64(pgp_sym_encrypt(plaintext, key)) | `service_role` only |
| `public.bexio_decrypt_token(text)` | inverse | `service_role` only |
| `public.bexio_credentials_status_for_admin()` | returns 0/1 row of metadata, no token columns | `authenticated` (admin-gated body) |
| `public.bexio_get_active_credential_decrypted()` | returns the active row with plaintext tokens for Edge Functions | `service_role` only |
| `public.bexio_complete_oauth(...)` | atomic OAuth completion: state-validate, deactivate-old, insert-new, mark-state-used, audit | `service_role` only |
| `public.bexio_record_token_refresh(...)` | atomic refresh write + audit | `service_role` only |
| `public.bexio_set_credentials_revoked(uuid, text)` | atomic flip-to-inactive + audit | `service_role` only |

**Search-path note (00022 fix-up):** the encryption helpers use `set search_path = public, extensions` (NOT `vault`). `vault.decrypted_secrets` is referenced fully-qualified inside the function body. Including `vault` on the search_path causes Supabase Cloud's pooler to terminate the connection when an `authenticated` role hits the EXECUTE-denied check, because `authenticated` lacks USAGE on the locked-down `vault` schema.

**Key rotation** (manual, ops-driven): create `bexio_token_key_v2`, define `_v2` helpers, re-encrypt all rows under v2, drop v1 helpers + secret in a follow-up migration.

### Generic audit trigger

Migration `00014_audit_triggers_and_cron.sql` ships `public.audit_trigger_fn()` — a delta-aware `AFTER INSERT OR UPDATE OR DELETE` trigger for the 11 Sprint-1 business tables (see migration for the list). It records only columns that actually changed and suppresses `updated_at` / `updated_by` to keep noise out of audit.

**Contract — UUID primary key required.** `audit_trigger_fn()` writes `entity_id` by casting `(to_jsonb(NEW/OLD) ->> 'id')::uuid`. Every public table is mandated to have a UUID `id` column (see "Naming conventions" below — `bigint`/`serial`/`identity` PKs are forbidden), so this is a non-issue today. If a future migration creates a public table that legitimately cannot have a UUID `id` (e.g., a junction table without a surrogate key), DO NOT bind `audit_trigger_fn` to it: introduce a `uuid` surrogate column or write a per-table audit trigger that derives `entity_id` differently. Re-bumped in 00016 header.

**Binding recipe for a new table** (copy into the migration that creates the table):

```sql
drop trigger if exists trg_<table>_audit on public.<table>;
create trigger trg_<table>_audit
  after insert or update or delete on public.<table>
  for each row execute function public.audit_trigger_fn('updated_at', 'updated_by');
```

Pass column names to `audit_trigger_fn()` as TG_ARGV[] to suppress them from the delta (useful for timestamp-only updates and derived columns). For tables without `updated_at` / `updated_by`, pass fewer arguments.

### FK ON DELETE SET NULL on audit_log / error_log

`audit_log.actor_user_id`, `error_log.user_id`, and `error_log.resolved_by` all reference `user_profiles(id) ON DELETE SET NULL`. This means deleting a `user_profiles` row triggers a system-emitted UPDATE on the log tables. Without an exception, the immutability trigger (`audit_log_immutable`) and update-guard (`error_log_update_guard`) would block this cascade and admin couldn't delete a user with audit history.

Migration `00016_story_1_5_review_critical_fixes.sql` introduced narrow cascade-allow branches; migration `00017_story_1_5_review_round3_fixes.sql` decomposed the guards into orthogonal checks so the dual-cascade case (`user_id` AND `resolved_by` of the same `error_log` row both nulled in one trigger invocation — realistic when a user logs an error and later resolves it themselves) is handled naturally:

- **Immutable columns** (any change → 42501): `id`, `error_type`, `severity`, `source`, `message`, `details`, `entity`, `entity_id`, `request_id`, `created_at` (and the analogous set on `audit_log`).
- **FK-cascade column** (only the non-null → NULL transition is permitted): `audit_log.actor_user_id`, `error_log.user_id`. Any other change → 42501.
- **Resolution columns** (free, error_log only): `resolved_at`, `resolved_by`, `resolution_notes`. `resolved_by` cascade transitions are absorbed transparently here.

**Practical implication:** when admin deletes a `user_profiles` row, the historical audit/error rows persist with their actor/user reference nulled. The forensic trail (action, entity, before/after, timestamp, request_id) survives. Both single-FK cascades (audit_log) and the dual-FK cascade (error_log: user_id + resolved_by simultaneously) are validated by smoke Case J.

### Error-log write path — `log_error()`

Shipped in `00013_error_log.sql`. Signature:

```sql
log_error(
  p_error_type  text,  -- BEXIO_API | RLS_VIOLATION | VALIDATION | EDGE_FUNCTION | DB_FUNCTION | REALTIME | AUTH | MIGRATION | TOUR_PLANNING | INVENTORY | MAIL_PROVIDER | EXTERNAL_API | OTHER
  p_severity    text,  -- critical | error | warning | info
  p_source      text,
  p_message     text,
  p_details     jsonb default '{}'::jsonb,
  p_entity      text default null,
  p_entity_id   uuid default null,
  p_request_id  text default null
) returns uuid
```

- `SECURITY DEFINER`, best-effort (`EXCEPTION WHEN OTHERS` swallows + emits `pg_notify('error_log_write_failed', …)`, returns NULL).
- Never rolls back the caller's transaction.
- **nDSG rule:** `p_details` MUST NOT contain raw customer PII (names, addresses, insurance numbers, emails). Pass IDs + structured codes only.
- From TypeScript: `lib/utils/error-log.ts` exports `logError({ errorType, severity, source, message, details?, entity?, entityId?, requestId? }, supabaseClient)`.

## Storage policies

Migrations `00018` (buckets) + `00019` (policies on `storage.objects`) ship the storage foundation. See [`heimelig-os/supabase/storage/README.md`](../storage/README.md) for the per-bucket reference (MIME allowlist, size limits, path conventions, role matrix).

**Policy naming.** `{bucket_id_with_underscores}_{role}_{op}` — e.g. `medical_certs_admin_insert`, `qr_labels_warehouse_select`, `signatures_office_select`. Bucket ids contain hyphens (`medical-certs`); identifier names cannot, so the slug uses underscores. Documented to head off the typo flag.

**Predicate idiom.** Every storage policy uses the same predicate shape:

```sql
bucket_id = '<bucket>'
  and public.is_<role>()
  and public.storage_first_segment_is_uuid(name)
```

`public.storage_first_segment_is_uuid(text) returns boolean` (defined in `00019`) checks that the first folder segment of the object path matches the canonical UUID shape. Today the policies enforce **shape only** for the first-segment entity (the entity-existence join lives in the consumer-story migration that adds the referenced table — `rental_contracts` for `medical-certs`, `tour_stops` for `signatures`/`qr-labels` technician scope).

**Idempotency.** Every policy is `drop policy if exists ... ; create policy ...`. A second `supabase db push --linked` is a no-op.

**Forbidden in storage policies.** Never use `for all` (every cell of the role matrix is enumerated); never grant to `anon` or `public`; never inline `auth.jwt() ->> 'app_role'` (use the helper functions); never bind a generic audit trigger to `storage.objects` (the table rotates frequently — log business events from the consumer story's app code instead).

## Per-migration checklist

- [ ] Filename matches `NNNNN_description.sql` and the number is the next free slot in the relevant reserved range.
- [ ] Idempotent where possible (`create … if not exists`, `drop … if exists`, `create or replace`).
- [ ] `enable row level security` + `force row level security` for every new public table.
- [ ] Policies use helper functions, target `authenticated`, follow naming convention.
- [ ] `set_updated_at` trigger bound on tables with `updated_at`.
- [ ] `pnpm db:types` regenerated and committed alongside the migration.
- [ ] Zod schemas reconciled — `pnpm typecheck` green.
