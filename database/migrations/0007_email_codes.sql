-- Migration 0007: eigene Bestätigungs- und Passwortmails (Code und Link).
--
-- Anmeldemails von Supabase landen bei manchen Postfächern nicht im
-- Posteingang. Die App schickt deshalb eigene Mails über Resend (Absender und
-- Link auf der eigenen Domain) und prüft Code und Link selbst:
-- - email_codes: je Mail ein Eintrag mit dem Hash von Code und Link, nie der
--   Code selbst. Höchstens 5 Versuche, 30 Minuten gültig, einmal verwendbar;
--   eine neue Mail macht die vorige ungültig (server/email-code.ts).
-- - account_set_password: setzt nach einem eingelösten Code aus der Mail
--   „Passwort vergessen“ das neue Passwort (bcrypt wie Supabase) und
--   bestätigt dabei die Adresse. Sonst nichts. Wer sie aufrufen darf, prüft
--   der Server; die Datenbank gibt sie nur operator_app frei.
-- Bestätigt wird eine Registrierung über team_confirm_account aus 0006.
-- Rein additiv. Der Code schaltet die eigenen Mails erst frei, wenn Tabelle
-- und Funktion existieren. Ausführen als Eigentümer (postgres), nie mit dem
-- App-Zugang. Nur nach Freigabe ausführen.
BEGIN;
SET LOCAL search_path=operator,pg_catalog;

CREATE TABLE IF NOT EXISTS email_codes(
  id text PRIMARY KEY,
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('confirm','reset')),
  code_hash text NOT NULL,
  link_hash text NOT NULL,
  -- Registrierung, die mit dieser Mail bestätigt wird (nur bei confirm).
  request text REFERENCES onboarding_requests(id),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  -- Kennung der Mail bei Resend (Nachweis der Übergabe).
  mail_id text
);
CREATE INDEX IF NOT EXISTS email_codes_open ON email_codes(lower(email), purpose) WHERE used_at IS NULL;

DO $$ BEGIN
  EXECUTE 'ALTER TABLE operator.email_codes ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON TABLE operator.email_codes FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operator_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON operator.email_codes TO operator_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='operator' AND tablename='email_codes' AND policyname='operator_server_access') THEN
      CREATE POLICY operator_server_access ON operator.email_codes FOR ALL TO operator_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION operator.account_set_password(p_email text, p_password text)
RETURNS TABLE(status text, user_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Dieselben Grenzen wie in der App: mindestens 8 Zeichen, höchstens 72 Byte.
  IF p_password IS NULL OR char_length(p_password) < 8 OR octet_length(p_password) > 72 THEN
    RAISE EXCEPTION 'password_length' USING ERRCODE = '22023';
  END IF;
  SELECT u.id INTO v_id
    FROM auth.users u
   WHERE lower(u.email) = lower(p_email)
     AND u.deleted_at IS NULL
     AND NOT u.is_sso_user
     AND NOT u.is_anonymous
   LIMIT 1
   FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'missing'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE auth.users u
     SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         email_confirmed_at = COALESCE(u.email_confirmed_at, now()),
         raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb) || '{"has_password": true}'::jsonb,
         updated_at = now()
   WHERE u.id = v_id;
  UPDATE auth.identities i
     SET identity_data = i.identity_data || '{"email_verified": true}'::jsonb
   WHERE i.user_id = v_id AND i.provider = 'email';
  RETURN QUERY SELECT 'set'::text, v_id;
END;
$$;

REVOKE ALL ON FUNCTION operator.account_set_password(text, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION operator.account_set_password(text, text) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION operator.account_set_password(text, text) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operator_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION operator.account_set_password(text, text) TO operator_app';
  END IF;
END $$;

COMMIT;
