import type { Database } from "./database";
import { database, databaseReady } from "./database";
import { berlinDate } from "../lib/kpis";
import {
  deadlineFor,
  inQuietHours,
  isDueDay,
  localMinutes,
  remindersDue,
  summarize,
  zonedTime,
  type CommitmentSettings,
} from "../lib/commitment";
import { approvedPauses, loadCommitmentSettings, trackingStart } from "./settings";
import { dispatch, enqueue, teamEvent, type Recheck } from "./notify";
import { markEligibleMembers, toClosings, ownClosings } from "./closing";
import { syncDiscord } from "./discord-sync";

/**
 * Serverseitiger Takt für Erinnerungen, Team-Hinweise und Discord.
 *
 * Läuft im Node-Prozess (gestartet aus instrumentation.ts) und optional über
 * POST /api/cron/tick. Geplant wird nur unter einer Datenbank-Sperre; zwei
 * gleichzeitige Takte planen also nie doppelt. Und selbst dann verhindert der
 * eindeutige dedupe_key jede zweite Meldung.
 */

type Member = {
  participant: string;
  owner: string;
  name: string;
  eligible_since: string;
  reminders: boolean | null;
  quiet_start: number | null;
  quiet_end: number | null;
};

function quiet(m: { quiet_start: number | null; quiet_end: number | null }) {
  return m.quiet_start === null || m.quiet_end === null
    ? null
    : { start: m.quiet_start, end: m.quiet_end };
}

const TEXT = {
  evening: {
    title: "Dein Tagesabschluss fehlt noch",
    body: "Zahlen und kurze Reflexion eintragen — dann zählt dein Tag für dich und die Crew.",
  },
  streak: (day: string) => ({
    title: "Deine Serie hängt am Tagesabschluss",
    body: `Der Abschluss für ${day.slice(8, 10)}.${day.slice(5, 7)}. fehlt noch. Bis 10:00 Uhr zählt er fristgerecht.`,
  }),
};

export async function planReminders(
  tx: Database,
  now: Date,
  settings: CommitmentSettings,
) {
  const members = (await tx.query(
    `SELECT p.id AS participant,p.owner,p.name,p.eligible_since,
            np.reminders,np.quiet_start,np.quiet_end
       FROM participants p
       LEFT JOIN notification_prefs np ON np.owner=p.owner
      WHERE p.owner IS NOT NULL AND p.kind='person' AND p.eligible_since IS NOT NULL
        AND COALESCE(np.reminders,true)
        AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.owner=p.owner AND s.disabled_at IS NULL)`,
  )) as Member[];
  let planned = 0;
  const minutes = localMinutes(now, settings.timeZone);
  for (const m of members) {
    if (inQuietHours(minutes, quiet(m))) continue;
    const [rows, pauses] = await Promise.all([
      ownClosings(tx, m.participant),
      approvedPauses(tx, m.participant),
    ]);
    const closings = toClosings(rows);
    const due = remindersDue({
      owner: m.owner,
      closings,
      pauses,
      trackingStart: trackingStart(m.eligible_since, settings, closings.map((c) => c.day)),
      now,
      settings,
    });
    for (const r of due) {
      const text = r.kind === "evening" ? TEXT.evening : TEXT.streak(r.day);
      const created = await enqueue(tx, {
        dedupeKey: r.dedupeKey,
        recipient: m.owner,
        channel: "push",
        kind: `reminder:${r.kind}`,
        ref: `${m.participant}:${r.day}`,
        title: text.title,
        body: text.body,
        url: `/tagesabschluss?tag=${r.day}`,
        // Abends: nur bis Mitternacht. Morgens: nur bis zur Frist.
        notAfter:
          r.kind === "evening"
            ? zonedTime(r.day, 23, 59, settings.timeZone)
            : deadlineFor(r.day, settings, pauses),
      });
      if (created) planned++;
    }
  }
  return planned;
}

/** Drei offene fehlende Abschlüsse → einmal je Episode in die Team-Inbox. */
export async function planTeamReviews(
  tx: Database,
  now: Date,
  settings: CommitmentSettings,
) {
  await markEligibleMembers(tx);
  const members = await tx.query(
    `SELECT p.id,p.owner,p.name,p.eligible_since FROM participants p
      WHERE p.owner IS NOT NULL AND p.kind='person' AND p.eligible_since IS NOT NULL`,
  );
  const today = berlinDate(now);
  let flagged = 0;
  for (const m of members) {
    const [rows, pauses] = await Promise.all([
      ownClosings(tx, m.id),
      approvedPauses(tx, m.id),
    ]);
    const closings = toClosings(rows);
    const start = trackingStart(m.eligible_since, settings, closings.map((c) => c.day));
    if (!start || start > today) continue;
    const s = summarize({
      closings,
      pauses,
      trackingStart: start,
      from: start,
      to: today,
      now,
      settings,
    });
    if (s.needsTeamReview) {
      // Solange ein Prüfhinweis für diese Person offen ist, kein zweiter.
      const [open] = await tx.query(
        "SELECT 1 FROM team_inbox WHERE kind='review' AND ref=$1 AND resolved_at IS NULL LIMIT 1",
        [m.id],
      );
      if (open) continue;
      const missed = s.days.filter((d) => d.status === "missed").map((d) => d.day);
      // Die Episode heißt nach dem Tag, an dem die Schwelle erreicht wurde.
      const trigger = missed[settings.reviewAfterMissing - 1];
      await teamEvent(tx, {
        dedupeKey: `review:${m.id}:${trigger}`,
        kind: "review",
        ref: m.id,
        state: "open",
        title: `Teamprüfung: ${m.name}`,
        body: `${s.missingOpen} offene fehlende Tagesabschlüsse seit ${start}. Kein automatischer Ausschluss — bitte persönlich nachfragen oder eine Pause eintragen.`,
        alert: false,
      });
      flagged++;
    }
  }
  return flagged;
}

