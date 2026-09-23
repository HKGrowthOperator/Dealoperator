import type { Database } from "./database";
import { berlinDate } from "../lib/kpis";
import { addDays, type CommitmentSettings, type Pause } from "../lib/commitment";
import { activeCaller, type ActiveCaller } from "../lib/active-caller";
import { approvedPauses, loadCommitmentSettings } from "./settings";

/** Wie weit zurück gezählt wird: genug für Freischaltung und Verlust. */
const WINDOW_DAYS = 120;

const EMPTY: ActiveCaller = { active: false, since: null, run: 0, idle: 0, lostAt: null };

/** Status „Aktiver Caller“ für ein Konto (über das eigene Profil). */
export async function activeCallerFor(db: Database, owner: string, today = berlinDate()) {
  const [p] = await db.query(
    "SELECT id FROM participants WHERE owner=$1 AND kind='person' LIMIT 1",
    [owner],
  );
  if (!p) return EMPTY;
  return activeCallerForParticipant(db, p.id as string, today);
}

export async function activeCallerForParticipant(
  db: Database,
  participant: string,
  today = berlinDate(),
  /** Bereits geladene Regeln und Pausen (z. B. in der Rangliste). */
  known: { settings?: CommitmentSettings; pauses?: Pause[] } = {},
) {
  const [rows, settings, pauses] = await Promise.all([
    db.query(
      `SELECT day,counts->>'attempts' AS attempts
         FROM checkins WHERE participant=$1 AND day >= $2 AND day <= $3`,
      [participant, addDays(today, -WINDOW_DAYS), today],
    ),
    known.settings ?? loadCommitmentSettings(db),
    known.pauses ?? approvedPauses(db, participant),
  ]);
  const attempts: Record<string, number> = {};
  for (const r of rows) attempts[r.day as string] = Number(r.attempts) || 0;
  return activeCaller({ attempts, today, settings, pauses });
}

/** Konten mit verknüpftem Discord-Konto, die gerade „Aktiver Caller“ sind. */
export async function activeDiscordUsers(db: Database, today = berlinDate()) {
  const links = await db.query(
    `SELECT l.discord_user_id,p.id AS participant FROM discord_links l
       JOIN participants p ON p.owner=l.owner AND p.kind='person'`,
  );
  const active = new Set<string>();
  for (const l of links)
    if ((await activeCallerForParticipant(db, l.participant as string, today)).active)
      active.add(l.discord_user_id as string);
  return active;
}
