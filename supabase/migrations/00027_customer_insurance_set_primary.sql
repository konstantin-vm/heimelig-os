-- Migration 00027 — Story 2.3 (Health Insurance Details).
-- Two changes in one idempotent migration:
--   1. Replace `idx_customer_insurance_primary_grund_unique` (Grund-only) with
--      `idx_customer_insurance_primary_unique` on (customer_id, insurance_type)
--      WHERE is_primary — aligns the live schema with data-model-spec §5.2.3
--      (one primary per (customer, insurance_type) partition; Grund and Zusatz
--      primaries can coexist for the same customer).
--   2. New `set_primary_customer_insurance(uuid)` SECURITY DEFINER RPC for
--      atomic Hauptversicherung promote+demote within a single
--      (customer_id, insurance_type) partition. Mirrors
--      `set_primary_contact_person(uuid)` from migration 00024.
--
-- The audit_trigger_fn (Story 1.5, 00014:120-122) is already bound to
-- customer_insurance, so each demote+promote yields one audit_log row per
-- mutated row — never call log_activity() manually for this table.

-- ---------------------------------------------------------------------------
-- 1. Partial-unique index alignment
-- ---------------------------------------------------------------------------

drop index if exists public.idx_customer_insurance_primary_grund_unique;

create unique index if not exists idx_customer_insurance_primary_unique
  on public.customer_insurance (customer_id, insurance_type)
  where is_primary;

-- ---------------------------------------------------------------------------
-- 2. set_primary_customer_insurance RPC
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
begin
  if not (public.is_admin() or public.is_office()) then
    raise exception 'Permission denied: set_primary_customer_insurance'
      using errcode = '42501';
  end if;

  select customer_id, insurance_type
    into v_customer_id, v_insurance_type
    from public.customer_insurance
    where id = p_insurance_id
    for update;

  if v_customer_id is null then
    raise exception 'customer_insurance row % not found', p_insurance_id
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
  'Atomically promote a customer_insurance row to is_primary = true and demote any existing primary for the same (customer_id, insurance_type) partition. Sidesteps idx_customer_insurance_primary_unique race. Audit rows emitted via audit_trigger_fn binding from 00014.';

revoke execute on function public.set_primary_customer_insurance(uuid) from public, anon;
grant  execute on function public.set_primary_customer_insurance(uuid) to authenticated;
