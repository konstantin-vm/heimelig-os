-- Migration 00038 — Story 2.5 (Customer Search, Filter & Profile).
-- Wires the customer-domain tables into the `supabase_realtime` publication
-- so the postgres_changes channels mounted by Stories 2.2/2.3/2.4/2.5 can
-- actually fire on row INSERT/UPDATE/DELETE events.
--
-- Discovery: Story 2.5's smoke matrix Case G surfaced that the
-- `supabase_realtime` publication had ZERO tables — the channels mounted by
-- the customer-domain cards in Stories 2.2/2.3/2.4 were architecturally
-- correct but functionally dead because the publication wasn't populated.
-- Story 2.5 AC9 mandates working list + profile realtime, so this gap is
-- fixed here as part of the closing Epic-2 slice rather than deferred to a
-- separate ops story.
--
-- The 4 tables added cover every customer-scoped subscribe target that the
-- Sprint-1 UI mounts:
--   * customers           — Story 2.5 list-page + profile-info-card channels
--   * customer_addresses  — Story 2.4 addresses-card channel
--   * customer_insurance  — Story 2.3 insurance-card channel
--   * contact_persons     — Story 2.2 contacts-card channel
--
-- Idempotent on replay — `if not exists` is added per table via a DO block
-- that checks pg_publication_tables membership before attempting the ALTER.
-- (PostgreSQL's bare ALTER PUBLICATION ADD TABLE raises 42710 if the table
-- is already a member.)
--
-- nDSG note: adding a table to `supabase_realtime` does NOT change where the
-- data lives — Supabase Realtime runs in the same Zürich project and never
-- ships data through Vercel Frankfurt. The channels remain Browser →
-- Supabase Zürich direct.

do $$
declare
  t_name text;
  v_target_tables text[] := ARRAY[
    'customers',
    'customer_addresses',
    'customer_insurance',
    'contact_persons'
  ];
begin
  foreach t_name in array v_target_tables
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        t_name
      );
    end if;
  end loop;
end;
$$;
