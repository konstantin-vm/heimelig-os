-- Migration 00037 — Story 2.4 review round 2 fix.
--
-- Re-emit `set_default_customer_address(uuid)` with deterministic lock
-- acquisition order. The 00036 version locked the target row first, then
-- PERFORMed `for update` over the rest of the partition (`id <> p_address_id`).
-- Two sessions A and B promoting different active targets X and Y in the
-- same `(customer_id, address_type)` partition each grab their own target
-- lock first, then mutually wait on each other → Postgres aborts one with
-- `40P01 deadlock_detected`.
--
-- Fix: lock the entire partition with a single `select ... order by id
-- for update` BEFORE any metadata read or mutate. Both sessions acquire
-- locks in the same order, so the second one queues behind the first
-- instead of deadlocking.
--
-- Idempotent: `create or replace function` is replay-safe.

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

  -- Resolve target metadata WITHOUT taking a row lock yet, so we can
  -- compute the partition predicate before locking.
  select customer_id, address_type, is_active
    into v_customer_id, v_address_type, v_is_active
    from public.customer_addresses
    where id = p_address_id;

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

  -- Lock the ENTIRE active partition (target + siblings) in deterministic
  -- `id` order before any mutate. Two concurrent calls acquire row locks in
  -- the same order, so they serialize instead of deadlocking. Without the
  -- `order by` (or with `id <> p_address_id` exclusion as in 00036), two
  -- sessions could each lock their own target first and then mutually wait
  -- on each other's target — classic 40P01 deadlock.
  perform 1
    from public.customer_addresses
    where customer_id = v_customer_id
      and address_type = v_address_type
      and is_active
    order by id
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
  'Atomically promote an active customer_addresses row to is_default_for_type = true and demote any existing default for the same (customer_id, address_type) partition. Locks the entire active partition in deterministic id order to prevent 40P01 deadlocks under concurrent promotes. Rejects soft-deleted targets and address_type=primary (P0002 / 22023). Audit rows emitted via audit_trigger_fn binding from 00014.';

revoke execute on function public.set_default_customer_address(uuid) from public, anon;
grant  execute on function public.set_default_customer_address(uuid) to authenticated;
