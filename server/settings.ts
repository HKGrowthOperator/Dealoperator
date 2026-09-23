import { z } from "zod";
import type { Database } from "./database";
import {
  addDays,
  defaultCommitmentSettings,
  localDay,
  type CommitmentSettings,
  type Pause,
} from "../lib/commitment";

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
