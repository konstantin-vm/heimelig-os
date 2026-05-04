-- Test-Artikelstamm — abgeleitet aus den ersten 20 Zeilen von
-- docs/exports_back-officer/BO-Export_Artikel.xlsx - Tabelle1.csv.
--
-- Mapping-Regeln (siehe data-model-spec.md §5.3 + Story 3.1 / 00043):
--   * `article_number` ohne M/K-Suffix → 20 BO-Zeilen kollabieren auf 14 Artikel.
--   * `1026` (Miete) + `1026 K` (Verkauf) → ein Artikel mit
--     `is_rentable = true AND is_sellable = true`.
--   * `type = 'physical'` (kein Service-Artikel im Sample).
--   * `unit = 'Stk.'`, `vat_rate = 'standard'` (Schweizer Standard 8.1 %).
--   * `category` heuristisch aus dem Namen (Pflegebett → pflegebetten,
--     Bettenverlängerung / Aufzugsarm → zubehoer).
--   * `is_serialized` wird vom BEFORE-INSERT-Trigger aus `is_rentable` abgeleitet,
--     deswegen nicht gesetzt.
--
-- Idempotent: `ON CONFLICT (article_number) DO NOTHING` — wiederholtes Ausführen
-- legt keine Duplikate an und verändert keine bestehenden Zeilen.
--
-- Anwendung lokal:   psql "$DATABASE_URL" -f supabase/seed/articles_test_inventory_bo_top20.sql
-- Oder via Supabase: supabase db execute --file supabase/seed/articles_test_inventory_bo_top20.sql
--
-- Original-BO-Barcodes sind als Kommentar pro Zeile dokumentiert (ein Artikel
-- kann mehrere Strichcodes haben, weil Miet- und Verkaufsvariante je eigenen
-- EAN tragen). Die App-seitigen Barcodes leben auf `devices.qr_code` (Story 3.7),
-- nicht auf `articles` — daher hier nur als Referenz.

begin;

insert into public.articles (
  article_number, name, description, category, type,
  is_rentable, is_sellable, vat_rate, unit
) values
  -- BO 1            | EAN 7600000003273
  ('1',    'Aufzugsarm mit Griff',                  'Zubehör — inkl. 1 Aufzugsarm mit Griff', 'zubehoer',     'physical', true,  false, 'standard', 'Stk.'),
  -- BO 1025         | EAN 7600000006397
  ('1025', 'Pflegebett Allegra',                    null,                                      'pflegebetten', 'physical', true,  false, 'standard', 'Stk.'),
  -- BO 1026 / 1026 K| EAN 7600000006410 / 7600000006403
  ('1026', 'Pflegebett Allegra 120',                null,                                      'pflegebetten', 'physical', true,  true,  'standard', 'Stk.'),
  -- BO 1027 K       | EAN 7600000000616
  ('1027', 'Bettenverlängerung Allegra',            null,                                      'zubehoer',     'physical', false, true,  'standard', 'Stk.'),
  -- BO 1028 K       | EAN 7600000011315
  ('1028', 'Pflegebett Fuchsia Comfort',            null,                                      'pflegebetten', 'physical', false, true,  'standard', 'Stk.'),
  -- BO 1029 K       | EAN 7600000011322
  ('1029', 'Pflegebett Fuchsia Comfort 2G',         null,                                      'pflegebetten', 'physical', false, true,  'standard', 'Stk.'),
  -- BO 1032 / 1032 K| EAN 7600000010677 / 7600000006472
  ('1032', 'Pflegebett Fuchsia D',                  null,                                      'pflegebetten', 'physical', true,  true,  'standard', 'Stk.'),
  -- BO 1033 / 1033 K| EAN 7600000006663 / 7600000006656
  ('1033', 'Pflegebett Primelig lll',               null,                                      'pflegebetten', 'physical', true,  true,  'standard', 'Stk.'),
  -- BO 1035 / 1035 K| EAN 7600000010769 / 7600000013296
  ('1035', 'Pflegebett Fuchsia DI',                 null,                                      'pflegebetten', 'physical', true,  true,  'standard', 'Stk.'),
  -- BO 1036 K       | EAN 7600000010691
  ('1036', 'Pflegebett Iris 16-400 GS 120x200',     null,                                      'pflegebetten', 'physical', false, true,  'standard', 'Stk.'),
  -- BO 1037 / 1037 K| EAN 7600000010684 / 7600000011797
  ('1037', 'Pflegebett Iris 16-400 GS',             null,                                      'pflegebetten', 'physical', true,  true,  'standard', 'Stk.'),
  -- BO 1038 K       | EAN 7600000006526
  ('1038', 'Pflegebett Iris 15-400 GS 120x200',     'Pflegebett Iris 15-400 GS 120x200 inkl. 2 Seitengitter', 'pflegebetten', 'physical', false, true, 'standard', 'Stk.'),
  -- BO 1039 / 1039 K| EAN 7600000006519 / 7600000006502
  ('1039', 'Pflegebett Iris 15-400 GS',             'Pflegebett Iris 15-400 GS inkl. 2 Seitengitter',         'pflegebetten', 'physical', true,  true, 'standard', 'Stk.'),
  -- BO 1040 K       | EAN 7600000006496
  ('1040', 'Pflegebett Impulse 400 GS',             'Pflegebett Impulse 400 GS inkl. 2 Seitengitter',         'pflegebetten', 'physical', false, true, 'standard', 'Stk.')
on conflict (article_number) do nothing;

commit;

-- Smoke-Check (manuell):
--   select count(*) as inserted, count(*) filter (where is_rentable) as rentable,
--          count(*) filter (where is_sellable) as sellable
--     from public.articles where article_number in
--          ('1','1025','1026','1027','1028','1029','1032','1033',
--           '1035','1036','1037','1038','1039','1040');
--   Expected: inserted=14, rentable=8, sellable=12.
