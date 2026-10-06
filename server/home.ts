import type { Database } from "./database";
import type { Actor } from "./auth";
import { getCurrentUser, isTeam, viewerOf } from "./auth";
import { database, databaseReady } from "./database";
import { berlinDate } from "../lib/kpis";
import {
  addDays,
  deadlineFor,
  isDueDay,
  isoWeekday,
  isPaused,
  previousDueDay,
  type DayStatus,
} from "../lib/commitment";
import { gameView, type GameMark, type GameRound, type GameStreak } from "../lib/game";
import { approvedPauses, firstClosableDay, loadCommitmentSettings } from "./settings";
import { replaceableImport } from "./closing";
import { loadGameInputs } from "./game";

/**
 * Persönlicher Stand für die gemeinsame Startseite. Nur, was der kompakte
 * Abschnitt „Mein Tag“ braucht: der eigene Tagesabschluss für heute (offen,
 * Entwurf, eingereicht), ein noch offener Calling-Tag davor und das eigene
 * Profil für die Markierung in der Rangliste. Keine Kontaktdaten.
 */
export type HomeState = {
  team: boolean;
  hasPassword: boolean;
  participant: { id: string; name: string } | null;
  /** Laufende Profilübernahme ohne eigenes Profil. */
  request: { kind: string; status: string } | null;
  today: {
    day: string;
    /** done: eingereicht · draft: Entwurf gespeichert · open: noch nichts · imported: vom Team übernommen */
    status: "done" | "draft" | "open" | "imported";
    /** Regulärer Calling-Tag (sonst freiwillig). */
    due: boolean;
  } | null;
  /** Offener Calling-Tag davor, der noch rechtzeitig abgeschlossen werden kann. */
  earlier: { day: string; deadline: string } | null;
  /**
   * Tagesrunde für die Karte „Mein Tag“. Nur, wenn angefordert (Startseite
   * und /ranking), damit der Kopf auf allen anderen Seiten nicht langsamer
   * wird; null, wenn sie sich gerade nicht rechnen ließ.
   */
  game?: HomeGame | null;
};

/** Kompakte Tagesrunde für die Startseite. Privat, nur für die Person selbst. */
export type HomeGame = {
  /** Heute in einer bestätigten Pause: keine Marke, die Flamme wartet. */
  paused: boolean;
  /** Heute kein Calling-Tag (Wochenende, freier Tag): keine Marke. */
  free: boolean;
  /**
   * Tagesmarke heute, mit Wiedereinstieg (comeback 'gap' bzw. 'pause') und
   * der Zahl der Basistage (unter 3: erste Marke). null an freien Tagen, in
   * Pausen, ohne Freischaltung und am aufgeteilten Duo-Tag.
   */
  mark: GameMark | null;
  /** Runde heute: Spielstand gegen die Marke, volle Runde. null ohne Marke. */
  round: GameRound | null;
  /** Status von heute aus summarize() (open, called, reflected …). */
  todayStatus: DayStatus | null;
  /** Frist für heute, nur an Pflicht-Tagen, ISO. */
  deadline: string | null;
  /** Die eine Serie mit Flamme; atRisk und paused sind privat. */
  streak: GameStreak;
  /** Laufende Woche (Montag bis Sonntag), Anwahlen aus dem Stand bis zur Frist. */
  week: { attempts: number; goal: number | null; reached: boolean };
};

/** Tagesrunde für die Startseite aus denselben Regeln wie unter Mein Tag. */
async function homeGame(db: Database, participant: string, now: Date): Promise<HomeGame | null> {
  const inputs = await loadGameInputs(db, participant);
  if (!inputs) return null;
  const view = gameView(inputs, now);
  return {
    paused: isPaused(view.today, inputs.pauses),
    free: !inputs.settings.callingWeekdays.includes(isoWeekday(view.today)),
    mark: view.mark,
    round: view.round,
    todayStatus: view.todayStatus,
    deadline: view.deadline,
    streak: view.streak,
    week: {
      attempts: view.week.totals.attempts ?? 0,
      goal: view.week.goal,
      reached: view.week.reached,
    },
  };
}

