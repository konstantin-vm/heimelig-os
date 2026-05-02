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
| `00032+`       | Epic 2–9 stories. Range gets reserved when the story is created.  |

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
