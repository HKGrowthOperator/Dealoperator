import type { Database } from "./database";
import { berlinDate } from "../lib/kpis";
import { addDays, type CommitmentSettings, type Pause } from "../lib/commitment";
import { splitOrigin } from "../lib/joint-reports";
import {
  communityGoalFor,
  communityView,
  communityWeek,
  weekStartOf,
  type CommunityRow,
  type CommunityView,
  type GameCheckin,
  type GameInputs,
} from "../lib/game";
import {
  approvedPauses,
  communitySettingsVersion,
  loadCommitmentSettings,
  loadCommunitySettings,
  trackingStart,
} from "./settings";

/**
 * Tagesrunde: Daten für die reinen Regeln in lib/game.ts. Keine Speicherung,
 * keine Migration; alles kommt aus checkins, checkin_revisions, pauses,
 * participants, profiles und app_settings.
 */

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

/** Wochenziel und Call-Tage aus dem Call-Profil (profiles.data, Text mit JSON). */
function profileGoal(data: unknown): Pick<GameInputs, "goal" | "days"> {
  let profile: Record<string, unknown> = {};
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    if (parsed && typeof parsed === "object") profile = parsed as Record<string, unknown>;
  } catch {
    /* ein unlesbares Profil heißt: kein Wochenziel */
  }
  const goal = profile.goal;
  const days = Array.isArray(profile.days) ? profile.days : [];
  return {
    // Im Profil gilt 1 bis 5.000 (app/api/community/route.ts).
    goal: Number.isInteger(goal) && (goal as number) >= 1 && (goal as number) <= 5000 ? (goal as number) : null,
    days: days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6),
  };
}

/**
 * Eingaben der Tagesrunde für ein eigenes Profil. Nur Zeilen dieses Profils
 * und nur für kind='person': ein gemeinsamer Datensatz spielt nicht mit
 * (dann null). Eigene Fassungen nur mit source='website'. `known` spart die
 * Abfragen, die der Aufrufer schon gemacht hat (z. B. im Transaktionsblock
 * von submitClosing).
 */
export async function loadGameInputs(
  db: Database,
  participantId: string,
  known: { settings?: CommitmentSettings; pauses?: Pause[] } = {},
): Promise<GameInputs | null> {
  const [[participant], checkins, revisions, pauses, settings] = await Promise.all([
    db.query(
      `SELECT p.kind,p.eligible_since,p.import_key,pr.data AS profile
         FROM participants p LEFT JOIN profiles pr ON pr.id=p.owner
        WHERE p.id=$1`,
      [participantId],
    ),
    db.query(
      `SELECT day,counts,origin,source,first_submitted_at,submitted_at,calls_documented_at
         FROM checkins WHERE participant=$1 ORDER BY day`,
      [participantId],
    ),
    db.query(
      `SELECT day,counts,created_at FROM checkin_revisions
        WHERE participant=$1 AND source='website' ORDER BY id`,
      [participantId],
    ),
    known.pauses ?? approvedPauses(db, participantId),
    known.settings ?? loadCommitmentSettings(db),
  ]);
  if (!participant || participant.kind !== "person") return null;
  const rows: GameCheckin[] = checkins.map((r) => ({
    day: r.day as string,
    counts: (r.counts ?? {}) as GameCheckin["counts"],
    origin: r.origin === "closing" ? "closing" : "import",
    source: String(r.source ?? ""),
    firstSubmittedAt: iso(r.first_submitted_at),
    submittedAt: iso(r.submitted_at),
    callsDocumentedAt: iso(r.calls_documented_at),
  }));
  return {
    participantId,
    kind: "person",
    checkins: rows,
    revisions: revisions.map((r) => ({
      day: r.day as string,
      counts: (r.counts ?? {}) as GameCheckin["counts"],
      createdAt: iso(r.created_at)!,
      source: "website",
    })),
    pauses,
    settings,
    // Wie in closingState(): der Freischaltungstag zählt, wenn an ihm schon
    // ein eigener Abschluss vorliegt.
    trackingStart: trackingStart(
      participant.eligible_since,
      settings,
      rows.filter((r) => r.origin === "closing" && r.firstSubmittedAt).map((r) => r.day),
    ),
    eligibleSince: iso(participant.eligible_since),
    splitDay: splitOrigin(participant.import_key)?.day ?? null,
    ...profileGoal(participant.profile),
  };
}