export async function homeState(
  db: Database,
  actor: Actor,
  today = berlinDate(),
  now = new Date(),
  options: { game?: boolean } = {},
): Promise<HomeState> {
  const base = { team: isTeam(actor), hasPassword: !!actor.hasPassword };
  const [participant] = await db.query(
    "SELECT id,name,eligible_since FROM participants WHERE owner=$1 AND kind='person' LIMIT 1",
    [actor.userId],
  );
  if (!participant) {
    const [request] = await db.query(
      `SELECT kind,status FROM onboarding_requests WHERE owner=$1
        ORDER BY (status IN ('pending','info_needed')) DESC, updated_at DESC LIMIT 1`,
      [actor.userId],
    );
    return {
      ...base,
      participant: null,
      request: request
        ? { kind: String(request.kind), status: String(request.status) }
        : null,
      today: null,
      earlier: null,
    };
  }
  const id = participant.id as string;
  const [settings, pauses, rows, drafts, game] = await Promise.all([
    loadCommitmentSettings(db),
    approvedPauses(db, id),
    db.query(
      `SELECT day,origin,source,submitted_at FROM checkins
        WHERE participant=$1 AND day >= $2 AND day <= $3`,
      // Heute und der Calling-Tag davor liegen in diesem Fenster.
      [id, addDays(today, -14), today],
    ),
    db.query("SELECT day FROM checkin_drafts WHERE participant=$1 AND day <= $2", [id, today]),
    // Die Karte steht auch ohne Tagesrunde; ein Fehler darin kostet nur den Block.
    options.game
      ? homeGame(db, id, now).catch((error) => {
          console.error("Tagesrunde:", (error as Error).message);
          return null;
        })
      : undefined,
  ]);
  // Abgeschlossen: eigener Abschluss oder ein gesperrter übernommener Stand.
  const closed = (day: string) =>
    rows.some((r) => r.day === day && !replaceableImport(r));
  const row = rows.find((r) => r.day === today);
  const status: NonNullable<HomeState["today"]>["status"] =
    row?.origin === "closing" && row.submitted_at
      ? "done"
      : row && !replaceableImport(row)
        ? "imported"
        : drafts.some((d) => d.day === today)
          ? "draft"
          : "open";
  // Freitag am Montagmorgen: noch offen, Frist läuft. Ohne Druck am
  // Wochenende; es geht nur um eine laufende Frist.
  let earlier: HomeState["earlier"] = null;
  const prev = previousDueDay(today, settings, pauses);
  const first = firstClosableDay(participant.eligible_since, settings);
  if (prev && first && prev >= first && !closed(prev)) {
    const deadline = deadlineFor(prev, settings, pauses);
    if (now.getTime() < deadline.getTime())
      earlier = { day: prev, deadline: deadline.toISOString() };
  }
  return {
    ...base,
    participant: { id, name: String(participant.name) },
    request: null,
    today: { day: today, status, due: isDueDay(today, settings, pauses) },
    earlier,
    ...(options.game ? { game } : {}),
  };
}


/**
 * Anmeldestand und persönlicher Stand für Startseite und /ranking. Mit
 * `game` zusätzlich die Tagesrunde für die Karte „Mein Tag“.
 */
export async function viewerState(options: { game?: boolean } = {}) {
  let actor = null;
  try {
    actor = await getCurrentUser();
  } catch {
    actor = null;
  }
  let home: HomeState | null = null;
  if (actor && databaseReady()) {
    try {
      home = await homeState(database(), actor, berlinDate(), new Date(), options);
    } catch {
      home = null;
    }
  }
  // Der Kopf weiß so, ob es ein Profil und heute noch etwas einzutragen gibt.
  const viewer = home
    ? { ...viewerOf(actor), hasProfile: !!home.participant, today: home.today?.status ?? null }
    : viewerOf(actor);
  return { viewer, home };
}
