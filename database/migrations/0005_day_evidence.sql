-- Migration 0005: Nachweis je Tag (Gesprächszeit, CRM-Screenshot).
--
-- Rein additiv. Neue, leere Tabelle; bestehende Tagesstände bleiben unberührt.
-- Der Code schaltet die Funktion erst frei, wenn diese Tabelle existiert
-- (server/evidence.ts). Nur nach Freigabe ausführen.
BEGIN;
SET LOCAL search_path=operator,pg_catalog;
CREATE TABLE IF NOT EXISTS day_evidence(
  participant text NOT NULL REFERENCES participants(id),
  day text NOT NULL,
  -- Gesprächszeit laut CRM in Minuten (freiwillig).
  talk_minutes integer CHECK (talk_minutes BETWEEN 0 AND 1440),
  -- Verkleinertes Bild, sichtbar nur für die Person und das Team.
  image bytea CHECK (image IS NULL OR octet_length(image) <= 1500000),
  image_type text CHECK (image_type IN ('image/jpeg','image/png','image/webp')),
  image_at timestamptz,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(participant, day),
  CHECK ((image IS NULL) = (image_type IS NULL))
);
CREATE INDEX IF NOT EXISTS day_evidence_day ON day_evidence(day);
DO $$ BEGIN
  EXECUTE 'ALTER TABLE operator.day_evidence ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON TABLE operator.day_evidence FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operator_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON operator.day_evidence TO operator_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='operator' AND tablename='day_evidence' AND policyname='operator_server_access') THEN
      CREATE POLICY operator_server_access ON operator.day_evidence FOR ALL TO operator_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;
COMMIT;
