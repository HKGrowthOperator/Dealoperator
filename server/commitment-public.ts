import type { Database } from "./database";
import { berlinDate } from "../lib/kpis";
import { summarize } from "../lib/commitment";
import { approvedPauses, loadCommitmentSettings, trackingStart } from "./settings";
import { ownClosings, toClosings } from "./closing";

/**
 * Öffentliche Dranbleiben-Rangliste: nur Serien und aktive Tage von Personen,
 * die der öffentlichen Anzeige zugestimmt und seit der Übernahme mindestens
 * einen Tagesabschluss eingereicht haben. Status, Pausen, Fehltage und
 * Prüfhinweise bleiben privat. Wer (noch) nichts eingereicht hat, erscheint
 * nicht — fehlend ist nicht null.
 */
export async function commitmentRanking(
  db: Database,
  from: string,
  to: string,
  now = new Date(),
) {
  const settings = await loadCommitmentSettings(db);
  const people = await db.query(
    `SELECT p.id,p.name,p.company,p.eligible_since FROM participants p
      WHERE p.public_consent AND p.kind='person' AND p.owner IS NOT NULL AND p.eligible_since IS NOT NULL
        AND EXISTS (SELECT 1 FROM checkins c WHERE c.participant=p.id AND c.origin='closing')`,
  );
  const today = berlinDate(now);
  const rows = [];
  for (const p of people) {
    const [closingRows, pauses] = await Promise.all([
      ownClosings(db, p.id),
      approvedPauses(db, p.id),
    ]);
    const closings = toClosings(closingRows);
    const start = trackingStart(p.eligible_since, settings, closings.map((c) => c.day));
    if (!start) continue;
    const overall = summarize({
      closings,
      pauses,
      trackingStart: start,
      from: start < today ? start : today,
      to: today,
      now,
      settings,
    });
    const range = summarize({
      closings,
      pauses,
      trackingStart: start,
      from,
      to: to < today ? to : today,
      now,
      settings,
    });
    rows.push({
      id: p.id as string,
      name: p.name as string,
      company: (p.company as string) || "",
      streak: overall.streak,
      activeDays: range.activeDays,
      closedDays: range.closedDays,
    });
  }
  return rows
    .filter((r) => r.closedDays > 0 || r.streak.current > 0)
    .sort(byCommitment);
}

type RankedCommitment = {
  name: string;
  streak: { current: number };
  activeDays: number;
};
/**
 * Reihenfolge der Dranbleiben-Rangliste: zuerst die Serie (rechtzeitige
 * Tagesabschlüsse mit Reflexion, auch mit 0 Anwahlen), bei Gleichstand die
 * aktiven Tage im Monat.
 */
export function byCommitment(a: RankedCommitment, b: RankedCommitment) {
  return (
    b.streak.current - a.streak.current ||
    b.activeDays - a.activeDays ||
    a.name.localeCompare(b.name, "de")
  );
}

/** Kurzfassung der eigenen Serien für Discord (nur für die fragende Person). */
export async function discordStreakText(db: Database, owner: string, now = new Date()) {
  const [p] = await db.query(
    "SELECT id,eligible_since FROM participants WHERE owner=$1 AND kind='person'",
    [owner],
  );
  if (!p) return "Für dein Konto gibt es noch kein persönliches Profil.";
  const settings = await loadCommitmentSettings(db);
  const today = berlinDate(now);
  const [rows, pauses] = await Promise.all([ownClosings(db, p.id), approvedPauses(db, p.id)]);
  const closings = toClosings(rows);
  const start = trackingStart(p.eligible_since, settings, closings.map((c) => c.day));
  if (!start || start > today) return "Deine Serie beginnt mit deinem ersten Tagesabschluss.";
  const s = summarize({
    closings,
    pauses,
    trackingStart: start,
    from: start < today ? start : today,
    to: today,
    now,
    settings,
  });
  const lines = [
    `Serie: ${s.streak.current} (Bestwert ${s.streak.best}). Jeder rechtzeitige Tagesabschluss mit Reflexion zählt, auch mit 0 Anwahlen.`,
  ];
  if (s.atRisk)
    lines.push(
      `Offen: Tagesabschluss für ${s.atRisk.day.slice(8, 10)}.${s.atRisk.day.slice(5, 7)}. bis ${new Date(
        s.atRisk.deadline,
      ).toLocaleString("de-DE", { timeZone: settings.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit" })}.`,
    );
  return lines.join("\n");
}
