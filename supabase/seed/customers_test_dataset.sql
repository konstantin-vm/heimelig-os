-- Test-Kundenstamm — frei erfundene Datensätze, KEINE echten Kunden aus den
-- BO-Exports. Deckt die wichtigsten Edge Cases der Customer-Domain ab:
--
--   * private vs. institution (data-model-spec §5.2.1, customers_name_vs_type)
--   * Salutation inkl. 'erbengemeinschaft' (Story 2.1.1 / 00028)
--   * IV-Marker mit Dossier-Nummer (Story 2.1.1 / 00028)
--   * Alle vier Partner-Versicherer (Helsana, Sanitas, Visana, KPT) +
--     ein Freitext-Versicherer (Swica) + ein Selbstzahler ohne Insurance-Row
--   * Mehrsprachigkeit (de + fr)
--   * Kontaktpersonen mit Rolle 'angehoerige' und 'spitex'
--   * Schweizer Adressen aus verschiedenen Kantonen
--
-- Customer-Number-Strategie: 9990000001..9990000012 — klar im Test-Bereich,
-- 10-stellig wie die produktive Sequenz, aber weit über dem Range der
-- echten Kunden (Sequenz startet bei 10100000) und über dem höchsten
-- bekannten BO-Wert (10031369), damit nichts kollidiert.
--
-- Idempotent: ON CONFLICT DO NOTHING auf jedem INSERT — wiederholtes
-- Ausführen legt keine Duplikate an. Fixe UUIDs sorgen dafür, dass
-- Folge-Rows (addresses, insurance, contacts) stabil mit ihrem Customer
-- verknüpft bleiben.
--
-- Anwendung lokal:   psql "$DATABASE_URL" -f supabase/seed/customers_test_dataset.sql
-- Oder via Supabase: supabase db execute --file supabase/seed/customers_test_dataset.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. customers
-- ---------------------------------------------------------------------------

