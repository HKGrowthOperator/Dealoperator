-- Fresh-project setup, after schema.sql and only after owner approval.
-- No password is embedded here. Set the role password separately via a secure admin session.
-- This server role has no browser or Data API access. Ownership is enforced by the Node API.
BEGIN;
CREATE ROLE operator_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA operator TO operator_app;
-- All runtime SQL is unqualified. The server also sends a session search_path,
-- but a pooler is not obliged to forward that startup parameter, so the role
-- carries its own default and the app stays independent of the connection path.
ALTER ROLE operator_app SET search_path = operator, pg_catalog;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA operator TO operator_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA operator TO operator_app;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='operator' LOOP
    EXECUTE format('CREATE POLICY operator_server_access ON operator.%I FOR ALL TO operator_app USING (true) WITH CHECK (true)',t.tablename);
  END LOOP;
END $$;
COMMIT;
