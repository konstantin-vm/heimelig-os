-- Migration 00052 — Story 3.6 — Batch device registration.
--
-- Ships `public.batch_register_devices(p_article_id, p_quantity, ...)` —
-- a SECURITY DEFINER function that atomically registers N device rows
-- against a single rentable article, generating per-article sequential
-- serial numbers under an advisory lock so concurrent batches against
-- the same article never collide on `serial_number`.
--
-- Story 3.6 AC-DM bullet checklist:
--   (a) signature returns table(id uuid, serial_number text)
--   (b) SECURITY DEFINER, plpgsql, set search_path = public, pg_temp
--   (c) role gate: admin OR office OR warehouse → 42501 on fail
--   (d) parameter validation → 22023 on fail (quantity bounds, article
--       eligibility, warehouse / supplier active checks)
--   (e) pg_advisory_xact_lock(hashtextextended(p_article_id::text, 0))
--       AFTER validation — a RAISE aborts the txn and the lock would
--       never release anyway, but lock-after-validate avoids an
--       unnecessary acquisition under invalid input
--   (f) counter via SELECT COALESCE(MAX(...), 0) + 1 against existing
--       devices for this article whose serial matches the project
--       format regex; trailing 5-digit suffix extracted via substring(...)
--   (g) MMYY computed from coalesce(p_acquired_at, today CET)
--   (h) single multi-row INSERT via generate_series(1, p_quantity)
--   (i) RETURN QUERY of the inserted rows' (id, serial_number)
--   (j) REVOKE EXECUTE FROM public, anon + GRANT EXECUTE TO authenticated
--   (k) function comment with Story 3.6 + data-model-spec §5.4.1 +
--       Q5 fallback note
--   (l) idempotent on replay — CREATE OR REPLACE
--
-- SECURITY DEFINER + role gate is the SOLE authorization barrier inside
-- this function — RLS on `devices` is bypassed under SECURITY DEFINER
-- privilege escalation. The role gate calls is_admin()/is_office()/
-- is_warehouse() (all SECURITY INVOKER, JWT-claim-based) so the helpers
-- read the CALLER's role, not the definer's.
--
-- Q5 fallback (open-questions/2026-04-30_review.md): the serial format
-- below — `{article_number}M-{MMYY}-{NNNNN}` — matches Blue Office labels
-- per options A and B (the QR encodes the plaintext serial). If Q5 lands
-- on option C (re-labeling required), a follow-up migration
-- `0005x_batch_register_devices_format_q5.sql` swaps the format string in
-- this function — no schema change needed.
--
-- Format breakdown (data-model-spec §5.4.1 + project-context.md line 255):
--   `1032M-0526-00001`
--    └──┘└┘└──┘└────┘
--    │   │ │    └─ Serial: 5-digit zero-padded counter, per-article
--    │   │ └────── BookingDate: MMYY (May 2026 → '0526')
--    │   └──────── Type: 'M' = Miete (rental), 'K' = Kauf (purchase).
--    │             Story 3.6 always emits 'M' because the function gates
--    │             on articles.is_rentable=true; dual-mode articles start
--    │             as rental-pool units (is_new=true) per MTG-009.
--    └──────────── ArticleNr from public.articles.article_number
--
-- Audit trigger (00014) is bound to `devices` for INSERT/UPDATE/DELETE;
-- the multi-row INSERT below fires the trigger N times, one audit_log
-- row per device. auth.uid() is preserved across SECURITY DEFINER (no
-- SET LOCAL ROLE), so the actor recorded on each audit row is the
-- caller, not the definer.
--
-- Realtime publication membership for `public.devices` shipped in 00047
-- — no re-binding needed here.

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
  -- (c) Role gate FIRST — before any read on devices/articles. The helpers
  -- are SECURITY INVOKER + JWT-claim-based, so they read the caller's role.
  if not (public.is_admin() or public.is_office() or public.is_warehouse()) then
    raise insufficient_privilege using
      message = 'Sammelregistrierung erfordert admin / office / warehouse';
  end if;

  -- Defense-in-depth: reject NULL JWT subject. The role gate above already
  -- returns false when auth.uid() is null (SECURITY INVOKER helpers see no
  -- claim), but make the precondition explicit so a future helper-rewrite
  -- can never silently land with `created_by = null` rows in the audit log.
  if auth.uid() is null then
    raise insufficient_privilege using
      message = 'Sammelregistrierung erfordert einen authentifizierten Benutzer';
  end if;

  -- (d) Parameter validation BEFORE acquiring the advisory lock.
  if p_article_id is null then
    raise exception 'p_article_id darf nicht NULL sein' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 50 then
    raise exception 'Anzahl muss zwischen 1 und 50 liegen' using errcode = '22023';
  end if;

  -- Article eligibility — must exist + rentable + active. Combined into a
  -- single lookup that also pulls article_number for the serial format.
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

  -- Optional warehouse + supplier active checks.
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

  -- AC-SER warehouse PII gate: defense-in-depth strip of acquisition_price
  -- for warehouse-only callers. Even if a hand-crafted RPC call from a
  -- warehouse client smuggles a price past the form-layer hide, this strip
  -- nulls it before the INSERT. admin and office callers (including those
  -- whose JWT carries multiple roles) keep the supplied price.
  if public.is_warehouse() and not (public.is_admin() or public.is_office()) then
    v_acquisition_price := null;
  end if;

  -- (g) Booking-date prefix in MMYY format (Europe/Zurich).
  v_mmyy := to_char(v_booking_date, 'MMYY');

  -- `articles.article_number` is free-form text. Escape POSIX-regex
  -- metacharacters before concatenation so a value like `10.32`, `1032(A)`,
  -- `M-99` or anything containing `\`, `[`, `]`, `(`, `)`, `*`, `+`, `?`,
  -- `|`, `.`, `^`, `$`, `{`, `}` does not (a) wildcard-match unrelated
  -- articles' serials and corrupt the per-article counter, or (b) raise
  -- `invalid_regular_expression` and abort the entire batch with no
  -- friendly mapping for the caller.
  v_article_number_pattern :=
    regexp_replace(v_article_number, '([\\^$.|?*+(){}\[\]])', '\\\1', 'g');

  -- (e) Serialize concurrent batches against the same article. The lock is
  -- transaction-scoped (released at COMMIT/ROLLBACK), so a parallel call
  -- against the same article waits, then re-reads MAX after this batch
  -- commits → no overlapping suffixes. Different articles never block.
  perform pg_advisory_xact_lock(hashtextextended(p_article_id::text, 0));

  -- (f) Highest existing 5-digit suffix for this article (regardless of
  -- the MMYY portion — the suffix is per-article, not per-month). Match
  -- both M (rental) and K (purchase) lifecycle letters so a future story
  -- that registers K-flagged devices for the same article continues the
  -- same sequence rather than restarting at 1.
  select coalesce(max((substring(devices.serial_number from '\d{5}$'))::int), 0)
    into v_next_serial
    from public.devices
   where devices.article_id = p_article_id
     and devices.serial_number ~ ('^' || v_article_number_pattern || '[MK]-\d{4}-\d{5}$');

  -- Suffix is 5 zero-padded digits (max 99999). Reject batches that would
  -- spill into a 6-digit suffix — those serials no longer match the regex
  -- above, so a subsequent batch's MAX would re-extract `00001` from
  -- `100001` and re-collide on the UNIQUE serial_number constraint. Hard
  -- cap is 99999 minus the running counter; in practice this becomes
  -- relevant only after ~99k devices for the same article (decades away).
  if v_next_serial + p_quantity > 99999 then
    raise exception
      'Serial-Bereich für diesen Artikel ist erschöpft (>99999) — Format-Migration erforderlich'
      using errcode = '22023';
  end if;

  -- (h)+(i) Atomic multi-row INSERT. generate_series(1, N) makes
  -- v_next_serial+1 the first row's suffix (since v_next_serial is the
  -- highest existing or 0). qr_code = serial_number per Q5 option A/B.
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

-- (j) Lock down execution: authenticated only, never anon/public.
revoke execute on function public.batch_register_devices(
  uuid, int, uuid, uuid, date, numeric, date, text
) from public, anon;
grant execute on function public.batch_register_devices(
  uuid, int, uuid, uuid, date, numeric, date, text
) to authenticated;

-- (k) Discoverability comment.
comment on function public.batch_register_devices(
  uuid, int, uuid, uuid, date, numeric, date, text
) is
  'Story 3.6 — atomic batch device registration. SECURITY DEFINER with role gate (admin/office/warehouse). '
  'Generates serial_number = {article_number}M-{MMYY}-{NNNNN} per article via advisory lock + MAX+1 counter. '
  'Q5 fallback: if Blue-Office labels are option C (incompatible), a follow-up migration swaps the format string. '
  'See data-model-spec §5.4.1.';