insert into public.customers (
  id, customer_number, customer_type, salutation, title,
  first_name, last_name, company_name, addressee_line,
  email, phone, mobile, date_of_birth,
  height_cm, weight_kg, language, marketing_consent,
  acquisition_channel, iv_marker, iv_dossier_number, notes
) values
  -- 1: Privatkunde, Helsana, Spitex-Kontakt
  ('c0000000-0000-0000-0000-cccccc000001', '9990000001', 'private', 'herr', null,
   'Hans', 'Mueller', null, null,
   'hans.mueller.test@example.ch', '+41 44 555 01 01', '+41 79 555 01 01', '1947-03-12',
   175, 78.0, 'de', false,
   'spitex', false, null, 'Test-Kunde — Pflegebett-Mieter, Spitex-Betreuung'),

  -- 2: Privatkunde, Sanitas, Tochter als Angehoerige
  ('c0000000-0000-0000-0000-cccccc000002', '9990000002', 'private', 'frau', null,
   'Margrit', 'Schneider', null, null,
   null, '+41 31 555 02 02', null, '1942-08-23',
   162, 64.5, 'de', false,
   'arzt_therapeut', false, null, 'Test-Kunde — Tochter Anna ist Hauptansprechpartner'),

  -- 3: Privatkunde, Visana
  ('c0000000-0000-0000-0000-cccccc000003', '9990000003', 'private', 'herr', null,
   'Walter', 'Buehler', null, null,
   'w.buehler.test@example.ch', '+41 41 555 03 03', null, '1954-11-04',
   180, 92.0, 'de', true,
   'empfehlung', false, null, null),

  -- 4: Privatkundin, KPT
  ('c0000000-0000-0000-0000-cccccc000004', '9990000004', 'private', 'frau', 'Dr.',
   'Verena', 'Frei', null, null,
   'v.frei.test@example.ch', '+41 61 555 04 04', '+41 78 555 04 04', '1959-02-17',
   168, 70.0, 'de', false,
   'wiederholer', false, null, 'Test-Kunde — Wiederholungsmieterin'),

  -- 5: Privatkunde, Freitext-Versicherer (Swica — kein Partner)
  ('c0000000-0000-0000-0000-cccccc000005', '9990000005', 'private', 'herr', null,
   'Heinrich', 'Lehmann', null, null,
   null, '+41 62 555 05 05', null, '1944-06-30',
   172, 81.5, 'de', false,
   'sozialdienst_spital', false, null, 'Test-Kunde — Versicherer Swica (Freitext, kein Partner)'),

  -- 6: Privatkundin, IV-Fall mit Dossier
  ('c0000000-0000-0000-0000-cccccc000006', '9990000006', 'private', 'frau', null,
   'Sandra', 'Waefler', null, null,
   's.waefler.test@example.ch', '+41 52 555 06 06', '+41 76 555 06 06', '1979-04-09',
   165, 58.0, 'de', false,
   'arzt_therapeut', true, '320/2025/004391/0', 'Test-Kunde — IV-Fall, Dossier siehe Spalte'),

  -- 7: Erbengemeinschaft (Mietvertrag laeuft nach Todesfall weiter)
  ('c0000000-0000-0000-0000-cccccc000007', '9990000007', 'private', 'erbengemeinschaft', null,
   null, 'Hofer', null, 'Erbengemeinschaft Hofer',
   null, '+41 71 555 07 07', null, null,
   null, null, 'de', false,
   null, false, null, 'Test-Kunde — Erbengemeinschaft nach Todesfall (Story 5.3)'),

  -- 8: Privatkunde, Visana, Sohn als Angehoeriger
  ('c0000000-0000-0000-0000-cccccc000008', '9990000008', 'private', 'herr', null,
   'Jakob', 'Kuenzli', null, null,
   null, '+41 52 555 08 08', null, '1934-12-01',
   170, 68.0, 'de', false,
   'spitex', false, null, 'Test-Kunde — Sohn Markus ist primaerer Kontakt'),

  -- 9: Privatkunde, Selbstzahler ohne KK-Eintrag
  ('c0000000-0000-0000-0000-cccccc000009', '9990000009', 'private', 'herr', null,
   'Erich', 'Bachmann', null, null,
   'e.bachmann.test@example.ch', '+41 32 555 09 09', null, '1965-09-22',
   178, 88.0, 'de', true,
   'google', false, null, 'Test-Kunde — Selbstzahler, keine KK-Hinterlegung'),

  -- 10: Privatkunde, franzoesischsprachig
  ('c0000000-0000-0000-0000-cccccc000010', '9990000010', 'private', 'herr', null,
   'Marcel', 'Dupont', null, null,
   'm.dupont.test@example.ch', '+41 21 555 10 10', null, '1953-05-14',
   174, 75.0, 'fr', false,
   'empfehlung', false, null, 'Test-Kunde — Romandie, language=fr'),

  -- 11: Institution — Pflegeheim
  ('c0000000-0000-0000-0000-cccccc000011', '9990000011', 'institution', null, null,
   null, null, 'Pflegeheim Sonnenhof AG', 'Heimleitung',
   'verwaltung.test@sonnenhof-test.example.ch', '+41 41 555 11 11', null, null,
   null, null, 'de', false,
   'sozialdienst_spital', false, null, 'Test-Institution — Pflegeheim, Sammelrechnung'),

  -- 12: Institution — Spital
  ('c0000000-0000-0000-0000-cccccc000012', '9990000012', 'institution', null, null,
   null, null, 'Hoehenklinik Davos AG', 'Einkauf Hilfsmittel',
   'einkauf.test@hoehenklinik-test.example.ch', '+41 81 555 12 12', null, null,
   null, null, 'de', false,
   'sozialdienst_spital', false, null, 'Test-Institution — Spital, kurzfristige Mieten')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. customer_addresses (primaere Adresse pro Kunde)
-- ---------------------------------------------------------------------------