/** Zustand vor dem Versand erneut prüfen. Liefert einen Grund zum Auslassen. */
export const recheck: Recheck = async (db, n) => {
  if (n.kind.startsWith("reminder:")) {
    const [participant, day] = n.ref.split(":");
    const settings = await loadCommitmentSettings(db);
    const [row] = await db.query(
      `SELECT p.owner,np.reminders,np.quiet_start,np.quiet_end,
              EXISTS(SELECT 1 FROM checkins c WHERE c.participant=p.id AND c.day=$2 AND c.origin='closing') AS closed
         FROM participants p LEFT JOIN notification_prefs np ON np.owner=p.owner
        WHERE p.id=$1`,
      [participant, day],
    );
    if (!row || row.owner !== n.recipient) return "Profil gehört nicht mehr zu diesem Konto.";
    if (row.closed) return "Der Tagesabschluss liegt inzwischen vor.";
    if (row.reminders === false) return "Erinnerungen ausgeschaltet.";
    const pauses = await approvedPauses(db, participant);
    if (!isDueDay(day, settings, pauses)) return "Kein Pflicht-Tag (Wochenende oder Pause).";
    if (inQuietHours(localMinutes(new Date(), settings.timeZone), quiet(row as Member)))
      return "Ruhezeit.";
    return null;
  }
  if (n.kind.startsWith("team:")) {
    const admins = (process.env.OPERATOR_ADMIN_IDS || "").split(",").map((v) => v.trim());
    if (!admins.includes(n.recipient)) return "Kein Verwaltungskonto mehr.";
    const [prefs] = await db.query(
      "SELECT team_alerts FROM notification_prefs WHERE owner=$1",
      [n.recipient],
    );
    if (prefs && prefs.team_alerts === false) return "Team-Benachrichtigungen ausgeschaltet.";
    return null;
  }
  return null;
};

let schemaWarned = false;

/** Läuft erst, wenn die Tabellen aus Migration 0003 vorhanden sind. */
async function schemaReady(db: Database) {
  const [row] = await db.query(
    "SELECT to_regclass('operator.notification_deliveries') IS NOT NULL AS ok",
  );
  if (!row?.ok && !schemaWarned) {
    schemaWarned = true;
    console.error("Scheduler: Migration 0003 fehlt noch — Erinnerungen pausiert.");
  }
  return !!row?.ok;
}

export async function tick(db: Database, now = new Date()) {
  if (!(await schemaReady(db))) return { skipped: true, reason: "schema" };
  const settings = await loadCommitmentSettings(db);
  const plan = await db.transaction(async (tx) => {
    const [{ locked }] = await tx.query(
      "SELECT pg_try_advisory_xact_lock(hashtext('deal-operator-scheduler')) AS locked",
    );
    if (!locked) return { skipped: true, reminders: 0, reviews: 0 };
    const reminders = await planReminders(tx, now, settings);
    // Teamprüfung höchstens einmal pro Stunde; der Zeitpunkt der letzten
    // Prüfung steht in app_settings, damit kein Takt ausgelassen wird.
    const [last] = await tx.query("SELECT value FROM app_settings WHERE key='scheduler'");
    const lastReview = last?.value?.lastReview ? new Date(last.value.lastReview) : null;
    let reviews = 0;
    if (!lastReview || now.getTime() - lastReview.getTime() >= 3600_000) {
      reviews = await planTeamReviews(tx, now, settings);
      await tx.query(
        `INSERT INTO app_settings(key,value) VALUES('scheduler',$1::jsonb)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
        [JSON.stringify({ lastReview: now.toISOString() })],
      );
    }
    return { skipped: false, reminders, reviews };
  });
  const delivery = await dispatch(db, recheck, now);
  const discord = await syncDiscord(db).catch((e: Error) => ({ error: e.message }));
  return { ...plan, ...delivery, discord };
}

// ---------------------------------------------------------------------------
// Start im Server-Prozess

const state = globalThis as typeof globalThis & { __dealOperatorScheduler?: NodeJS.Timeout };

export function startScheduler() {
  if (state.__dealOperatorScheduler) return;
  if (!databaseReady() || process.env.SCHEDULER_DISABLED === "1") return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick(database());
    } catch (error) {
      // Nur die Meldung, keine Verbindungsdetails.
      console.error("Scheduler:", (error as Error).message);
    } finally {
      running = false;
    }
  };
  // Kurz nach dem Start einmal, dann jede Minute.
  setTimeout(run, 15_000).unref();
  state.__dealOperatorScheduler = setInterval(run, 60_000);
  state.__dealOperatorScheduler.unref();
}
