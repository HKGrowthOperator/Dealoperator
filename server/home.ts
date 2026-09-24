import type { Database } from "./database";
import type { Actor } from "./auth";
import { getCurrentUser, isTeam, viewerOf } from "./auth";
import { database, databaseReady } from "./database";
import { berlinDate } from "../lib/kpis";
import { addDays, deadlineFor, isDueDay, previousDueDay } from "../lib/commitment";
import { approvedPauses, firstClosableDay, loadCommitmentSettings } from "./settings";
import { replaceableImport } from "./closing";

/**
 * Persönlicher Stand für die gemeinsame Startseite. Nur, was der kompakte
 * Abschnitt „Mein Tag“ braucht: der eigene Tagesabschluss für heute (offen,
 * Entwurf, eingereicht), ein noch offener Calling-Tag davor und das eigene
 * Profil für die Markierung in der Rangliste. Keine Kontaktdaten.
 */
export type HomeState = {
  team: boolean;
  hasPassword: boolean;
  participant: { id: string; name: string; publicConsent: boolean } | null;
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
};

export async function homeState(
  db: Database,
  actor: Actor,
  today = berlinDate(),
  now = new Date(),
): Promise<HomeState> {
  const base = { team: isTeam(actor), hasPassword: !!actor.hasPassword };
  const [participant] = await db.query(
    "SELECT id,name,eligible_since,public_consent FROM participants WHERE owner=$1 AND kind='person' LIMIT 1",
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
  const [settings, pauses, rows, drafts] = await Promise.all([
    loadCommitmentSettings(db),
    approvedPauses(db, id),
    db.query(
      `SELECT day,origin,source,submitted_at FROM checkins
        WHERE participant=$1 AND day >= $2 AND day <= $3`,
      // Heute und der Calling-Tag davor liegen in diesem Fenster.
      [id, addDays(today, -14), today],
    ),
    db.query("SELECT day FROM checkin_drafts WHERE participant=$1 AND day <= $2", [id, today]),
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
    participant: { id, name: String(participant.name), publicConsent: !!participant.public_consent },
    request: null,
    today: { day: today, status, due: isDueDay(today, settings, pauses) },
    earlier,
  };
}


/** Anmeldestand und persönlicher Stand für Startseite und /ranking. */
export async function viewerState() {
  let actor = null;
  try {
    actor = await getCurrentUser();
  } catch {
    actor = null;
  }
  const viewer = viewerOf(actor);
  let home: HomeState | null = null;
  if (actor && databaseReady()) {
    try {
      home = await homeState(database(), actor);
    } catch {
      home = null;
    }
  }
  return { viewer, home };
}
