-- Migration 00039 — Story 2.5 review round 1.
-- Ships `public.search_customer_ids(q text)` so the customer list query can
-- satisfy AC2 verbatim: substring search across customer columns AND embedded
-- customer_addresses.{street,city,zip}.
--
-- Why a function and not PostgREST `.or()`:
--   PostgREST cannot OR across a to-many embed without forcing `!inner`. With
--   `!inner` the join would silently drop customers that have no active
--   address row (every freshly created customer until their primary address
--   is saved), which violates the spec ("a fast, filterable customer list…
--   find any customer in <3 s"). A function side-steps the constraint by
--   doing the OR in pure SQL with a LEFT JOIN, returning DISTINCT customer
--   ids. The list query then narrows by `.in("id", searchedIds)`.
--
-- Trigram coverage: the GIN trigram indexes from migration 00035 already
-- cover all six customer columns + the three address columns. EXPLAIN ANALYZE
-- on this function for ≥3-char queries should show Bitmap Index Scan on
-- those indexes (verified by smoke Case A address branches).
--
-- Security:
--   - LANGUAGE sql STABLE — read-only, planner-cacheable per snapshot.
--   - SECURITY INVOKER (default) — caller's RLS applies. Office/admin users
--     see all customers; warehouse/technician role gating is enforced by
--     the existing customers + customer_addresses policies.
--   - q is interpolated into ILIKE patterns via concatenation — Postgres
--     parses the parameter as a typed bind, so SQL injection is prevented
--     by the protocol, not by escaping. Wildcards `%` and `_` typed by the
--     user collapse into the ILIKE pattern (acceptable: the user is doing
--     a fuzzy search; if they want a literal `%` they can refine with
--     additional terms — same behaviour as the existing `.or(...ilike)`).
--
-- Idempotency: `create or replace function` so a second `db push` is a no-op
-- after the first.

create or replace function public.search_customer_ids(q text)
  returns setof uuid
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select distinct c.id
    from public.customers c
    left join public.customer_addresses a
      on a.customer_id = c.id
     and a.is_active = true
   where c.first_name      ilike '%' || q || '%'
      or c.last_name       ilike '%' || q || '%'
      or c.company_name    ilike '%' || q || '%'
      or c.customer_number ilike '%' || q || '%'
      or c.phone           ilike '%' || q || '%'
      or c.email           ilike '%' || q || '%'
      or a.street          ilike '%' || q || '%'
      or a.city            ilike '%' || q || '%'
      or a.zip             ilike '%' || q || '%'
$$;

comment on function public.search_customer_ids(text) is
  'Story 2.5 — returns distinct customer ids matching `q` across customer + address substring columns. Backed by trigram indexes from migration 00035. SECURITY INVOKER — caller RLS applies.';

grant execute on function public.search_customer_ids(text) to authenticated;