// ---------------------------------------------------------------------------
// Gemeinsames Wochenziel aller Anwahlen.

/**
 * Alle Tageszeilen der laufenden Woche und der fünf davor, bis heute. Die
 * Vorwoche braucht für ihr eigenes Ziel wiederum vier Wochen davor. Ohne
 * Namen: nur Profil, Art, Tag und Zahlen.
 */
async function communityRows(db: Database, today: string): Promise<CommunityRow[]> {
  const rows = await db.query(
    `SELECT c.participant,p.kind,c.day,c.counts
       FROM checkins c JOIN participants p ON p.id=c.participant
      WHERE c.day >= $1 AND c.day <= $2`,
    [addDays(weekStartOf(today), -35), today],
  );
  return rows.map((r) => ({
    participant: r.participant as string,
    kind: r.kind as string,
    day: r.day as string,
    counts: (r.counts ?? {}) as CommunityRow["counts"],
  }));
}

// Kurzer Zwischenspeicher wie bei /api/ranking/dranbleiben: dieselbe Summe
// wird höchstens einmal pro Minute neu berechnet, egal wie viele Anfragen
// kommen. Ein neuer Teamwert (saveCommunitySettings) gilt sofort.
const communityCache = new WeakMap<Database, Map<string, { at: number; view: CommunityView }>>();

/**
 * Stand des gemeinsamen Wochenziels für die Fläche „Gemeinsam erreicht“:
 * Wochensumme über aggregate() wie „Gemeinsam erreicht“ (gemeinsame
 * Meldungen genau einmal), Ziel aus app_settings 'community' oder
 * automatisch. `maxAge` 0 rechnet ohne Zwischenspeicher.
 */
export async function communityWeekState(
  db: Database,
  today = berlinDate(),
  { maxAge = 60_000 }: { maxAge?: number } = {},
): Promise<CommunityView> {
  const key = `${today}|${communitySettingsVersion()}`;
  let cache = communityCache.get(db);
  const hit = cache?.get(key);
  if (hit && hit.at > Date.now() - maxAge) return hit.view;
  const [rows, settings] = await Promise.all([communityRows(db, today), loadCommunitySettings(db)]);
  const view = communityView(rows, today, settings);
  if (maxAge > 0) {
    if (!cache) communityCache.set(db, (cache = new Map()));
    if (cache.size > 20) cache.clear();
    cache.set(key, { at: Date.now(), view });
  }
  return view;
}

/**
 * Für die Verwaltung: der Teamwert, der in dieser Woche gilt (sonst null),
 * und der Wert, den die Automatik diese Woche rechnen würde.
 */
export async function communityGoalState(db: Database, today = berlinDate()) {
  const weekStart = weekStartOf(today);
  const [rows, settings] = await Promise.all([communityRows(db, today), loadCommunitySettings(db)]);
  const sums = [1, 2, 3, 4]
    .map((i) => communityWeek(rows, addDays(weekStart, -7 * i)))
    .filter((w) => w.reported)
    .map((w) => ({ weekStart: w.weekStart, attempts: w.attempts }));
  const current = communityGoalFor(weekStart, settings, sums);
  return {
    weekStart,
    /** Gilt diese Woche ein Teamwert, steht er hier; sonst null. */
    team: current.auto ? null : current.goal,
    auto: communityGoalFor(weekStart, null, sums).goal,
    settings,
  };
}
