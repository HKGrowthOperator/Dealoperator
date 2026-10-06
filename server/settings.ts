import { z } from "zod";
import type { Database } from "./database";
import {
  addDays,
  defaultCommitmentSettings,
  isoWeekday,
  localDay,
  type CommitmentSettings,
  type Pause,
} from "../lib/commitment";
import { berlinDate, calendarDaySchema } from "../lib/kpis";
import {
  COMMUNITY_GOAL_ENTRIES,
  COMMUNITY_GOAL_MAX,
  COMMUNITY_GOAL_MIN,
  weekStartOf,
  type CommunitySettings,
} from "../lib/game";

/**
 * Startwerte der Dranbleiben-Regeln, überschreibbar über app_settings
 * (Schlüssel „commitment“). Ungültige gespeicherte Werte fallen auf den
 * Startwert zurück, statt den Scheduler anzuhalten.
 */
const clock = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});
export const commitmentSettingsSchema = z
  .object({
    timeZone: z.literal("Europe/Berlin"),
    callingWeekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((d) => new Set(d).size === d.length, "Wochentage doppelt."),
    deadlineHour: z.number().int().min(0).max(23),
    eveningReminder: clock,
    streakWarning: clock,
    inactivityAfterDays: z.number().int().min(1).max(30),
    reviewAfterMissing: z.number().int().min(1).max(30),
  })
  .strict()
  .refine(
    (s) => s.streakWarning.hour * 60 + s.streakWarning.minute < s.deadlineHour * 60,
    "Die Warnung muss vor der Frist liegen.",
  );

/**
 * Früher gab es eine getrennte Calling-Serie mit eigenem Schalter. Ein bereits
 * gespeicherter Wert dafür wird ignoriert, damit die übrigen gespeicherten
 * Regeln gültig bleiben.
 */
function withoutRetired(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const rest = { ...(value as Record<string, unknown>) };
  delete rest.zeroCallDayBreaksCallingStreak;
  return rest;
}

export async function loadCommitmentSettings(
  db: Database,
): Promise<CommitmentSettings> {
  const [row] = await db.query(
    "SELECT value FROM app_settings WHERE key='commitment'",
  );
  if (!row) return defaultCommitmentSettings;
  const parsed = commitmentSettingsSchema.safeParse({
    ...defaultCommitmentSettings,
    ...withoutRetired(row.value),
  });
  return parsed.success ? parsed.data : defaultCommitmentSettings;
}

