-- Migration 00046 — Story 3.1 round-1 code-review patches.
--
-- Two fixes to `replace_price_list_entry`:
--
-- 1. Future-dated open entry handling.
--    Previously, when an existing open row had `valid_from > p_valid_from`
--    (a future-dated price waiting to take effect) and the caller submitted
--    a price for today, the function fell through to a plain INSERT. The
--    GIST `price_lists_no_overlap` exclusion correctly rejected the second
--    open range with SQLSTATE 23P01, but the user saw a cryptic Postgres
--    message instead of a domain-meaningful one. Round 1 review (Edge Case
--    Hunter / Acceptance Auditor) flagged this. Fix: detect this case
--    explicitly and raise with a German message + the 23P01 code (so the
--    application-layer mapping in `useReplacePriceListEntry` surfaces the
--    correct toast).
--
-- 2. `notes` preservation on same-day re-edit.
--    The same-day branch UPDATEd `notes = p_notes` unconditionally. When
--    the dialog defaults `p_notes` to NULL (typical case for an amount-only
--    correction) any existing notes on the row were lost. Fix:
--    `notes = coalesce(p_notes, notes)` — only overwrite when the caller
--    actually supplied a notes value.
--
-- Both branches are hot-patches via `create or replace`. Idempotent on
-- replay. No data transformation, no GRANT changes (the function inherits
-- from migration 00045's owner + execute grants).

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
  if not (public.is_admin() or public.is_office()) then
    raise insufficient_privilege using
      message = 'Nur admin/office dürfen Preise ändern';
  end if;

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

  if not exists (select 1 from public.articles where id = p_article_id) then
    raise exception 'Artikel % existiert nicht', p_article_id using errcode = '23503';
  end if;

  -- Look up + lock the open entry (if any).
  select id, valid_from
    into v_existing_id, v_existing_valid_from
    from public.price_lists
   where article_id = p_article_id
     and list_name  = p_list_name
     and valid_to is null
   for update;

  if v_existing_id is not null and v_existing_valid_from = p_valid_from then
    -- Same-day re-edit — UPDATE the existing row's amount in place.
    -- Preserve `notes` when the caller didn't pass an explicit value.
    update public.price_lists
       set amount     = p_amount,
           notes      = coalesce(p_notes, notes),
           updated_by = auth.uid()
     where id = v_existing_id
     returning id into v_new_id;
    return v_new_id;
  end if;

  if v_existing_id is not null and v_existing_valid_from > p_valid_from then
    -- A future-dated open price already exists. Inserting a new row with
    -- an earlier valid_from would either collide with the GIST exclusion
    -- (two open ranges) or invert the temporal ordering. Surface a
    -- domain-meaningful error rather than the generic 23P01.
    raise exception
      'Es existiert bereits ein zukünftig gültiger Preis (gültig ab %). Bitte zuerst diesen Eintrag bearbeiten.',
      v_existing_valid_from
      using errcode = '23P01';
  end if;

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
