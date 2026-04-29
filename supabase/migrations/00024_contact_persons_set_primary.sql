-- Migration 00024 — Atomic Hauptkontakt promote+demote RPC.
-- Story 2.2 (Contact Persons).
-- See _bmad-output/implementation-artifacts/2-2-contact-persons.md (AC4, AC9).
--
-- Purpose: the partial unique index `idx_contact_persons_primary_unique`
-- (00006_customers.sql:167) rejects naive "promote-without-demote" UPDATEs
-- since two rows with `is_primary_contact = true` for the same customer can
-- briefly exist mid-statement. This RPC demotes any current primary and
-- promotes the target row in one statement-list, atomically.
--
-- The audit_trigger_fn (Story 1.5, bound to contact_persons in
-- 00014_audit_triggers_and_cron.sql:121) auto-emits one audit_log row per
-- mutated row. A demote+promote therefore yields exactly two audit rows
-- in the caller's transaction.

create or replace function public.set_primary_contact_person(
  p_contact_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid;
begin
  -- Role gate: only admin + office may call. RLS on the underlying table
  -- still applies via force RLS; this is the explicit application contract.
  if not (public.is_admin() or public.is_office()) then
    raise exception 'Permission denied: set_primary_contact_person'
      using errcode = '42501';
  end if;

  select customer_id into v_customer_id
    from public.contact_persons
    where id = p_contact_id;

  if v_customer_id is null then
    raise exception 'contact_persons row % not found', p_contact_id
      using errcode = 'P0002';
  end if;

  -- Demote any current primary for this customer (other than the target).
  update public.contact_persons
    set is_primary_contact = false
    where customer_id = v_customer_id
      and is_primary_contact
      and id <> p_contact_id;

  -- Promote target row. No-op if already primary (delta empty → no audit row).
  update public.contact_persons
    set is_primary_contact = true
    where id = p_contact_id
      and not is_primary_contact;
end;
$$;

comment on function public.set_primary_contact_person(uuid) is
  'Atomically promote contact_persons row to is_primary_contact = true and demote any existing primary for the same customer. Sidesteps idx_contact_persons_primary_unique race. Audit rows emitted via audit_trigger_fn binding from 00014.';

revoke execute on function public.set_primary_contact_person(uuid) from public, anon;
grant  execute on function public.set_primary_contact_person(uuid) to authenticated;
