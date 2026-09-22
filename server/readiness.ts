import type { Database } from "./database";
import { configurationIssues } from "./config";

export const requiredTables = [
  "profiles",
  "records",
  "participants",
  "checkins",
  "checkin_revisions",
  "requests",
  "claim_tokens",
  "account_private",
  "sync_outbox",
  "rate_limits",
  "sessions",
  "rsvps",
  "buddies",
  "preferences",
  "buddy_messages",
  "posts",
  "comments",
  "entitlements",
  "relationships",
  "intro_requests",
];

export async function inspectDatabase(db: Database) {
  const rows = await db.query<{ name: string; allowed: boolean }>(
    `SELECT c.relname AS name,
       (has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
       AND has_table_privilege(current_user,c.oid,'UPDATE') AND has_table_privilege(current_user,c.oid,'DELETE')) AS allowed
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='operator' AND c.relkind='r'`,
  );
  const missing = requiredTables.filter(
    (name) => !rows.some((r) => r.name === name && r.allowed),
  );
  if (missing.length)
    throw Error("Datenbankschema oder Serverberechtigungen fehlen.");
  // Also verify access through RLS and the runtime search path without reading member data.
  await db.query("SELECT id FROM participants LIMIT 0");
  return true;
}

export async function readiness(
  db: () => Database,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (configurationIssues(env).length)
    return { ready: false, configuration: false, database: false };
  try {
    await inspectDatabase(db());
    return { ready: true, configuration: true, database: true };
  } catch {
    return { ready: false, configuration: true, database: false };
  }
}
