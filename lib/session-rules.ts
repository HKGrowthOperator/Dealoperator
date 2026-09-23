import { berlinDate } from "./kpis";

/**
 * Regeln für Sessions (Call-Block, Roleplay, Reflexion). Getroffen wird sich im
 * Discord: Beim Abgleich entsteht für jede Session ein eigener Sprachkanal mit
 * Chat und ein Discord-Event; der Link erscheint danach auf der Website.
 */

/** Mindestvorlauf für neue oder verschobene Sessions. */
export const SESSION_LEAD_HOURS = 12;

export function sessionStart(s: { startsAt?: string; date: string; time: string }) {
  return new Date(s.startsAt || `${s.date}T${s.time}`);
}

export function sessionEnd(s: { startsAt?: string; date: string; time: string; minutes: number }) {
  return new Date(sessionStart(s).getTime() + s.minutes * 60_000);
}

/**
 * Neue oder verschobene Sessions: frühestens am nächsten Kalendertag (Berlin)
 * und mindestens zwölf Stunden ab jetzt. So bleibt Zeit zum Zusagen, und der
 * Raum im Discord steht rechtzeitig bereit.
 */
export function sessionLeadError(start: Date, now = new Date()): string | null {
  if (!Number.isFinite(start.getTime()) || start <= now) return "Wähle einen zukünftigen Termin.";
  if (berlinDate(start) <= berlinDate(now))
    return "Sessions legst du spätestens am Vortag an. So bleibt Zeit zum Zusagen, und der Raum im Discord steht rechtzeitig bereit.";
  if (start.getTime() - now.getTime() < SESSION_LEAD_HOURS * 3600_000)
    return `Sessions brauchen mindestens ${SESSION_LEAD_HOURS} Stunden Vorlauf. So bleibt Zeit zum Zusagen, und der Raum im Discord steht rechtzeitig bereit.`;
  return null;
}

/** Frühestes wählbares Datum im Formular: morgen (Berlin). */
export function earliestSessionDay(now = new Date()) {
  const today = berlinDate(now);
  let next = new Date(now.getTime() + 86_400_000);
  // Um die Zeitumstellung herum kann „+24 Stunden“ auf demselben Tag landen.
  while (berlinDate(next) <= today) next = new Date(next.getTime() + 3_600_000);
  return berlinDate(next);
}
