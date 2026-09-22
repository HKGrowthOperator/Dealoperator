import { Pool } from "pg";
import { configurationIssues, connectionOptions } from "../server/config";
import { Database } from "../server/database";
import { inspectDatabase } from "../server/readiness";
const issues = configurationIssues();
if (issues.length) {
  for (const issue of issues) console.error(issue);
  process.exitCode = 1;
} else {
  const pool = new Pool(connectionOptions());
  try {
    await inspectDatabase(new Database(pool));
    console.log(
      "Verbindung, Schema und Tabellenrechte sind erreichbar. Es wurden keine Daten verändert.",
    );
    console.log(
      "Als Nächstes: echte E-Mail-Anmeldung, Profilübernahme und Speichern mit zwei Testkonten prüfen. SMTP und Discord-Synchronisation sind durch diesen Check nicht getestet.",
    );
  } catch {
    console.error(
      "Datenbankprüfung fehlgeschlagen. Verbindung, TLS-Zertifikat, Schema und Rolle prüfen. Zugangsdaten werden nicht ausgegeben.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
