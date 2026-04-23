-- Migration 00010 — Story 1.3 review fixes.
-- Derived from the Story 1.3 code review (2026-04-23).
--
-- Covers:
--   D1  articles.is_serialized: drop column default so the BEFORE INSERT trigger
--       actually fires for omitted columns.
--   D4  customer_insurance: XOR between partner_insurer_id and non-empty
--       insurer_name_freetext (prevents whitespace-only + both-set ambiguity).
--   D5  customer_insurance: one primary per (customer, insurance_type),
--       widened from "grund-only".
--   P1  user_profiles_self_update_guard: rewrite blacklist → whitelist so new
--       columns on user_profiles default-deny for non-admins (also closes the
--       updated_by spoofing hole).
--   P6  price_lists: reject zero-length ranges (valid_to > valid_from).
--   P10 set_updated_at + articles_default_is_serialized: pin search_path to
--       public, pg_temp for hardening parity with the other helpers.
--
-- Not applied here:
--   D8  "REVOKE DELETE FROM authenticated" — admins are authenticated users
--       with a JWT claim (not a distinct role), so a blanket revoke would
--       block admin hard-delete too. Defense-in-depth will require a
--       SECURITY DEFINER admin-delete RPC; logged in deferred-work.md.

-- D1 --------------------------------------------------------------------------

alter table public.articles
  alter column is_serialized drop default;

-- D4 --------------------------------------------------------------------------
-- Drop the old CHECK (OR with raw-null test) and add a XOR that rejects
-- whitespace-only freetext and disallows both partner_insurer_id +
-- insurer_name_freetext being populated at the same time.

alter table public.customer_insurance
  drop constraint if exists customer_insurance_insurer_required;

alter table public.customer_insurance
  add constraint customer_insurance_insurer_xor check (
    (partner_insurer_id is not null)
    <> (char_length(btrim(coalesce(insurer_name_freetext, ''))) > 0)
  );

-- D5 --------------------------------------------------------------------------
-- Widen the primary partial-unique: one primary per (customer, insurance_type),
-- instead of "grund-only". Keeps zusatz primaries bounded at 1 per customer.

drop index if exists public.idx_customer_insurance_primary_grund_unique;

create unique index if not exists idx_customer_insurance_primary_per_type_unique
  on public.customer_insurance (customer_id, insurance_type)
  where is_primary;

-- P1 --------------------------------------------------------------------------
-- Whitelist-style guard: non-admin updates may only touch phone, mobile,
-- display_name, color_hex, settings. Any other column change (including new
-- future columns and updated_by) is rejected.

create or replace function public.user_profiles_self_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  -- Identity-ish: id must never change for non-admins.
  if new.id is distinct from old.id then
    raise exception 'user_profiles.id is immutable'
      using errcode = '42501';
  end if;

  -- Every column except the 5-field whitelist must equal its previous value.
  if new.email        is distinct from old.email
     or new.first_name   is distinct from old.first_name
     or new.last_name    is distinct from old.last_name
     or new.initials     is distinct from old.initials
     or new.app_role     is distinct from old.app_role
     or new.employee_id  is distinct from old.employee_id
     or new.is_active    is distinct from old.is_active
     or new.notes        is distinct from old.notes
     or new.created_at   is distinct from old.created_at
     or new.created_by   is distinct from old.created_by
     or new.updated_by   is distinct from old.updated_by
  then
    raise exception 'Non-admin users may only update phone, mobile, display_name, color_hex, settings'
      using errcode = '42501';
  end if;

  -- Defence-in-depth: force updated_by to the acting user, never trust NEW.
  new.updated_by := auth.uid();

  return new;
end;
$$;

-- P6 --------------------------------------------------------------------------
-- Reject zero-length ranges (valid_from = valid_to creates an empty daterange
-- that bypasses the no-overlap EXCLUDE constraint).

alter table public.price_lists
  drop constraint if exists price_lists_valid_range;

alter table public.price_lists
  add constraint price_lists_valid_range check (
    valid_to is null or valid_to > valid_from
  );

-- P10 -------------------------------------------------------------------------
-- search_path hardening parity with 00001 helpers.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.articles_default_is_serialized()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- With the column default dropped (D1) NEW.is_serialized is NULL whenever
  -- the client omits the column, so the trigger now actually applies.
  if new.is_serialized is null then
    new.is_serialized := (new.type = 'rental');
  end if;
  return new;
end;
$$;
