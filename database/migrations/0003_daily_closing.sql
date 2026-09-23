-- Migration 0003: Tagesabschluss, Dranbleiben, Benachrichtigungen, Discord.
--
-- Rein additiv und wiederholbar (IF NOT EXISTS). Bestehende Tagesstände
-- bleiben unverändert: sie sind kuratierte Importe und bekommen
-- origin='import'. Es werden keine Reflexionen erfunden.
--
-- Einmalig als Projektadministrator ausführen. Enthält die Rechte für die
-- Serverrolle operator_app gleich mit, weil „GRANT … ON ALL TABLES" aus
-- runtime-role.sql nur für damals vorhandene Tabellen gilt.
BEGIN;
SET LOCAL search_path=operator,pg_catalog;

-- Tagesabschluss --------------------------------------------------------------
-- checkins bleibt der gültige, gezählte Stand. Ein eigener Abschluss landet
-- dort erst, wenn Zahlen UND Reflexion vollständig eingereicht sind.
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'import';
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS first_submitted_at timestamptz;
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
-- Reflexion im Mitglieder-Austausch sichtbar. Nur für Abschlüsse, die über
-- den erklärten Einreichvorgang kommen; nie rückwirkend.
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;
-- Zusätzlich auf Discord teilen: eigene, ausdrückliche Zustimmung je
-- Abschluss, weil der Discord-Server einen anderen Leserkreis hat.
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS discord_share boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='checkins_origin_known') THEN
    ALTER TABLE checkins ADD CONSTRAINT checkins_origin_known CHECK (origin IN ('import','closing'));
  END IF;
  -- Ein Abschluss trägt immer beide Zeitpunkte, ein Import nie.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='checkins_closing_times') THEN
    ALTER TABLE checkins ADD CONSTRAINT checkins_closing_times CHECK (
      (origin='closing' AND first_submitted_at IS NOT NULL AND submitted_at IS NOT NULL)
      OR (origin='import' AND shared=false AND discord_share=false));
  END IF;
END $$;
UPDATE checkins SET origin='import' WHERE origin IS NULL;
ALTER TABLE checkin_revisions ADD COLUMN IF NOT EXISTS reflection jsonb;
CREATE INDEX IF NOT EXISTS checkins_shared ON checkins(day) WHERE origin='closing' AND shared;

-- Private Entwürfe: nie in Ranking, Summe, Serie, Austausch oder Discord.
CREATE TABLE IF NOT EXISTS checkin_drafts(
  participant text NOT NULL REFERENCES participants(id),
  day text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}',
  reflection jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(participant, day)
);

-- Dranbleiben -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pauses(
  id text PRIMARY KEY,
  participant text NOT NULL REFERENCES participants(id),
  from_day text NOT NULL,
  to_day text NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected')),
  requested_by text NOT NULL,
  decided_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (from_day <= to_day)
);
CREATE INDEX IF NOT EXISTS pauses_participant ON pauses(participant, status);

