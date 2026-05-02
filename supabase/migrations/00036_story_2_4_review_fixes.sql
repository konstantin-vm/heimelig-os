-- Migration 00036 — Story 2.4 review fixes.
-- Two changes (idempotent):
--   1. Re-emit `set_default_customer_address(uuid)` with a partition-wide
--      `select … for update` BEFORE demoting the existing default. The 00034
--      version locked only the target row, so a concurrent same-partition
--      promote-or-INSERT could race between the demote and the promote and
--      fall over with 23505 on the partial-unique
--      `idx_customer_addresses_default_per_type_unique`. The fix
--      serializes the partition without changing the function contract.
--      (The same gap exists in `set_primary_customer_insurance` (00031) and
--      `set_primary_contact_person` (00024); a cross-cutting follow-up should
--      address both — out of scope here.)
--   2. Defensive back-fill of soft-deleted rows that still hold
--      `is_default_for_type = true`. The 00006 schema defaults the column to
--      `true`, so any pre-2.4 soft-deleted rows occupy the partial-unique
--      slot and would block any new default of the same type with a
--      confusing 23505. The app already writes `is_default_for_type = false`
--      on every soft-delete (Story 2.3 review trap, applied in 2.4); this
--      migration aligns the live data with that contract. Mirrors the
--      insurance back-fill in 00031.
--
-- Idempotent: the back-fill UPDATE is a WHERE-filtered no-op once applied;
-- `create or replace function` is replay-safe.

-- ---------------------------------------------------------------------------
-- 1. Back-fill soft-deleted rows with is_default_for_type = true
-- ---------------------------------------------------------------------------

update public.customer_addresses
   set is_default_for_type = false
 where not is_active
   and is_default_for_type;

-- ---------------------------------------------------------------------------
-- 2. RPC — add partition lock before demote+promote
-- ---------------------------------------------------------------------------

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

  -- Lock every active row in the same (customer_id, address_type) partition
  -- before mutating. Without this, a concurrent INSERT or promote in another
  -- session can race between the demote UPDATE and the promote UPDATE,
  -- yielding either a 23505 from the partial-unique index or a
  -- non-deterministic winner. PERFORM is correct here — we don't need the
  -- rows themselves, only the row-level locks.
  perform 1
    from public.customer_addresses
    where customer_id = v_customer_id
      and address_type = v_address_type
      and is_active
      and id <> p_address_id
    for update;

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
  'Atomically promote an active customer_addresses row to is_default_for_type = true and demote any existing default for the same (customer_id, address_type) partition, with a partition-wide row-lock to serialize concurrent promotes. Rejects soft-deleted targets and address_type=primary (P0002 / 22023). Audit rows emitted via audit_trigger_fn binding from 00014.';

revoke execute on function public.set_default_customer_address(uuid) from public, anon;
grant  execute on function public.set_default_customer_address(uuid) to authenticated;
