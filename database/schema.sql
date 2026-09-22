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
CREATE TABLE checkins(participant text REFERENCES participants(id),day text NOT NULL,counts jsonb NOT NULL,reflection jsonb NOT NULL DEFAULT '{}',revision integer NOT NULL DEFAULT 1,source text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(participant,day));
CREATE TABLE checkin_revisions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,participant text REFERENCES participants(id),day text NOT NULL,revision integer NOT NULL,counts jsonb NOT NULL,actor text NOT NULL,source text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
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
DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='operator' LOOP EXECUTE format('ALTER TABLE operator.%I ENABLE ROW LEVEL SECURITY',t.tablename); EXECUTE format('REVOKE ALL ON TABLE operator.%I FROM PUBLIC',t.tablename); END LOOP; END $$;
-- Private schema is NOT exposed in Data API. RLS grants no browser access.
-- The server connects as the installation owner; each handler validates the actor
-- and limits queries by owner. Configure a dedicated restricted server role before launch.
COMMIT;
