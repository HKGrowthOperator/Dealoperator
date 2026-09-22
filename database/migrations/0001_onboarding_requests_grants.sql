-- Rechte-Nachtrag zu Migration 0001, einmalig nach 0001_onboarding_requests.sql
-- als Projektadministrator ausführen.
--
-- "GRANT ... ON ALL TABLES" in database/runtime-role.sql gilt nur für die zum
-- Zeitpunkt der Ausführung vorhandenen Tabellen. Neue Tabellen brauchen die
-- Rechte und die Serverpolicy ausdrücklich, sonst scheitert /api/ready mit
-- "Datenbankschema oder Serverberechtigungen fehlen".
BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON operator.onboarding_requests TO operator_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON operator.onboarding_events TO operator_app;
GRANT USAGE, SELECT ON SEQUENCE operator.onboarding_events_id_seq TO operator_app;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['onboarding_requests','onboarding_events'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='operator' AND tablename=t AND policyname='operator_server_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY operator_server_access ON operator.%I FOR ALL TO operator_app USING (true) WITH CHECK (true)',
        t);
    END IF;
  END LOOP;
END $$;

COMMIT;
