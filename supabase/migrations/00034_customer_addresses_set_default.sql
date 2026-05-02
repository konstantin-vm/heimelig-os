-- Migration 00034 — Story 2.4 (Persistent Address Notes).
-- Adds `set_default_customer_address(uuid)` SECURITY DEFINER RPC for atomic
-- Hauptadresse-pro-Typ promote+demote within the (customer_id, address_type)
-- partition. Mirrors `set_primary_customer_insurance(uuid)` (00027 + 00031
-- review-fix pattern) and `set_primary_contact_person(uuid)` (00024).
--
-- Why a dedicated RPC: the partial unique index
-- `idx_customer_addresses_default_per_type_unique`
-- on (customer_id, address_type) WHERE is_default_for_type
-- (created in 00006:91-93) rejects a naive `UPDATE … SET is_default_for_type =
-- true` if another active row in the same partition already has the flag set,
-- depending on statement ordering within a single transaction. The RPC
-- demotes the existing default before promoting the target, in one txn.
--
-- The audit_trigger_fn (Story 1.5, 00014:121) is already bound to
-- customer_addresses, so each demote+promote yields one audit_log row per
-- mutated row — never call log_activity() manually for this table.
--
-- Defense-in-depth guards (Story 2.3 review-1 patterns applied preemptively):
--   * is_active guard — promoting a soft-deleted target raises P0002. The
--     soft-delete path also clears is_default_for_type=false, so a stale
--     dialog cannot promote an inactive row and demote a sibling.
--   * primary-type rejection — the dialog excludes 'primary' from the type
--     picker, but the RPC also rejects address_type='primary' targets.
--     Primary defaults are owned exclusively by Story 2.1's
--     `create_customer_with_primary_address` /
--     `update_customer_with_primary_address` RPCs.
--   * is_admin() OR is_office() role gate.
--   * `set search_path = public` — Story 2.1 review fix carried into 2.3,
--     applied again here. Drop pg_temp from definer search paths.

create or replace function public.set_default_customer_address(
  p_address_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id   uuid;
  v_address_type  text;
  v_is_active     boolean;
begin
  if not (public.is_admin() or public.is_office()) then
    raise exception 'Permission denied: set_default_customer_address'
      using errcode = '42501';
  end if;

  select customer_id, address_type, is_active
    into v_customer_id, v_address_type, v_is_active
    from public.customer_addresses
    where id = p_address_id
    for update;

  if v_customer_id is null then
    raise exception 'customer_addresses row % not found', p_address_id
      using errcode = 'P0002';
  end if;

  if not v_is_active then
    raise exception 'customer_addresses row % is inactive — restore before promoting', p_address_id
      using errcode = 'P0002';
  end if;

  if v_address_type = 'primary' then
    raise exception 'primary defaults are managed by Story 2.1 RPCs, not set_default_customer_address'
      using errcode = '22023';
  end if;

  update public.customer_addresses
    set is_default_for_type = false
    where customer_id = v_customer_id
      and address_type = v_address_type
      and is_default_for_type
      and id <> p_address_id;

  update public.customer_addresses
    set is_default_for_type = true
    where id = p_address_id
      and not is_default_for_type;
end;
$$;

comment on function public.set_default_customer_address(uuid) is
  'Atomically promote an active customer_addresses row to is_default_for_type = true and demote any existing default for the same (customer_id, address_type) partition. Rejects soft-deleted targets and address_type=primary (P0002 / 22023). Audit rows emitted via audit_trigger_fn binding from 00014.';

revoke execute on function public.set_default_customer_address(uuid) from public, anon;
grant  execute on function public.set_default_customer_address(uuid) to authenticated;
