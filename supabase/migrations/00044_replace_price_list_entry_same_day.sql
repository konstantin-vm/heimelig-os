-- Migration 00044 — Story 3.1 round-1 patch.
-- Fix: `replace_price_list_entry` raises 23P01 (GIST exclusion conflict)
-- when called twice on the same (article, list_name) on the same day.
--
-- Root cause: 00043 closes the open entry by setting `valid_to = p_valid_from`
-- (half-open `[)` disjointness). When the open entry's `valid_from` already
-- equals `p_valid_from`, the close produces an empty/inverted range
-- (`[X, X)`) which the `price_lists_valid_range` CHECK rejects, AND the
-- `valid_from < p_valid_from` guard in 00043 silently skipped the close —
-- so the subsequent INSERT then collided on the GIST exclusion.
--
-- The smoke matrix (Case D) caught this at story close-out; the
-- `<PriceListEditDialog>` UX explicitly supports a typo-correction flow
-- where the user enters a price, immediately notices it's wrong, and
-- re-submits with the corrected amount on the same day.
--
-- Fix: when the open entry's `valid_from` equals `p_valid_from`, treat the
-- call as a same-day amount correction and UPDATE the existing row's
-- `amount` + `notes` in place. This preserves the row id (best-of-both-
-- worlds for Bestandsschutz: any contract that referenced the row earlier
-- today gets the corrected amount, which IS what the user intends when
-- fixing a typo). For all other cases the behavior is unchanged
-- (close-old via `valid_to = p_valid_from` + insert-new).
--
-- Idempotent on replay: the function is `create or replace` and the
-- decision tree is deterministic.

create or replace function public.replace_price_list_entry(
  p_article_id uuid,
  p_list_name  text,
  p_amount     numeric,
  p_valid_from date    default current_date,
  p_notes      text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_id        uuid;
  v_existing_valid_from date;
  v_new_id             uuid;
begin
  -- Admin/office gate (defense-in-depth — RLS already enforces this on
  -- the INSERT/UPDATE paths below, but raising explicitly produces a
  -- clearer error code than a generic RLS denial).
  if not (public.is_admin() or public.is_office()) then
    raise insufficient_privilege using
      message = 'Nur admin/office dürfen Preise ändern',
      errcode = '42501';
  end if;

  -- Argument validation (Zod-parity at the RPC boundary).
  if p_article_id is null then
    raise exception 'p_article_id darf nicht NULL sein' using errcode = '22023';
  end if;
  if p_list_name is null
     or p_list_name not in ('helsana','sanitas','visana','kpt','private') then
    raise exception 'Ungültiger list_name: %', p_list_name using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'amount muss >= 0 sein' using errcode = '23514';
  end if;
  if p_valid_from is null then
    raise exception 'p_valid_from darf nicht NULL sein' using errcode = '22023';
  end if;

  -- Verify the article exists.
  if not exists (select 1 from public.articles where id = p_article_id) then
    raise exception 'Artikel % existiert nicht', p_article_id using errcode = '23503';
  end if;

  -- Look up the currently-open entry (if any) for this (article, list).
  -- Lock it for the close/update so a parallel call can't sneak between
  -- the SELECT and the WRITE.
  select id, valid_from
    into v_existing_id, v_existing_valid_from
    from public.price_lists
   where article_id = p_article_id
     and list_name  = p_list_name
     and valid_to is null
   for update;

  if v_existing_id is not null and v_existing_valid_from = p_valid_from then
    -- Same-day re-edit — UPDATE the existing row's amount in place. This
    -- preserves the row id; any contract referencing it (price_snapshot_
    -- source_id, Epic 5) automatically picks up the corrected amount,
    -- which matches the user's typo-correction intent.
    update public.price_lists
       set amount     = p_amount,
           notes      = p_notes,
           updated_by = auth.uid()
     where id = v_existing_id
     returning id into v_new_id;
    return v_new_id;
  end if;

  -- General case — close the open entry (if its valid_from is strictly
  -- earlier than the new valid_from; otherwise it's a future-dated entry
  -- that we leave alone) and insert the new row.
  if v_existing_id is not null and v_existing_valid_from < p_valid_from then
    update public.price_lists
       set valid_to   = p_valid_from,
           updated_by = auth.uid()
     where id = v_existing_id;
  end if;

  insert into public.price_lists (
    article_id, list_name, amount, currency,
    valid_from, valid_to, notes,
    created_by, updated_by
  )
  values (
    p_article_id, p_list_name, p_amount, 'CHF',
    p_valid_from, null, p_notes,
    auth.uid(), auth.uid()
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

comment on function public.replace_price_list_entry(uuid, text, numeric, date, text) is
  'Atomic price replacement for a single (article, list_name) pair. Three '
  'cases: (1) no open entry → INSERT only. (2) open entry with earlier '
  'valid_from → close via valid_to=p_valid_from + INSERT new (preserves '
  'Bestandsschutz). (3) open entry with same valid_from → UPDATE in place '
  '(same-day typo correction; row id preserved). Admin/office gated.';