insert into public.customer_addresses (
  id, customer_id, address_type, is_default_for_type, recipient_name,
  street, street_number, zip, city, country,
  floor, has_elevator, access_notes
) values
  ('c0000000-0000-0000-0000-aaaaaa000001', 'c0000000-0000-0000-0000-cccccc000001',
   'primary', true, null,
   'Bahnhofstrasse', '12', '8003', 'Zuerich', 'CH',
   '2.OG', 'ja', 'Klingel "Mueller", Lift im Hof'),

  ('c0000000-0000-0000-0000-aaaaaa000002', 'c0000000-0000-0000-0000-cccccc000002',
   'primary', true, null,
   'Lerchenweg', '7', '3013', 'Bern', 'CH',
   'EG', null, null),

  ('c0000000-0000-0000-0000-aaaaaa000003', 'c0000000-0000-0000-0000-cccccc000003',
   'primary', true, null,
   'Seeburgstrasse', '45', '6006', 'Luzern', 'CH',
   '3.OG', 'ja', null),

  ('c0000000-0000-0000-0000-aaaaaa000004', 'c0000000-0000-0000-0000-cccccc000004',
   'primary', true, null,
   'Riehenstrasse', '88', '4058', 'Basel', 'CH',
   '1.OG', 'nein', 'Schmaler Treppenaufgang — Bett zerlegen'),

  ('c0000000-0000-0000-0000-aaaaaa000005', 'c0000000-0000-0000-0000-cccccc000005',
   'primary', true, null,
   'Bahnhofplatz', '3', '5000', 'Aarau', 'CH',
   'EG', null, null),

  ('c0000000-0000-0000-0000-aaaaaa000006', 'c0000000-0000-0000-0000-cccccc000006',
   'primary', true, null,
   'Industriestrasse', '21a', '8400', 'Winterthur', 'CH',
   '4.OG', 'ja', 'IV-Fall, bitte Termin vorab telefonisch bestaetigen'),

  ('c0000000-0000-0000-0000-aaaaaa000007', 'c0000000-0000-0000-0000-cccccc000007',
   'primary', true, 'Erbengemeinschaft Hofer',
   'Marktgasse', '14', '9000', 'St. Gallen', 'CH',
   '2.OG', 'unbekannt', 'Wohnung wird geraeumt — Rueckholung Pflegebett anstehend'),

  ('c0000000-0000-0000-0000-aaaaaa000008', 'c0000000-0000-0000-0000-cccccc000008',
   'primary', true, null,
   'Promenadenstrasse', '5', '8500', 'Frauenfeld', 'CH',
   'EG', null, 'Kontaktaufnahme nur ueber Sohn (siehe Kontaktpersonen)'),

  ('c0000000-0000-0000-0000-aaaaaa000009', 'c0000000-0000-0000-0000-cccccc000009',
   'primary', true, null,
   'Hauptgasse', '17', '4500', 'Solothurn', 'CH',
   '1.OG', 'ja', null),

  ('c0000000-0000-0000-0000-aaaaaa000010', 'c0000000-0000-0000-0000-cccccc000010',
   'primary', true, null,
   'Avenue de la Gare', '34', '1003', 'Lausanne', 'CH',
   '2.OG', 'ja', 'Sonnerie "Dupont"'),

  ('c0000000-0000-0000-0000-aaaaaa000011', 'c0000000-0000-0000-0000-cccccc000011',
   'primary', true, 'Pflegeheim Sonnenhof AG',
   'Sonnenhofweg', '1', '6300', 'Zug', 'CH',
   'EG', 'ja', 'Anlieferung Warenrampe Sued'),

  ('c0000000-0000-0000-0000-aaaaaa000012', 'c0000000-0000-0000-0000-cccccc000012',
   'primary', true, 'Hoehenklinik Davos AG',
   'Klinikstrasse', '9', '7270', 'Davos Platz', 'CH',
   'EG', 'ja', 'Anlieferung Logistik, Kostenstelle bei Einkauf erfragen')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. customer_insurance (Grundversicherung — nicht fuer alle Kunden)
-- ---------------------------------------------------------------------------
-- Privatkunden 1-6, 8 + 10 bekommen eine primaere Grundversicherung.
-- Kunde 7 (Erbengemeinschaft) und 9 (Selbstzahler) bleiben ohne KK-Eintrag.
-- Institutionen 11 + 12 ebenfalls ohne (Sammelrechnung an Institution selbst).

