-- Migration 0006: Zugang durch das Team (Konto nachsehen, Adresse bestätigen).
--
-- Rein additiv. Zwei Funktionen im Schema operator, keine Tabellen. Die App
-- hat keinen service_role-Schlüssel und als operator_app keine Rechte auf das
-- Schema auth; diese beiden Funktionen sind der einzige, eng begrenzte Weg:
-- - team_account_status: nur lesend (gibt es ein Konto, ist es bestätigt,
--   hat es ein Passwort, wann ist es entstanden).
-- - team_confirm_account: setzt email_confirmed_at und email_verified,
--   sonst nichts. Setzt NIE ein Passwort oder andere Felder.
-- Wer die Funktionen aufrufen darf (nur Admins), prüft der Server
-- (server/team-access.ts). Der Code schaltet die Funktion erst frei, wenn
-- beide Funktionen existieren. Ausführen als Eigentümer (postgres), nie mit
-- dem App-Zugang. Nur nach Freigabe ausführen.
BEGIN;

CREATE OR REPLACE FUNCTION operator.team_account_status(p_email text)
RETURNS TABLE(user_id uuid, confirmed boolean, has_password boolean, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT u.id,
         u.email_confirmed_at IS NOT NULL,
         COALESCE(u.encrypted_password, '') <> '',
         u.created_at
    FROM auth.users u
   WHERE lower(u.email) = lower(p_email)
     AND u.deleted_at IS NULL
     AND NOT u.is_sso_user
     AND NOT u.is_anonymous
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION operator.team_confirm_account(p_email text)
RETURNS TABLE(status text, user_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_confirmed timestamptz;
  v_password text;
BEGIN
  SELECT u.id, u.email_confirmed_at, u.encrypted_password
    INTO v_id, v_confirmed, v_password
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
  -- Ohne Passwort käme die Person nach dem Bestätigen nicht hinein: nichts ändern.
  IF COALESCE(v_password, '') = '' THEN
    RETURN QUERY SELECT 'no_password'::text, v_id;
    RETURN;
  END IF;
  IF v_confirmed IS NOT NULL THEN
    RETURN QUERY SELECT 'already'::text, v_id;
    RETURN;
  END IF;
  UPDATE auth.users u
     SET email_confirmed_at = now(), updated_at = now()
   WHERE u.id = v_id;
  UPDATE auth.identities i
     SET identity_data = i.identity_data || '{"email_verified": true}'::jsonb
   WHERE i.user_id = v_id AND i.provider = 'email';
  RETURN QUERY SELECT 'confirmed'::text, v_id;
END;
$$;

REVOKE ALL ON FUNCTION operator.team_account_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operator.team_confirm_account(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION operator.team_account_status(text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION operator.team_confirm_account(text) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION operator.team_account_status(text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION operator.team_confirm_account(text) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operator_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION operator.team_account_status(text) TO operator_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION operator.team_confirm_account(text) TO operator_app';
  END IF;
END $$;

COMMIT;