export async function saveCommitmentSettings(
  db: Database,
  actorId: string,
  raw: unknown,
) {
  const value = commitmentSettingsSchema.parse(withoutRetired(raw));
  await db.query(
    `INSERT INTO app_settings(key,value,updated_by) VALUES('commitment',$1::jsonb,$2)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,
    [JSON.stringify(value), actorId],
  );
  return value;
}

export async function approvedPauses(
  db: Database,
  participant: string,
): Promise<Pause[]> {
  const rows = await db.query(
    "SELECT from_day,to_day FROM pauses WHERE participant=$1 AND status='approved' ORDER BY from_day",
    [participant],
  );
  return rows.map((r) => ({ from: r.from_day, to: r.to_day }));
}

/**
 * Erster Tag eigener Erfassung. Maßgeblich ist, seit wann das Konto alle
 * Voraussetzungen für den Tagesabschluss erfüllt (eligible_since). Der Tag
 * selbst zählt nur, wenn an ihm schon ein Abschluss vorliegt — sonst beginnt
 * die Erfassung am Folgetag. So entsteht nie ein Fehltag für einen Tag, an
 * dem ein gültiger Abschluss noch gar nicht möglich war.
 */
export function trackingStart(
  eligibleSince: string | Date | null | undefined,
  settings: CommitmentSettings,
  closedDays: Iterable<string> = [],
): string | null {
  if (!eligibleSince) return null;
  const first = localDay(new Date(eligibleSince), settings.timeZone);
  return new Set(closedDays).has(first) ? first : addDays(first, 1);
}

/** Frühester Tag, für den ein eigener Abschluss eingereicht werden kann. */
export function firstClosableDay(
  eligibleSince: string | Date | null | undefined,
  settings: CommitmentSettings,
): string | null {
  return eligibleSince ? localDay(new Date(eligibleSince), settings.timeZone) : null;
}

// ---------------------------------------------------------------------------
// Gemeinsames Wochenziel aller Anwahlen (app_settings, Schlüssel „community“).

/**
 * Teamwerte je Woche: ein Eintrag gilt ab seinem Montag, bis ein neuerer
 * Eintrag folgt. Ohne Eintrag oder mit leerem Eintrag (attempts null, „ab
 * hier automatisch“) rechnet lib/game.ts das Ziel aus den Wochen davor.
 * Ungültige gespeicherte Werte fallen auf die Automatik zurück, statt die
 * Startseite anzuhalten.
 */
const goalAttempts = z
  .number({ invalid_type_error: "Bitte eine Zahl eintragen." })
  .int("Bitte eine ganze Zahl eintragen.")
  .min(COMMUNITY_GOAL_MIN, "Das gemeinsame Wochenziel liegt zwischen 500 und 200.000 Anwahlen.")
  .max(COMMUNITY_GOAL_MAX, "Das gemeinsame Wochenziel liegt zwischen 500 und 200.000 Anwahlen.");
export const communitySettingsSchema = z
  .object({
    goals: z
      .array(
        z
          .object({
            from: calendarDaySchema.refine(
              // Läuft auch nach einem Formatfehler; isoWeekday() braucht das Format.
              (day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && isoWeekday(day) === 1,
              "Ein Wochenziel gilt immer ab einem Montag.",
            ),
            attempts: goalAttempts.nullable(),
          })
          .strict(),
      )
      .max(COMMUNITY_GOAL_ENTRIES)
      .refine((goals) => new Set(goals.map((g) => g.from)).size === goals.length, "Montag doppelt."),
  })
  .strict();

/** Eingabe der Verwaltung: der Wert ab dieser Woche, leer heißt automatisch. */
const communityGoalInput = z.object({ attempts: goalAttempts.nullable() }).strict();

// Steigt mit jedem Speichern; server/game.ts verwirft damit seinen
// Zwischenspeicher, damit ein neuer Teamwert sofort sichtbar ist.
let communityVersion = 0;
export const communitySettingsVersion = () => communityVersion;

export async function loadCommunitySettings(db: Database): Promise<CommunitySettings> {
  const [row] = await db.query("SELECT value FROM app_settings WHERE key='community'");
  const parsed = communitySettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : { goals: [] };
}

/**
 * Teamwert ab der laufenden Woche (Montag dieser Woche); ein Eintrag mit
 * gleichem Montag wird ersetzt. Leer heißt: ab dieser Woche wieder
 * automatisch. Dafür steht ein leerer Eintrag an diesem Montag, damit kein
 * älterer Teamwert weiter greift und frühere Wochen trotzdem ihr Ziel
 * behalten (Vorwochen-Zeile). Ein leerer Eintrag ohne Teamwert davor
 * ändert nichts und fällt weg. Höchstens 26 Einträge; die ältesten fallen
 * zuerst.
 */
export async function saveCommunitySettings(
  db: Database,
  actorId: string,
  raw: unknown,
  today = berlinDate(),
): Promise<CommunitySettings> {
  const { attempts } = communityGoalInput.parse(raw);
  const from = weekStartOf(today);
  const { goals } = await loadCommunitySettings(db);
  const sorted = [...goals.filter((g) => g.from !== from), { from, attempts }].sort((a, b) =>
    a.from.localeCompare(b.from),
  );
  const value = communitySettingsSchema.parse({
    goals: sorted
      .filter((g, i) => g.attempts !== null || (i > 0 && sorted[i - 1].attempts !== null))
      .slice(-COMMUNITY_GOAL_ENTRIES),
  });
  await db.query(
    `INSERT INTO app_settings(key,value,updated_by) VALUES('community',$1::jsonb,$2)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,
    [JSON.stringify(value), actorId],
  );
  communityVersion++;
  return value;
}
