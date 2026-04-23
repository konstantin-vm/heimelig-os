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
| `00001–00009`  | Story 1.3 — foundation schema + RLS (in use).       |
| `00010`        | Reserved (buffer for Story 1.3 fix-ups).            |
| `00011–00014`  | Story 1.5 — audit_log / error_log infrastructure.   |
| `00015–00017`  | Story 1.6 — storage bucket policies.                |
| `00018–00019`  | Story 1.7 — bexio credentials + OAuth2 plumbing.    |
| `00020+`       | Epic 2–9 stories. Announce + reserve before using.  |

Before creating a new migration file, **announce the number in `#client-heimelig-custom-erp`** and wait ~1 minute for an ACK from the other developer. The numeric gate is the only coordination mechanism we have — collisions corrupt the migration history.

## Coordination protocol

1. `ls supabase/migrations/` to see the highest in-use number.
2. Claim the next `NNNNN` in Slack with the filename you intend to create.
3. Create the file *only* after the ACK.
4. Never edit an applied migration — write a follow-up migration instead.

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

## `log_activity()` placeholder

`log_activity()` ships in Story 1.5. Until then, every write path that will eventually emit an audit record should carry a `-- TODO(1.5): log_activity(...)` comment with the intended call shape. This keeps the audit trail visible in review while the function itself is pending.

## Per-migration checklist

- [ ] Filename matches `NNNNN_description.sql` and the number was announced.
- [ ] Idempotent where possible (`create … if not exists`, `drop … if exists`, `create or replace`).
- [ ] `enable row level security` + `force row level security` for every new public table.
- [ ] Policies use helper functions, target `authenticated`, follow naming convention.
- [ ] `set_updated_at` trigger bound on tables with `updated_at`.
- [ ] `pnpm db:types` regenerated and committed alongside the migration.
- [ ] Zod schemas reconciled — `pnpm typecheck` green.
