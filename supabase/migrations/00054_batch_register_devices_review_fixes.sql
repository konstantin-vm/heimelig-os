-- Migration 00054 — Story 3.6 review fix-up — re-emit `batch_register_devices`.
--
-- Reapplies `public.batch_register_devices(...)` with the patches from the
-- 2026-05-04 code review (Hunter Trio). The function definition mirrors the
-- patched body in 00052 verbatim — this migration exists because the
-- original 00052 was already applied to the linked remote before the review
-- patches landed; adding a follow-up migration is the project convention
-- for review-stage fixes (see 00043 → 00044 → 00045 for Story 3.1).
--
-- Patches applied (vs. the body shipped by the original 00052):
--
--   P1 — Escape POSIX-regex metacharacters in `article_number` before
--        concatenating it into the counter MAX regex. A free-form value
--        like `10.32`, `1032(A)`, `M-99` etc. would otherwise either
--        wildcard-match unrelated articles' serials and corrupt the
--        per-article counter, or raise `invalid_regular_expression` and
--        abort the whole batch with no friendly mapping.
--
--   P2 — Reject batches that would spill into a 6-digit suffix. The
--        regex used by the counter MAX matches `\d{5}$` only, so once a
--        single serial reaches `100000` the counter MAX silently
--        re-extracts `00001` from `100001` and the next batch collides on
--        the UNIQUE serial_number constraint. Hard cap is 99999 minus
--        the running counter; relevant only after ~99k devices per
--        article (decades away in practice).
--
--   P3 — Defense-in-depth `auth.uid() IS NOT NULL` precondition before
--        the INSERT. The role gate already covers this implicitly
--        (SECURITY INVOKER helpers see no claim → false), but the
--        explicit check guards against a future helper rewrite silently
--        landing `created_by = NULL` rows in the audit log.
--
--   D1 — Coalesce `acquired_at` and `inbound_date` into the INSERT, not
--        just into the MMYY computation. The original body wrote the raw
--        `p_acquired_at` (NULL) into `devices.acquired_at` while the
--        serial encoded today's MMYY — month-based reports could not
--        reconstruct the encoded MMYY from the column. The form already
--        defaults to today CET, so the user opting "leave date empty"
--        practically means "use today" — coalescing matches user intent.
--
-- Idempotent on replay (`create or replace`; `revoke` + `grant` +
-- `comment on function` are idempotent).

create or replace function public.batch_register_devices(
  p_article_id        uuid,
  p_quantity          int,
  p_warehouse_id      uuid    default null,
  p_supplier_id       uuid    default null,
  p_acquired_at       date    default null,
  p_acquisition_price numeric default null,
  p_inbound_date      date    default null,
  p_notes             text    default null
)
returns table (id uuid, serial_number text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_article_number         text;
  v_article_number_pattern text;
  v_mmyy                   text;
  v_next_serial            int;
  v_today                  date := (now() at time zone 'Europe/Zurich')::date;
  v_booking_date           date := coalesce(p_acquired_at, v_today);
  v_acquired_at            date := coalesce(p_acquired_at, v_today);
  v_inbound_date           date := coalesce(p_inbound_date, v_today);
  v_acquisition_price      numeric := p_acquisition_price;
begin
  if not (public.is_admin() or public.is_office() or public.is_warehouse()) then
    raise insufficient_privilege using
      message = 'Sammelregistrierung erfordert admin / office / warehouse';
  end if;

  if auth.uid() is null then
    raise insufficient_privilege using
      message = 'Sammelregistrierung erfordert einen authentifizierten Benutzer';
  end if;

  if p_article_id is null then
    raise exception 'p_article_id darf nicht NULL sein' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 50 then
    raise exception 'Anzahl muss zwischen 1 und 50 liegen' using errcode = '22023';
  end if;

  select articles.article_number
    into v_article_number
    from public.articles
   where articles.id = p_article_id
     and articles.is_rentable = true
     and articles.is_active   = true;
  if not found then
    raise exception 'Artikel ist nicht rentable oder nicht aktiv'
      using errcode = '22023';
  end if;

  if p_warehouse_id is not null then
    perform 1 from public.warehouses
      where id = p_warehouse_id and is_active = true;
    if not found then
      raise exception 'Lager ist nicht aktiv' using errcode = '22023';
    end if;
  end if;
  if p_supplier_id is not null then
    perform 1 from public.suppliers
      where id = p_supplier_id and is_active = true;
    if not found then
      raise exception 'Lieferant ist nicht aktiv' using errcode = '22023';
    end if;
  end if;

  if public.is_warehouse() and not (public.is_admin() or public.is_office()) then
    v_acquisition_price := null;
  end if;

  v_mmyy := to_char(v_booking_date, 'MMYY');

  -- P1: escape POSIX-regex metacharacters in article_number.
  v_article_number_pattern :=
    regexp_replace(v_article_number, '([\\^$.|?*+(){}\[\]])', '\\\1', 'g');

  perform pg_advisory_xact_lock(hashtextextended(p_article_id::text, 0));

  select coalesce(max((substring(devices.serial_number from '\d{5}$'))::int), 0)
    into v_next_serial
    from public.devices
   where devices.article_id = p_article_id
     and devices.serial_number ~ ('^' || v_article_number_pattern || '[MK]-\d{4}-\d{5}$');

  -- P2: refuse to spill into a 6-digit suffix.
  if v_next_serial + p_quantity > 99999 then
    raise exception
      'Serial-Bereich für diesen Artikel ist erschöpft (>99999) — Format-Migration erforderlich'
      using errcode = '22023';
  end if;

  -- D1: coalesce v_acquired_at / v_inbound_date so the INSERT carries the
  -- same date that the serial's MMYY encodes (no NULL-vs-today divergence).
  return query
    insert into public.devices (
      serial_number,
      qr_code,
      article_id,
      status,
      condition,
      is_new,
      current_warehouse_id,
      supplier_id,
      acquired_at,
      acquisition_price,
      inbound_date,
      notes,
      created_by,
      updated_by
    )
    select
      v_article_number || 'M-' || v_mmyy || '-' || lpad((v_next_serial + gs)::text, 5, '0'),
      v_article_number || 'M-' || v_mmyy || '-' || lpad((v_next_serial + gs)::text, 5, '0'),
      p_article_id,
      'available',
      'gut',
      true,
      p_warehouse_id,
      p_supplier_id,
      v_acquired_at,
      v_acquisition_price,
      v_inbound_date,
      p_notes,
      auth.uid(),
      auth.uid()
    from generate_series(1, p_quantity) as gs
    returning devices.id, devices.serial_number;
end;
$$;

revoke execute on function public.batch_register_devices(
  uuid, int, uuid, uuid, date, numeric, date, text
) from public, anon;
grant execute on function public.batch_register_devices(
  uuid, int, uuid, uuid, date, numeric, date, text
) to authenticated;

comment on function public.batch_register_devices(
  uuid, int, uuid, uuid, date, numeric, date, text
) is
  'Story 3.6 — atomic batch device registration. SECURITY DEFINER with role gate (admin/office/warehouse). '
  'Generates serial_number = {article_number}M-{MMYY}-{NNNNN} per article via advisory lock + MAX+1 counter. '
  'Re-emitted by 00054 with regex-escape, 99999 overflow guard, auth.uid() null check, and acquired_at/inbound_date coalesce. '
  'Q5 fallback: if Blue-Office labels are option C (incompatible), a follow-up migration swaps the format string. '
  'See data-model-spec §5.4.1.';
