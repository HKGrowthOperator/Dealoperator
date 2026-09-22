import { z } from "zod";
import {
  aggregate,
  berlinDate,
  ranked,
  soloRows,
  visibleMetrics,
  type Counts,
  type RankingRow,
  type VisibleMetric,
} from "./kpis";

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine(
    (month) => month >= "2000-01" && month <= berlinDate().slice(0, 7),
    "Wähle einen gültigen Monat, der nicht in der Zukunft liegt.",
  );
export const AKQUISE_DAY = "2026-09-22";
export const metricShortLabels: Record<VisibleMetric, string> = {
  attempts: "Anwahlen",
  settingsBooked: "Settings",
  closingsBooked: "Closings",
  dealsWon: "Deals",
  settingsHeld: "Settings durchgeführt",
  closingsHeld: "Closings durchgeführt",
};
export function monthRange(month: string, today = berlinDate()) {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: last < today ? last : today, last };
}
export function formatDay(day: string, short = false) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: short ? "2-digit" : "long",
    ...(short ? {} : { year: "numeric" as const }),
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}
export function formatMonth(month: string) {
  return new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}
export function bookedAppointments(counts: Counts): number | null {
  const reported = [counts.settingsBooked, counts.closingsBooked].filter(
    (v): v is number => v !== null,
  );
  return reported.length ? reported.reduce((a, b) => a + b, 0) : null;
}
export type DailyLeader = {
  value: number;
  /** Nur Einzelpersonen. Gemeinsame Meldungen gewinnen keinen Tag. */
  people: { id: string; name: string }[];
};
export type RankingDay = {
  day: string;
  /** Einzelpersonen mit Meldung an diesem Tag. */
  profiles: number;
  /** Gemeinsame Meldungen an diesem Tag. Keine zusätzlichen Personen. */
  joint: number;
  counts: Counts;
  leaders: Record<VisibleMetric, DailyLeader | null>;
};
export type DatedRankingRow = RankingRow & { day: string };
export type RankingMonth = {
  month: string;
  days: RankingDay[];
  rows: RankingRow[];
  ready: boolean;
  snapshot: boolean;
  label: string;
};
export function summarizeRankingMonth(
  records: DatedRankingRow[],
  month: string,
  day?: string,
) {
  const byDay = new Map<string, RankingRow[]>();
  const byPerson = new Map<string, RankingRow>();
  for (const { day: recordDay, ...row } of records) {
    if (!recordDay.startsWith(`${month}-`)) continue;
    const daily = byDay.get(recordDay) || [];
    daily.push(row);
    byDay.set(recordDay, daily);
    if (day && recordDay !== day) continue;
    const previous = byPerson.get(row.id);
    byPerson.set(
      row.id,
      previous
        ? {
            ...row,
            counts: aggregate([previous.counts, row.counts]),
            updatedAt:
              row.updatedAt > previous.updatedAt
                ? row.updatedAt
                : previous.updatedAt,
          }
        : row,
    );
  }
  const days: RankingDay[] = [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      day: date,
      profiles: soloRows(rows).length,
      joint: rows.length - soloRows(rows).length,
      // Gesamtleistung: jede gültige Meldung genau einmal, gemeinsame
      // eingeschlossen. Das ist die einzige Stelle, an der sie mitzählen.
      counts: aggregate(rows.map((row) => row.counts)),
      leaders: Object.fromEntries(
        visibleMetrics.map((metric) => {
          // ranked() lässt gemeinsame Meldungen nicht antreten, deshalb kann
          // hier keine Teamleistung einen Tagessieg auslösen.
          const leaders = ranked(rows, metric).filter(
            (row) => row.rank === 1 && (row.counts[metric] ?? 0) > 0,
          );
          return [
            metric,
            leaders.length
              ? {
                  value: leaders[0].counts[metric]!,
                  people: leaders.map(({ id, name }) => ({ id, name })),
                }
              : null,
          ];
        }),
      ) as RankingDay["leaders"],
    }));
  return { month, days, rows: [...byPerson.values()] };
}
