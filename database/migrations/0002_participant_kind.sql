-- Migration 0002: gemeinsame Meldungen dauerhaft von Personen unterscheiden.
--
-- Bis hierher waren Teameinträge nur am freien Rollentext ("Team · …") zu
-- erkennen. Dieser Text ist bearbeitbar und deshalb kein verlässliches
-- Merkmal. Ab jetzt entscheidet eine eigene Spalte.
--
-- 'person' = genau eine Person mit eigenen belegten Zahlen. Nur diese
--            Datensätze erscheinen in Einzelrangliste, Podium,
--            Tagesgewinnern und Monatsplatzierungen.
-- 'joint'  = gemeinsame Meldung mehrerer Personen. Zählt genau einmal zur
--            Gesamtleistung der Community, löst aber keinen persönlichen
--            Rang aus und ist kein übernehmbares Einzelprofil.
--
-- Rein additiv: bestehende Zeilen werden zu 'person', vorhandene Abfragen
-- bleiben gültig. Tabellenweite Rechte aus database/runtime-role.sql decken
-- neue Spalten ab, ein Rechte-Nachtrag ist deshalb nicht nötig.
BEGIN;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'person';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'participants_kind_known'
  ) THEN
    ALTER TABLE participants
      ADD CONSTRAINT participants_kind_known CHECK (kind IN ('person','joint'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS participants_kind ON participants(kind);

-- Die beiden bestehenden gemeinsamen Meldungen. Stabile Importschlüssel,
-- keine generierten IDs. searchable=false nimmt sie zusätzlich aus der
-- Profilauswahl; die Ablehnung im Server hängt aber an kind, nicht daran.
UPDATE participants
   SET kind = 'joint', searchable = false
 WHERE import_key IN ('akq-2026-david-jannik','akq-2026-myran-omo');

COMMIT;
