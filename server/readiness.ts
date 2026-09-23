import type { Database } from "./database";
import { configurationIssues } from "./config";
import { mailConfigIssues } from "./mailer";
import { discordMissing } from "./discord-bridge";

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
  // Migration 0003: Tagesabschluss, Dranbleiben, Benachrichtigungen, Discord.
  "checkin_drafts",
  "pauses",
  "app_settings",
  "events",
  "app_secrets",
  "push_subscriptions",
  "notification_prefs",
  "notifications",
  "notification_deliveries",
  "team_inbox",
  "discord_links",
  "discord_posts",
  "participant_aliases",
  "import_review_cases",
  // Migration 0004: Team-Rollen.
  "team_roles",
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
  await db.query("SELECT id,eligible_since FROM participants LIMIT 0");
  // Spalten aus Migration 0003, ohne Inhalte zu lesen.
  await db.query(
    "SELECT origin,first_submitted_at,submitted_at,shared,discord_share,calls_documented_at FROM checkins LIMIT 0",
  );
  const [seq] = await db.query<{ ok: boolean }>(
    `SELECT has_sequence_privilege(current_user,'operator.notifications_id_seq','USAGE')
        AND has_sequence_privilege(current_user,'operator.team_inbox_id_seq','USAGE') AS ok`,
  );
  if (!seq?.ok) throw Error("Serverberechtigungen für Zähler fehlen.");
  return true;
}

export async function readiness(
  db: () => Database,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (configurationIssues(env).length)
    return { ready: false, configuration: false, database: false };
  // Nur ja/nein, keine Werte: ob Zusatzdienste eingerichtet sind. Sie
  // entscheiden nicht über die Bereitschaft der Website.
  const services = {
    teamMail: mailConfigIssues(env as NodeJS.ProcessEnv).length === 0,
    discordLink: discordMissing("link", env as NodeJS.ProcessEnv).length === 0,
    discordPosts: discordMissing("posts", env as NodeJS.ProcessEnv).length === 0,
  };
  try {
    await inspectDatabase(db());
    return { ready: true, configuration: true, database: true, services };
  } catch {
    return { ready: false, configuration: true, database: false, services };
  }
}
