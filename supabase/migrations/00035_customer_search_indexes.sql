-- Migration 00035 — Story 2.5 (Customer Search, Filter & Profile).
-- Adds GIN trigram indexes to accelerate the substring (ILIKE %q%) search
-- across the customer-domain columns surfaced by the S-003 customer list.
--
-- Why GIN trigram indexes (pg_trgm):
--   The list query composes filters via PostgREST `.or(...ilike...)` clauses
--   spanning customers (first_name, last_name, company_name, customer_number,
--   phone, email) AND embedded customer_addresses (street, city, zip).
--   Without trigram indexes, every search degrades to a sequential scan; at
--   ~5k active customers the budget for AC4 (<2 s end-to-end) is broken.
--   `gin_trgm_ops` accelerates `ILIKE '%q%'` for queries with ≥3 chars.
--   For 1-2 char queries the planner falls back to seq scan; that is
--   acceptable because (a) result sets are large, (b) the UI debounces 250 ms
--   so users typically commit ≥3 chars before a query fires.
--
-- pg_trgm is enabled by default on Supabase Cloud projects, but the
-- `create extension if not exists` is idempotent and protects fresh local
-- environments + CI replays.
--
-- All indexes are created with `if not exists` so a second `supabase db push`
-- produces zero diff. The story's smoke matrix Case F asserts the planner
-- actually picks a `Bitmap Index Scan on idx_*_trgm` for non-trivial
-- searches (proves the indexes are wired into the planner, not dead).
--
-- No schema-shape change — `pnpm db:types` is byte-identical pre/post.
--
-- ─── DEPLOY-TIME WARNING ───────────────────────────────────────────────────
-- These `create index` statements run inside the migration transaction WITHOUT
-- `CONCURRENTLY`, so each index acquires a SHARE lock on its table for the
-- duration of the build. At today's pre-import volume (~500–600 rows) every
-- index is sub-second and harmless. **Before the Blue-Office import ships
-- (~5–10k rows + concurrent office traffic) this migration must be split into
-- per-statement post-deploy migrations using `CREATE INDEX CONCURRENTLY` to
-- avoid blocking writes.** Tracked in deferred-work.md.

create extension if not exists pg_trgm;

-- customers ------------------------------------------------------------------

create index if not exists idx_customers_first_name_trgm
  on public.customers using gin (first_name gin_trgm_ops);

create index if not exists idx_customers_last_name_trgm
  on public.customers using gin (last_name gin_trgm_ops);

create index if not exists idx_customers_company_name_trgm
  on public.customers using gin (company_name gin_trgm_ops);

create index if not exists idx_customers_customer_number_trgm
  on public.customers using gin (customer_number gin_trgm_ops);

create index if not exists idx_customers_phone_trgm
  on public.customers using gin (phone gin_trgm_ops);

create index if not exists idx_customers_email_trgm
  on public.customers using gin (email gin_trgm_ops);

-- customer_addresses ---------------------------------------------------------

create index if not exists idx_customer_addresses_street_trgm
  on public.customer_addresses using gin (street gin_trgm_ops);

create index if not exists idx_customer_addresses_city_trgm
  on public.customer_addresses using gin (city gin_trgm_ops);

create index if not exists idx_customer_addresses_zip_trgm
  on public.customer_addresses using gin (zip gin_trgm_ops);
