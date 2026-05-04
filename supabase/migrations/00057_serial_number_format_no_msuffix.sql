-- Migration 00057 — Story 3.6 format correction — drop the `M` suffix from
-- generated device serial numbers per MTG-009 (2026-04-28).
--
-- Background
-- ----------
-- 00052 + 00054 emit `batch_register_devices(...)` with the format
--   `{article_number}M-{MMYY}-{NNNNN}` (e.g. `1032M-0526-00001`).
-- The trailing `M` was lifted from the legacy Blue-Office labels where it
-- distinguished Miete (rental) from Kauf (purchase) lifecycle buckets.
--
-- David's MTG-009 decision (`docs/communication/meetings/2026-04-28_MTG-009_
-- datenexporte-kunden-artikeldaten.md` — DECISION block):
--
--   "M/K-Suffix verschwindet aus Artikelnummern UND Seriennummern. Miete
--    vs. Kauf wird über separaten Systemwert am Einzelartikel gesteuert."
--
-- New format
-- ----------
-- Re-emits `batch_register_devices(...)` with format
--   `{article_number}-{MMYY}-{NNNNN}` (e.g. `1032-0526-00001`).
-- Article-number, booking-month/year, and per-article 5-digit counter — no
-- `M` separator. Miete-vs-Kauf provenance is now solely the article-level
-- system value (`articles.is_rentable` + `articles.is_sellable`); the
-- per-device flag is `devices.is_new` (already in 00047).
--
-- Forward-only data policy
-- ------------------------
-- Existing devices already in `public.devices` whose `serial_number` carries
-- the legacy `M` suffix are LEFT UNCHANGED. The `serial_number` column is the
-- physical label printed on the device + persisted into the QR payload (Q5
-- contract — `lib/qr-labels/encode.ts`); rewriting them in-place would
-- invalidate every printed label. Only newly generated serials follow the
-- new format. The counter regex below tolerates BOTH formats so a future
-- batch against an article that already holds legacy `M`-format devices
-- continues the same per-article counter rather than restarting at 1.
--
-- Patches re-emitted verbatim from 00054 (kept for behaviour parity)
-- ------------------------------------------------------------------
--   P1 — POSIX-regex metacharacter escape on `article_number` before
--        concatenation into the counter MAX regex (free-form values like
--        `10.32`, `1032(A)`, `M-99` etc. would otherwise wildcard-match
--        unrelated articles' serials or raise `invalid_regular_expression`).
--   P2 — Reject batches that would spill into a 6-digit suffix.
--   P3 — Defense-in-depth `auth.uid() IS NOT NULL` precondition.
--   D1 — Coalesce `acquired_at` + `inbound_date` into the INSERT so the
--        column matches the MMYY encoded in the serial.
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

  -- P1: escape POSIX-regex metacharacters in article_number (e.g. `10.32`,
  -- `1032(A)`, `M-99` would otherwise wildcard-match or raise
  -- `invalid_regular_expression`).
  v_article_number_pattern :=
    regexp_replace(v_article_number, '([\\^$.|?*+(){}\[\]])', '\\\1', 'g');

  perform pg_advisory_xact_lock(hashtextextended(p_article_id::text, 0));

  -- Counter MAX regex tolerates BOTH the legacy `M` suffix AND the new
  -- no-suffix format. The optional non-capturing group `(?:[MK])?` makes the
  -- letter optional; existing `[MK]` characters in legacy serials still
  -- match, while new serials (no letter) also match. This is the seam that
  -- lets the counter continue across the format change without resetting:
  -- a fresh batch on an article that already carries `1032M-0526-00007`
  -- starts the next serial at `1032-0526-00008`.
  select coalesce(max((substring(devices.serial_number from '\d{5}$'))::int), 0)
    into v_next_serial
    from public.devices
   where devices.article_id = p_article_id
     and devices.serial_number ~ ('^' || v_article_number_pattern || '(?:[MK])?-\d{4}-\d{5}$');

  -- P2: refuse to spill into a 6-digit suffix.
  if v_next_serial + p_quantity > 99999 then
    raise exception
      'Serial-Bereich für diesen Artikel ist erschöpft (>99999) — Format-Migration erforderlich'
      using errcode = '22023';
  end if;

  -- D1: coalesce v_acquired_at / v_inbound_date so the INSERT carries the
  -- same date that the serial's MMYY encodes (no NULL-vs-today divergence).
  --
  -- New format (no `M`): `{article_number}-{MMYY}-{NNNNN}`.
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
      v_article_number || '-' || v_mmyy || '-' || lpad((v_next_serial + gs)::text, 5, '0'),
      v_article_number || '-' || v_mmyy || '-' || lpad((v_next_serial + gs)::text, 5, '0'),
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
  'Generates serial_number = {article_number}-{MMYY}-{NNNNN} per article via advisory lock + MAX+1 counter. '
  'Re-emitted by 00057 to drop the legacy `M` suffix per MTG-009 (2026-04-28). Counter regex tolerates legacy '
  '`{article_number}M-{MMYY}-{NNNNN}` rows so per-article numbering continues across the format change. '
  'Forward-only: existing legacy serials are NOT rewritten (printed labels would be invalidated). '
  'Patches retained from 00054: P1 regex-escape, P2 99999 overflow guard, P3 auth.uid() null check, D1 acquired_at/inbound_date coalesce. '
  'See data-model-spec §5.4.1 + docs/communication/meetings/2026-04-28_MTG-009_datenexporte-kunden-artikeldaten.md.';
