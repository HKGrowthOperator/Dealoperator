-- Migration 0001: Profilübernahme über geprüfte Anfrage statt direkter Übernahme.
--
-- Nur nötig für eine Installation, die database/schema.sql VOR dieser Änderung
-- ausgeführt hat. Eine frische Installation bringt alles bereits mit, weil
-- schema.sql denselben Stand enthält.
--
-- Einmalig als Projektadministrator ausführen, nicht bei jedem Build/Start.
-- Danach die Tabellenrechte für die Serverrolle nachziehen, weil
-- "GRANT ... ON ALL TABLES" nur für die zum Zeitpunkt der Ausführung
-- vorhandenen Tabellen gilt (siehe database/runtime-role.sql).
BEGIN;
SET LOCAL search_path=operator,pg_catalog;

ALTER TABLE participants ADD COLUMN IF NOT EXISTS searchable boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS onboarding_requests(
  id text PRIMARY KEY,
  kind text NOT NULL,
  participant text REFERENCES participants(id),
  email text NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  phone_input text NOT NULL DEFAULT '',
  hint text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'awaiting_email',
  owner text,
  applicant_message text NOT NULL DEFAULT '',
  internal_note text NOT NULL DEFAULT '',
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Eine offene Anfrage je E-Mail und Zielprofil. Verhindert Doppelanfragen,
-- lässt aber mehrere Personen für dasselbe Profil zu, damit das Team
-- konkurrierende Anfragen sieht und entscheiden kann.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_open_per_email
  ON onboarding_requests(lower(email),COALESCE(participant,''))
  WHERE status IN ('awaiting_email','pending','info_needed');
CREATE INDEX IF NOT EXISTS onboarding_participant
  ON onboarding_requests(participant)
  WHERE status IN ('awaiting_email','pending','info_needed');
CREATE INDEX IF NOT EXISTS onboarding_owner ON onboarding_requests(owner);
CREATE INDEX IF NOT EXISTS onboarding_email ON onboarding_requests(lower(email));

CREATE TABLE IF NOT EXISTS onboarding_events(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request text NOT NULL REFERENCES onboarding_requests(id),
  actor text NOT NULL,
  action text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_events_request ON onboarding_events(request,created_at);
CREATE INDEX IF NOT EXISTS participants_searchable ON participants(searchable) WHERE owner IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['onboarding_requests','onboarding_events'] LOOP
    EXECUTE format('ALTER TABLE operator.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE operator.%I FROM PUBLIC',t);
  END LOOP;
END $$;

COMMIT;
