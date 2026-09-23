-- Migration 0004: Team-Rollen (Admin, Moderator) in der Verwaltung vergeben.
--
-- Rein additiv. Die in OPERATOR_ADMIN_IDS hinterlegten Konten bleiben die
-- feste Grundverwaltung und stehen nicht in dieser Tabelle.
BEGIN;
SET LOCAL search_path=operator,pg_catalog;
CREATE TABLE IF NOT EXISTS team_roles(
  owner text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('admin','moderator')),
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  EXECUTE 'ALTER TABLE operator.team_roles ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON TABLE operator.team_roles FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operator_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON operator.team_roles TO operator_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='operator' AND tablename='team_roles' AND policyname='operator_server_access') THEN
      CREATE POLICY operator_server_access ON operator.team_roles FOR ALL TO operator_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;
COMMIT;