insert into public.customer_insurance (
  id, customer_id, partner_insurer_id, insurer_name_freetext,
  insurance_type, insurance_number, is_primary, valid_from
) values
  ('c0000000-0000-0000-0000-bbbbbb000001', 'c0000000-0000-0000-0000-cccccc000001',
   (select id from public.partner_insurers where code = 'helsana'), null,
   'grund', '756.1234.5678.91', true, '2024-01-01'),

  ('c0000000-0000-0000-0000-bbbbbb000002', 'c0000000-0000-0000-0000-cccccc000002',
   (select id from public.partner_insurers where code = 'sanitas'), null,
   'grund', '756.2345.6789.02', true, '2023-01-01'),

  ('c0000000-0000-0000-0000-bbbbbb000003', 'c0000000-0000-0000-0000-cccccc000003',
   (select id from public.partner_insurers where code = 'visana'), null,
   'grund', '756.3456.7890.13', true, '2025-01-01'),

  ('c0000000-0000-0000-0000-bbbbbb000004', 'c0000000-0000-0000-0000-cccccc000004',
   (select id from public.partner_insurers where code = 'kpt'), null,
   'grund', '756.4567.8901.24', true, '2024-07-01'),

  ('c0000000-0000-0000-0000-bbbbbb000005', 'c0000000-0000-0000-0000-cccccc000005',
   null, 'SWICA Krankenversicherung AG',
   'grund', 'SW-9988776655', true, '2022-01-01'),

  ('c0000000-0000-0000-0000-bbbbbb000006', 'c0000000-0000-0000-0000-cccccc000006',
   (select id from public.partner_insurers where code = 'helsana'), null,
   'grund', '756.5678.9012.35', true, '2025-04-01'),

  ('c0000000-0000-0000-0000-bbbbbb000008', 'c0000000-0000-0000-0000-cccccc000008',
   (select id from public.partner_insurers where code = 'visana'), null,
   'grund', '756.6789.0123.46', true, '2024-01-01'),

  ('c0000000-0000-0000-0000-bbbbbb000010', 'c0000000-0000-0000-0000-cccccc000010',
   (select id from public.partner_insurers where code = 'sanitas'), null,
   'grund', '756.7890.1234.57', true, '2024-01-01')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. contact_persons (Angehoerige + Spitex)
-- ---------------------------------------------------------------------------

insert into public.contact_persons (
  id, customer_id, role, salutation, first_name, last_name,
  organization, phone, email, notes, is_primary_contact
) values
  -- Kunde 1: Spitex-Betreuerin
  ('c0000000-0000-0000-0000-dddddd000001', 'c0000000-0000-0000-0000-cccccc000001',
   'spitex', 'frau', 'Beatrice', 'Steiner',
   'Spitex Zuerich Limmattal', '+41 44 555 99 11', 'b.steiner.test@example.ch',
   'Pflegeplanung Mo/Mi/Fr', false),

  -- Kunde 2: Tochter
  ('c0000000-0000-0000-0000-dddddd000002', 'c0000000-0000-0000-0000-cccccc000002',
   'angehoerige', 'frau', 'Anna', 'Schneider',
   null, '+41 79 555 22 02', 'a.schneider.test@example.ch',
   'Tochter — Hauptkontakt fuer alle Termine', true),

  -- Kunde 8: Sohn als primaerer Kontakt
  ('c0000000-0000-0000-0000-dddddd000008', 'c0000000-0000-0000-0000-cccccc000008',
   'angehoerige', 'herr', 'Markus', 'Kuenzli',
   null, '+41 79 555 88 08', 'm.kuenzli.test@example.ch',
   'Sohn — Vater ist nicht mehr telefonisch erreichbar', true),

  -- Kunde 11 (Institution): Heimleitung-Kontakt
  ('c0000000-0000-0000-0000-dddddd000011', 'c0000000-0000-0000-0000-cccccc000011',
   'heim', 'frau', 'Regula', 'Vogt',
   'Pflegeheim Sonnenhof AG', '+41 41 555 11 12', 'r.vogt.test@sonnenhof-test.example.ch',
   'Heimleiterin — Bestellungen + Sammelrechnung', true)
on conflict do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Smoke-Check (manuell):
--   select count(*) as customers,
--          count(*) filter (where customer_type = 'private')     as private_count,
--          count(*) filter (where customer_type = 'institution') as institution_count,
--          count(*) filter (where iv_marker)                     as iv_count,
--          count(*) filter (where salutation = 'erbengemeinschaft') as erben_count
--     from public.customers
--    where customer_number like '999%';
--   Expected: customers=12, private=10, institution=2, iv=1, erben=1.
--
--   select count(*) from public.customer_addresses
--    where customer_id in (select id from public.customers where customer_number like '999%');
--   Expected: 12 (eine primaere Adresse pro Kunde).
--
--   select count(*) from public.customer_insurance
--    where customer_id in (select id from public.customers where customer_number like '999%');
--   Expected: 8 (Kunden 1-6, 8, 10).
--
--   select count(*) from public.contact_persons
--    where customer_id in (select id from public.customers where customer_number like '999%');
--   Expected: 4 (Kunden 1, 2, 8, 11).
