-- Reviewed local installation proposal. Never run automatically at app startup.
-- Execute ONLY in the explicitly approved new Supabase project.
BEGIN;
CREATE SCHEMA IF NOT EXISTS operator;
REVOKE ALL ON SCHEMA operator FROM PUBLIC;
SET LOCAL search_path=operator,pg_catalog;
CREATE TABLE profiles(id text PRIMARY KEY,data text NOT NULL);
CREATE TABLE records(owner text NOT NULL,date text NOT NULL,data text NOT NULL,PRIMARY KEY(owner,date));
CREATE TABLE sessions(id text PRIMARY KEY,owner text NOT NULL,data text NOT NULL);
CREATE TABLE rsvps(session text REFERENCES sessions(id),owner text,PRIMARY KEY(session,owner));
CREATE TABLE buddies(id text PRIMARY KEY,sender text NOT NULL,recipient text NOT NULL,data text NOT NULL);
CREATE TABLE preferences(owner text PRIMARY KEY,data text NOT NULL);
CREATE TABLE entitlements(owner text PRIMARY KEY,expires text NOT NULL);
CREATE TABLE buddy_messages(id text PRIMARY KEY,thread text REFERENCES buddies(id),sender text NOT NULL,created text NOT NULL,data text NOT NULL);
CREATE TABLE posts(id text PRIMARY KEY,owner text NOT NULL,created text NOT NULL,data text NOT NULL);
CREATE TABLE comments(id text PRIMARY KEY,post text REFERENCES posts(id),owner text NOT NULL,created text NOT NULL,data text NOT NULL);
CREATE TABLE relationships(id text PRIMARY KEY,owner text NOT NULL,data text NOT NULL);
CREATE TABLE intro_requests(id text PRIMARY KEY,relationship text REFERENCES relationships(id),sender text NOT NULL,recipient text NOT NULL,data text NOT NULL);
CREATE TABLE participants(id text PRIMARY KEY,import_key text UNIQUE,name text NOT NULL,company text NOT NULL DEFAULT '',role text NOT NULL DEFAULT '',email text,owner text UNIQUE,public_consent boolean NOT NULL DEFAULT false,searchable boolean NOT NULL DEFAULT true,kind text NOT NULL DEFAULT 'person' CHECK(kind IN ('person','joint')),claimed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX participants_email ON participants(lower(email));
CREATE TABLE checkins(participant text REFERENCES participants(id),day text NOT NULL,counts jsonb NOT NULL,reflection jsonb NOT NULL DEFAULT '{}',revision integer NOT NULL DEFAULT 1,source text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),origin text NOT NULL DEFAULT 'import' CONSTRAINT checkins_origin_known CHECK (origin IN ('import','closing')),first_submitted_at timestamptz,submitted_at timestamptz,shared boolean NOT NULL DEFAULT false,discord_share boolean NOT NULL DEFAULT false,CONSTRAINT checkins_closing_times CHECK ((origin='closing' AND first_submitted_at IS NOT NULL AND submitted_at IS NOT NULL) OR (origin='import' AND shared=false AND discord_share=false)),PRIMARY KEY(participant,day));
CREATE TABLE checkin_revisions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,participant text REFERENCES participants(id),day text NOT NULL,revision integer NOT NULL,counts jsonb NOT NULL,actor text NOT NULL,source text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),reflection jsonb);
CREATE TABLE requests(actor text NOT NULL,key text NOT NULL,hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor,key));
CREATE TABLE claim_tokens(hash text PRIMARY KEY,participant text REFERENCES participants(id),expires_at timestamptz NOT NULL,used_at timestamptz);
CREATE INDEX claims_participant ON claim_tokens(participant);
CREATE TABLE account_private(owner text PRIMARY KEY,email text,phone text NOT NULL DEFAULT '',contact_opt_in boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sync_outbox(participant text PRIMARY KEY REFERENCES participants(id),revision integer NOT NULL DEFAULT 1,state text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_limits(key text NOT NULL,bucket bigint NOT NULL,hits integer NOT NULL,PRIMARY KEY(key,bucket));
CREATE TABLE onboarding_requests(id text PRIMARY KEY,kind text NOT NULL,participant text REFERENCES participants(id),email text NOT NULL,full_name text NOT NULL,phone text NOT NULL,phone_input text NOT NULL DEFAULT '',hint text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'awaiting_email',owner text,applicant_message text NOT NULL DEFAULT '',internal_note text NOT NULL DEFAULT '',decided_by text,decided_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX onboarding_open_per_email ON onboarding_requests(lower(email),COALESCE(participant,'')) WHERE status IN ('awaiting_email','pending','info_needed');
CREATE INDEX onboarding_participant ON onboarding_requests(participant) WHERE status IN ('awaiting_email','pending','info_needed');
CREATE INDEX onboarding_owner ON onboarding_requests(owner);
CREATE INDEX onboarding_email ON onboarding_requests(lower(email));
CREATE TABLE onboarding_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request text NOT NULL REFERENCES onboarding_requests(id),actor text NOT NULL,action text NOT NULL,note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX onboarding_events_request ON onboarding_events(request,created_at);
CREATE INDEX participants_searchable ON participants(searchable) WHERE owner IS NULL;
CREATE INDEX participants_kind ON participants(kind);
CREATE INDEX checkins_day ON checkins(day);
CREATE INDEX buddy_sender ON buddies(sender);
CREATE INDEX buddy_recipient ON buddies(recipient);
CREATE INDEX messages_thread ON buddy_messages(thread,created);
CREATE INDEX comments_post ON comments(post,created);
CREATE INDEX intros_sender ON intro_requests(sender);
CREATE INDEX intros_recipient ON intro_requests(recipient);
-- Tagesabschluss, Dranbleiben, Benachrichtigungen, Discord (siehe migrations/0003).
CREATE TABLE checkin_drafts(
  participant text NOT NULL REFERENCES participants(id),
  day text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}',
  reflection jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(participant, day)
);
CREATE TABLE pauses(
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
CREATE TABLE app_settings(
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events(
  day text PRIMARY KEY,
  title text NOT NULL,
  partner text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  thanks text NOT NULL DEFAULT '',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_secrets(
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_subscriptions(
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
CREATE TABLE notification_prefs(
  owner text PRIMARY KEY,
  reminders boolean NOT NULL DEFAULT true,
  team_alerts boolean NOT NULL DEFAULT true,
  team_email boolean NOT NULL DEFAULT false,
  email text,
  quiet_start integer CHECK (quiet_start BETWEEN 0 AND 1439),
  quiet_end integer CHECK (quiet_end BETWEEN 0 AND 1439),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications(
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
CREATE TABLE team_inbox(
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
CREATE TABLE discord_links(
  owner text PRIMARY KEY,
  discord_user_id text NOT NULL UNIQUE,
  discord_name text NOT NULL DEFAULT '',
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE discord_posts(
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
CREATE TABLE participant_aliases(
  alias text PRIMARY KEY,
  participant text NOT NULL REFERENCES participants(id),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE import_review_cases(
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
CREATE INDEX checkins_shared ON checkins(day) WHERE origin='closing' AND shared;
CREATE INDEX pauses_participant ON pauses(participant, status);
CREATE INDEX push_subscriptions_owner ON push_subscriptions(owner) WHERE disabled_at IS NULL;
CREATE INDEX notifications_open ON notifications(status, created_at) WHERE status IN ('pending','sending');
CREATE INDEX team_inbox_open ON team_inbox(created_at DESC) WHERE resolved_at IS NULL;
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

INSERT INTO events(day,title,partner,url,thanks,created_by)
VALUES('2026-09-22','Akquise Day','akquise.de','https://akquise.de',
  'Danke an akquise.de für diesen Tag und an alle, die mitgezogen haben.','migration-0003')
ON CONFLICT(day) DO NOTHING;
DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='operator' LOOP EXECUTE format('ALTER TABLE operator.%I ENABLE ROW LEVEL SECURITY',t.tablename); EXECUTE format('REVOKE ALL ON TABLE operator.%I FROM PUBLIC',t.tablename); END LOOP; END $$;
-- Private schema is NOT exposed in Data API. RLS grants no browser access.
-- The server connects as the installation owner; each handler validates the actor
-- and limits queries by owner. Configure a dedicated restricted server role before launch.
COMMIT;