-- Einstellbare Startwerte (Pflicht-Tage, Frist, Erinnerungszeiten, Schwellen).
CREATE TABLE IF NOT EXISTS app_settings(
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Akquise Days und andere Tages-Events. Ein Event kennzeichnet einen Tag; die
-- Zahlen dieses Tages zählen genau einmal wie an jedem anderen Tag.
CREATE TABLE IF NOT EXISTS events(
  day text PRIMARY KEY,
  title text NOT NULL,
  partner text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  thanks text NOT NULL DEFAULT '',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO events(day,title,partner,url,thanks,created_by)
VALUES('2026-09-22','Akquise Day','akquise.de','https://akquise.de',
  'Danke an akquise.de für diesen Tag und an alle, die mitgezogen haben.','migration-0003')
ON CONFLICT(day) DO NOTHING;

-- Benachrichtigungen -----------------------------------------------------------
-- Nur für Schlüssel, die die Anwendung selbst erzeugt (VAPID), falls sie nicht
-- in der Serverumgebung gesetzt sind. Liegt im privaten Schema ohne
-- Data-API-Freigabe; nur die Serverrolle kann lesen.
CREATE TABLE IF NOT EXISTS app_secrets(
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions(
  id text PRIMARY KEY,
  owner text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failures integer NOT NULL DEFAULT 0,
  disabled_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_subscriptions_owner ON push_subscriptions(owner) WHERE disabled_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_prefs(
  owner text PRIMARY KEY,
  reminders boolean NOT NULL DEFAULT true,
  team_alerts boolean NOT NULL DEFAULT true,
  team_email boolean NOT NULL DEFAULT false,
  email text,
  quiet_start integer CHECK (quiet_start BETWEEN 0 AND 1439),
  quiet_end integer CHECK (quiet_end BETWEEN 0 AND 1439),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Versandprotokoll. dedupe_key ist je Empfänger, Art und Anlass eindeutig:
-- doppelte Worker oder Wiederholungen legen keine zweite Meldung an.
CREATE TABLE IF NOT EXISTS notifications(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  recipient text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('push','email')),
  kind text NOT NULL,
  ref text NOT NULL DEFAULT '',
  title text NOT NULL,
  body text NOT NULL,
  url text NOT NULL DEFAULT '/',
  not_after timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','skipped','failed')),
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_open ON notifications(status, created_at) WHERE status IN ('pending','sending');

CREATE TABLE IF NOT EXISTS team_inbox(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  ref text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);
CREATE INDEX IF NOT EXISTS team_inbox_open ON team_inbox(created_at DESC) WHERE resolved_at IS NULL;

-- Discord ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discord_links(
  owner text PRIMARY KEY,
  discord_user_id text NOT NULL UNIQUE,
  discord_name text NOT NULL DEFAULT '',
  linked_at timestamptz NOT NULL DEFAULT now()
);
-- Echte Beitragszuordnung für „Antworten auf Discord“ und für Korrekturen.
CREATE TABLE IF NOT EXISTS discord_posts(
  participant text NOT NULL REFERENCES participants(id),
  day text NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  thread_id text,
  posted_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(participant, day)
);

-- Wins-Import ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS participant_aliases(
  alias text PRIMARY KEY,
  participant text NOT NULL REFERENCES participants(id),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Prüffälle aus eingefügten Meldungen. Kein Rohchat — nur ein kurzer Auszug.
CREATE TABLE IF NOT EXISTS import_review_cases(
  id text PRIMARY KEY,
  day text NOT NULL,
  name_seen text NOT NULL,
  excerpt text NOT NULL DEFAULT '',
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  fingerprint text NOT NULL UNIQUE,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by text,
  resolved_at timestamptz
);

-- Nachschärfungen ---------------------------------------------------------------
-- Wann Telefonaktivität zum ersten Mal vollständig eingereicht wurde. Nur
-- bis zur Frist dokumentierte Anrufe machen einen Tag zum Calling-Tag.
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS calls_documented_at timestamptz;
-- Ab wann ein Konto alle Voraussetzungen für den Tagesabschluss erfüllte.
-- Serien, Fehltage und Erinnerungen beginnen erst danach — keine
-- rückwirkenden Strikes für übernommene oder importierte Profile.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS eligible_since timestamptz;
-- Entwürfe merken sich, auf welcher eingereichten Fassung sie beruhen.
ALTER TABLE checkin_drafts ADD COLUMN IF NOT EXISTS base_revision integer NOT NULL DEFAULT 0;
-- Zurückgestellte Meldungen (z. B. Team-Hinweis ohne Gerät) später erneut.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
-- Mit welchem öffentlichen VAPID-Schlüssel das Gerät zugestimmt hat.
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS vapid_key text NOT NULL DEFAULT '';
-- Inhalt des veröffentlichten Discord-Beitrags (Hash), damit geänderte
-- Zustimmung oder Namen den Beitrag nachziehen.
ALTER TABLE discord_posts ADD COLUMN IF NOT EXISTS posted_hash text NOT NULL DEFAULT '';
-- Getrennte Frist für die Bearbeitung durch einen Lauf.
ALTER TABLE sync_outbox ADD COLUMN IF NOT EXISTS leased_until timestamptz;
-- Höchstens eine Zustellung je Meldung und Gerät, auch nach Absturz.
CREATE TABLE IF NOT EXISTS notification_deliveries(
  notification_id bigint NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id text NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed','gone')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(notification_id, subscription_id)
);
-- Jeder Schreibweg nennt die Herkunft ausdrücklich; kein stiller Standard.
ALTER TABLE checkins ALTER COLUMN origin DROP DEFAULT;

-- Sicherheit und Rechte --------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['checkin_drafts','pauses','app_settings','events','app_secrets',
    'push_subscriptions','notification_prefs','notifications','team_inbox','discord_links',
    'discord_posts','participant_aliases','import_review_cases','notification_deliveries'] LOOP
    EXECUTE format('ALTER TABLE operator.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE operator.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operator_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON operator.%I TO operator_app', t);
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='operator' AND tablename=t AND policyname='operator_server_access') THEN
        EXECUTE format('CREATE POLICY operator_server_access ON operator.%I FOR ALL TO operator_app USING (true) WITH CHECK (true)', t);
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operator_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE operator.notifications_id_seq TO operator_app;
    GRANT USAGE, SELECT ON SEQUENCE operator.team_inbox_id_seq TO operator_app;
  END IF;
END $$;

COMMIT;
