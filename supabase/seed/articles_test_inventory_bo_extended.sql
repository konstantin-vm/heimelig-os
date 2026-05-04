-- Erweiterung des Test-Artikelstamms — fügt 61 weitere Artikel hinzu,
-- damit der Dev-Datensatz auf ~75 Artikel kommt (Pagination, Filter,
-- Inventory-Buckets und Suche bekommen genug Vielfalt).
--
-- Quelle: docs/exports_back-officer/BO-Export_Artikel.xlsx - Tabelle1.csv
-- Pipeline: scripts/extract_bo_articles.py (siehe commit). Kategorien
-- werden heuristisch aus dem Namen abgeleitet (Accessories vor
-- Pflegebetten/Matratzen, damit "Seitengitter zu Pflegebett Iris" nicht
-- in `pflegebetten` landet).
--
-- Idempotent: ON CONFLICT (article_number) DO NOTHING — wiederholtes
-- Ausführen ist safe.
--
-- Anwendung lokal:   psql "$DATABASE_URL" -f supabase/seed/articles_test_inventory_bo_extended.sql
-- Oder via Supabase: supabase db execute --file supabase/seed/articles_test_inventory_bo_extended.sql

begin;

insert into public.articles (
  article_number, name, description, category, type,
  is_rentable, is_sellable, vat_rate, unit
) values
  ('1047', 'Pflegebett Nicole 140 x 200 cm', null, 'pflegebetten', 'physical', false, true, 'standard', 'Stk.'),
  ('1048', 'Pflegebett Nicole 120 x 200 cm', null, 'pflegebetten', 'physical', true, true, 'standard', 'Stk.'),
  ('1056', 'Pflegebett Iris Comfort', null, 'pflegebetten', 'physical', false, true, 'standard', 'Stk.'),
  ('1057', 'Pflegebett Iris Comfort 120 x 200 cm', null, 'pflegebetten', 'physical', true, true, 'standard', 'Stk.'),
  ('1058', 'Pflegebett Iris 42-400 GS', 'Pflegebett Iris 42', 'pflegebetten', 'physical', false, true, 'standard', 'Stk.'),
  ('1059', '1 Paar Seitengitter zu Pflegebett Iris', null, 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1060', 'Pflegebett Typ BI', null, 'pflegebetten', 'physical', true, true, 'standard', 'Stk.'),
  ('1061', 'Pflegebett Typ BI-3M', null, 'pflegebetten', 'physical', true, false, 'standard', 'Stk.'),
  ('1064', 'Bettenverlängerung mit Matratzenverlängerungsstück', 'Bettenverlängerung Iris', 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1065', 'Bettenverlängerung', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1068', 'Bettenverlängerung 10 cm Fuchsia', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1069', 'Bettenverlängerung 20 cm Fuchsia', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1072', 'Pflegebett Fuchsia DB, 110 x 200 cm', null, 'pflegebetten', 'physical', true, true, 'standard', 'Stk.'),
  ('1073', 'Bettenverlängerung zu Nicole 120', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1074', 'Pflegebett Fuchsia GS', null, 'pflegebetten', 'physical', true, true, 'standard', 'Stk.'),
  ('1075', 'Bettenverlängerung 20 cm Fuchsia', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1076', '1 Paar Seitengitter zu Fuchsia GS', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1095', 'Aufzugsstange mit Halterung und Griff zu Einlegerahmen', 'Aufzugsstange mit Halterung und Griff', 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1096', 'Niederflur - Pflegebett Protea inkl. Aufzugsarm', 'Niederflur - Pflegebett Protea', 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1098', 'Niederflur - Pflegebett Oride inkl. Aufzugsarm', 'Niederflur - Pflegebett Oride', 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1100', 'Aufzugsarm 1101', 'Aufzugsarm 1101 kompl. mit Griff', 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1101', 'Kunststoffhaltegriff zu Aufzugsarm', null, 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1105', 'Aufzugsarm Iris/Nicole komplett mit Griff', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1106', 'Aufzugsarm zu Pflegebett Primelig', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1108', 'Aufzugsarm Fuchsia', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1109', 'Aufzugsarm Kamelia', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1112', 'Aufzugsarm Viola komplett mit Griff', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1114', 'Aufzugsarm zu Einlegerahmen komplett mit Griff', null, 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1115', 'Aufzugsarm Oride', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1130', 'Aufzugsarm freistehend', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1131', 'Gripo-Stange mit Griff', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1133', 'Aufzugsarm freistehend "H"', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1140', 'Handschalterhalterung Iris (quer aufsteckbar)', 'Handschalterhalterung  Iris (quer aufsteckbar)', 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1142', 'Wandabstandhalter Iris (seitlich und kopfseitig)', null, 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1145', 'Handschalterhalterung Iris (Schwanenhals)', 'Handschalterhalterung  Iris (Schwanenhals)', 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1146', 'Handschalterhalterung Fuchsia (Schwanenhals)', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1147', 'Haltegriff zu Pflegebett Oride', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1148', 'Handschalterhalterung Fuchsia', null, 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1151', 'Aufzugsarm mit Griff RotoBed', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1152', 'Nachttisch RotoBed', null, 'moebel', 'physical', true, true, 'standard', 'Stk.'),
  ('1153', 'Wandpuffer kopfseitig RotoBed', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1154', 'Wandpuffer seitlich RotoBed', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1155', 'Bettlampe mit LED Licht RotoBed', null, 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1156', 'Unterflurbeleuchtung RotoBed', null, 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1157', 'Handschalter zu RotoBed', null, 'zubehoer', 'physical', false, true, 'standard', 'Stk.'),
  ('1161', 'Bettverlängerung um 10 cm RotoBed', null, 'zubehoer', 'physical', true, true, 'standard', 'Stk.'),
  ('1170', 'Standardmatratze SafeSleep', null, 'matratzen', 'physical', true, true, 'standard', 'Stk.'),
  ('1180', 'Matratze BariaSleep', null, 'matratzen', 'physical', true, true, 'standard', 'Stk.'),
  ('1182', 'Matratze RoHo', null, 'matratzen', 'physical', true, true, 'standard', 'Stk.'),
  ('1185', 'Wechseldruckmatratze AirSleep', null, 'matratzen', 'physical', true, true, 'standard', 'Stk.'),
  ('1186', 'Wechseldruckmatratze (breit & lang)', null, 'matratzen', 'physical', true, true, 'standard', 'Stk.'),
  ('2006', 'Matratze RG 50/8', null, 'matratzen', 'physical', true, true, 'standard', 'Stk.'),
  ('2011', 'Matratze Medibase med.', null, 'matratzen', 'physical', true, true, 'standard', 'Stk.'),
  ('2012', 'Matratze Medibase soft', null, 'matratzen', 'physical', true, true, 'standard', 'Stk.'),
  ('3000', 'Bett-/Nachttisch EMB', null, 'moebel', 'physical', true, true, 'standard', 'Stk.'),
  ('3020', 'Bett-/Nachttisch 1-S', null, 'moebel', 'physical', true, true, 'standard', 'Stk.'),
  ('3040', 'Nachttisch Willhelm I', null, 'moebel', 'physical', true, true, 'standard', 'Stk.'),
  ('8003', 'Leichtgewichtrollstuhl Eclips+  m. B.', 'Leichtgewichtrollstuhl Eclips+ m. B.', 'mobilitaet', 'physical', true, false, 'standard', 'Stk.'),
  ('8025', 'Rollstuhl V300 mit Begleitbremse', null, 'mobilitaet', 'physical', true, false, 'standard', 'Stk.'),
  ('8027', 'V-Drive Antrieb zu Rollstuhl V300', null, 'mobilitaet', 'physical', true, true, 'standard', 'Stk.'),
  ('8028', 'Rollstuhl D200 mit Begleitbremse', null, 'mobilitaet', 'physical', true, true, 'standard', 'Stk.')
on conflict (article_number) do nothing;

commit;

-- Smoke-Check (manuell):
--   select category, count(*) from public.articles group by category order by 1;
--   Expected total mit Top20-Seed: ~75 Artikel.
