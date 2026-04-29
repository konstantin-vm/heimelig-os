-- Migration 00031 — Story 2.3 review fixes.
-- Two changes (idempotent):
--   1. `set_primary_customer_insurance(uuid)` RPC now guards on is_active so
--      stale dialogs (or bad callers) cannot promote soft-deleted rows. The
--      previous version (00027) silently promoted is_active=false rows — which,
--      combined with the now-cleared is_primary on soft-delete (Story 2.3
--      review patch in lib/queries/customers.ts), would corrupt the partition.
--   2. Defensive cleanup against pre-existing duplicate primaries before the
--      `idx_customer_insurance_primary_unique` index is re-asserted. 00027
--      created the index with `if not exists`, which DOES NOT skip on duplicate
--      data — it would fail. Cloud was clean, but `db push --linked` against a
--      populated environment (or a fresh CI replay with seed data) could break.
--      We demote all-but-newest active primary per (customer_id, insurance_type)
--      partition before re-asserting the index. Inactive rows are also demoted
--      (matches the soft-delete-clears-is_primary contract from the same patch
--      round).

-- ---------------------------------------------------------------------------
-- 1. Defensive cleanup of duplicate primaries
-- ---------------------------------------------------------------------------

-- Soft-deleted rows: clear is_primary unconditionally. Aligns the live data
-- with the new soft-delete semantics from this review round (the app already
-- writes is_primary=false on soft-delete; this back-fills any pre-existing
-- inactive primaries from before the patch landed).
update public.customer_insurance
   set is_primary = false
 where is_active = false
   and is_primary;

-- Active rows: when more than one primary exists in a (customer_id,
-- insurance_type) partition, keep only the most recently created and demote
-- the rest. Newest-wins matches the dialog's UX (a save with is_primary=true
-- is the user's most recent intent). Audit_log retains the demote rows via
-- the existing audit_trigger_fn binding.
with ranked as (
  select id,
         row_number() over (
           partition by customer_id, insurance_type
           order by created_at desc, id desc
         ) as rn
    from public.customer_insurance
   where is_active
     and is_primary
)
update public.customer_insurance ci
   set is_primary = false
  from ranked
 where ci.id = ranked.id
   and ranked.rn > 1;

-- ---------------------------------------------------------------------------
-- 2. Re-assert the partial-unique index (no-op if already in place)
-- ---------------------------------------------------------------------------

create unique index if not exists idx_customer_insurance_primary_unique
  on public.customer_insurance (customer_id, insurance_type)
  where is_primary;

-- ---------------------------------------------------------------------------
-- 3. RPC: add is_active guard
-- ---------------------------------------------------------------------------

create or replace function public.set_primary_customer_insurance(
  p_insurance_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id     uuid;
  v_insurance_type  text;
  v_is_active       boolean;
begin
  if not (public.is_admin() or public.is_office()) then
    raise exception 'Permission denied: set_primary_customer_insurance'
      using errcode = '42501';
  end if;

  select customer_id, insurance_type, is_active
    into v_customer_id, v_insurance_type, v_is_active
    from public.customer_insurance
    where id = p_insurance_id
    for update;

  if v_customer_id is null then
    raise exception 'customer_insurance row % not found', p_insurance_id
      using errcode = 'P0002';
  end if;

  -- Reject promotion of soft-deleted rows. A stale dialog or out-of-band
  -- caller could otherwise promote an is_active=false row, demoting an
  -- active sibling and leaving an invisible primary.
  if not v_is_active then
    raise exception 'customer_insurance row % is inactive — restore before promoting', p_insurance_id
      using errcode = 'P0002';
  end if;

  update public.customer_insurance
    set is_primary = false
    where customer_id = v_customer_id
      and insurance_type = v_insurance_type
      and is_primary
      and id <> p_insurance_id;

  update public.customer_insurance
    set is_primary = true
    where id = p_insurance_id
      and not is_primary;
end;
$$;

comment on function public.set_primary_customer_insurance(uuid) is
  'Atomically promote an active customer_insurance row to is_primary = true and demote any existing primary for the same (customer_id, insurance_type) partition. Rejects soft-deleted targets (P0002). Audit rows emitted via audit_trigger_fn binding from 00014.';

revoke execute on function public.set_primary_customer_insurance(uuid) from public, anon;
grant  execute on function public.set_primary_customer_insurance(uuid) to authenticated;
