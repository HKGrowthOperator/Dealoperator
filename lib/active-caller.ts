import { addDays, isDueDay, isPaused, type CommitmentSettings, type Pause } from "./commitment";

/**
 * „Aktiver Caller“: der Rang, der Sessions & Roleplay freischaltet und im
 * Discord als Rolle erscheint.
 *
 * - Freigeschaltet: an 5 Calling-Tagen am Stück jeweils mindestens 50
 *   Anwahlen. Ein Calling-Tag darunter setzt die Zählung zurück. Freie Tage
 *   (Wochenende) und bestätigte Pausen unterbrechen nichts; Anwahlen an einem
 *   freien Tag zählen mit, wenn es mindestens 50 sind.
 * - Verloren: an 3 Calling-Tagen in Folge gar keine Anwahlen. Danach gilt
 *   wieder: 5 Tage am Stück mit mindestens 50.
 * - Der laufende Tag zählt nur, wenn er schon geschafft ist; ein noch offener
 *   Tag schadet nie.
 *
 * Gezählt werden alle Tagesstände der Person (eigene Tagesabschlüsse und
 * übernommene Zahlen aus der Gruppe).
 */
export const ACTIVE_RUN_DAYS = 5;
export const ACTIVE_MIN_ATTEMPTS = 50;
export const ACTIVE_LOST_AFTER_IDLE = 3;

export type ActiveCaller = {
  active: boolean;
  /** Tag, an dem der aktuelle Status freigeschaltet wurde. */
  since: string | null;
  /** Calling-Tage am Stück mit mindestens 50 Anwahlen (bis 5 relevant). */
  run: number;
  /** Calling-Tage in Folge ohne Anwahlen, zuletzt. */
  idle: number;
  /** Tag, an dem der Status zuletzt verloren ging. */
  lostAt: string | null;
};

export function activeCaller({
  attempts,
  today,
  settings,
  pauses = [],
}: {
  /** Anwahlen je Tag (YYYY-MM-DD). Fehlende Tage zählen als 0. */
  attempts: Record<string, number | null | undefined>;
  today: string;
  settings: Pick<CommitmentSettings, "callingWeekdays">;
  pauses?: Pause[];
}): ActiveCaller {
  const state: ActiveCaller = { active: false, since: null, run: 0, idle: 0, lostAt: null };
  const days = Object.keys(attempts).filter((d) => d <= today).sort();
  if (!days.length) return state;
  for (let day = days[0]; day <= today; day = addDays(day, 1)) {
    if (isPaused(day, pauses)) continue;
    const n = Number(attempts[day] ?? 0) || 0;
    const due = isDueDay(day, settings as CommitmentSettings, pauses);
    if (n >= ACTIVE_MIN_ATTEMPTS) {
      state.run++;
      state.idle = 0;
    } else if (!due) {
      // Freier Tag unter 50: unterbricht nichts.
      if (n > 0) state.idle = 0;
      continue;
    } else if (day === today) {
      // Heute ist noch nicht vorbei.
      continue;
    } else {
      state.run = 0;
      state.idle = n > 0 ? 0 : state.idle + 1;
    }
    if (!state.active && state.run >= ACTIVE_RUN_DAYS) {
      state.active = true;
      state.since = day;
    }
    if (state.active && state.idle >= ACTIVE_LOST_AFTER_IDLE) {
      state.active = false;
      state.since = null;
      state.lostAt = day;
    }
  }
  return state;
}
