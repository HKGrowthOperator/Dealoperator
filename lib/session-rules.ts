import { berlinDate } from "./kpis";
/** Calls can be arranged for any future time, including today. */
export function sessionStart(s: { startsAt?: string; date: string; time: string }) {
  return new Date(s.startsAt || `${s.date}T${s.time}`);
}
export function sessionEnd(s: { startsAt?: string; date: string; time: string; minutes: number }) {
  return new Date(sessionStart(s).getTime() + s.minutes * 60_000);
}
export function sessionLeadError(start: Date, now = new Date()): string | null {
  return !Number.isFinite(start.getTime()) || start <= now ? "Wähle einen zukünftigen Termin." : null;
}
export function earliestSessionDay(now = new Date()) { return berlinDate(now); }
