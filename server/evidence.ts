import { z } from "zod";
import type { Database } from "./database";
import { isTeam, type Actor } from "./auth";
import { AppError } from "./operator";
import { berlinDate } from "../lib/kpis";

/**
 * Nachweis je Tag: Gesprächszeit laut CRM und ein Screenshot (Anwahlen und
 * Gesprächszeit). Freiwillig. Den Screenshot sehen nur die Person selbst und
 * das Team; er erscheint nie in der Rangliste oder im Austausch.
 *
 * Die Tabelle kommt mit Migration 0005. Solange sie fehlt, ist die Funktion
 * aus (evidenceReady); nichts anderes hängt davon ab.
 */

/** Größe nach dem Verkleinern im Browser; die Datenbank prüft dieselbe Grenze. */
export const MAX_IMAGE_BYTES = 1_500_000;
/** Monatsstand: Tage mit mindestens so vielen Anwahlen und so viel Gesprächszeit (mit Screenshot). */
export const STRONG_DAY = { attempts: 100, talkMinutes: 90, target: 3 } as const;
/** Monatsstand: eigene Tagesabschlüsse mit mindestens so vielen Anwahlen. */
export const REPORT_MIN_ATTEMPTS = 50;

let cache: { ok: boolean; at: number } | null = null;
/** Gibt es die Tabelle? Einmal vorhanden, bleibt es so; sonst neu nachsehen nach 5 Minuten. */
export async function evidenceReady(db: Database) {
  if (cache?.ok) return true;
  if (cache && Date.now() - cache.at < 300_000) return false;
  const [row] = await db.query("SELECT to_regclass('operator.day_evidence') IS NOT NULL AS ok");
  cache = { ok: !!row?.ok, at: Date.now() };
  return cache.ok;
}
/** Nur für Tests. */
export function resetEvidenceCache() {
  cache = null;
}

async function requireReady(db: Database) {
  if (!(await evidenceReady(db)))
    throw new AppError("Gesprächszeit und Screenshot sind noch nicht freigeschaltet.", 404);
}

async function ownParticipant(db: Database, actor: Actor) {
  const [row] = await db.query("SELECT id FROM participants WHERE owner=$1 AND kind='person' LIMIT 1", [actor.userId]);
  if (!row) throw new AppError("Lege zuerst dein Profil an.", 409);
  return row.id as string;
}

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(Date.parse(d)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d);

/** Bildtyp aus den ersten Bytes, nie aus der Angabe des Browsers. */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

const saveSchema = z
  .object({
    day: daySchema,
    talkMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    image: z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8).optional(),
    removeImage: z.boolean().optional(),
  })
  .strict();

/**
 * Gesprächszeit und/oder Screenshot für einen eigenen Tag speichern. Nur die
 * übergebenen Felder ändern sich. Künftige Tage gehen nicht.
 */
export async function saveEvidence(db: Database, actor: Actor, raw: unknown) {
  await requireReady(db);
  const v = saveSchema.parse(raw);
  if (v.day > berlinDate()) throw new AppError("Für einen künftigen Tag gibt es noch nichts nachzuweisen.");
  if (v.day < "2026-01-01") throw new AppError("Diesen Tag gibt es hier nicht.");
  let image: Buffer | null = null;
  let type: string | null = null;
  if (v.image !== undefined) {
    image = Buffer.from(v.image, "base64");
    if (!image.length) throw new AppError("Das Bild ist leer. Bitte ein anderes wählen.", 400, undefined, "image");
    if (image.length > MAX_IMAGE_BYTES)
      throw new AppError("Das Bild ist zu groß. Bitte einen kleineren Ausschnitt wählen.", 413, undefined, "image");
    type = sniffImage(image);
    if (!type) throw new AppError("Bitte ein Bild als JPG, PNG oder WebP hochladen.", 400, undefined, "image");
  }
  const participant = await ownParticipant(db, actor);
  const [row] = await db.query(
    `INSERT INTO day_evidence(participant,day,talk_minutes,image,image_type,image_at,updated_by)
     VALUES($1,$2,$3,$4,$5,CASE WHEN $4::bytea IS NULL THEN NULL ELSE now() END,$6)
     ON CONFLICT(participant,day) DO UPDATE SET
       talk_minutes=CASE WHEN $7 THEN excluded.talk_minutes ELSE day_evidence.talk_minutes END,
       image=CASE WHEN $8 THEN excluded.image WHEN $9 THEN NULL ELSE day_evidence.image END,
       image_type=CASE WHEN $8 THEN excluded.image_type WHEN $9 THEN NULL ELSE day_evidence.image_type END,
       image_at=CASE WHEN $8 THEN now() WHEN $9 THEN NULL ELSE day_evidence.image_at END,
       updated_by=excluded.updated_by, updated_at=now()
     RETURNING talk_minutes,image IS NOT NULL AS has_image,image_at`,
    [
      participant,
      v.day,
      v.talkMinutes ?? null,
      image,
      type,
      actor.userId,
      v.talkMinutes !== undefined,
      image !== null,
      !!v.removeImage && image === null,
    ],
  );
  return {
    ok: true,
    talkMinutes: (row.talk_minutes as number | null) ?? null,
    hasImage: !!row.has_image,
    imageAt: row.image_at ? new Date(row.image_at).toISOString() : null,
  };
}

/** Eigener Nachweis für einen Tag, ohne das Bild selbst. */
export async function evidenceDay(db: Database, actor: Actor, day: string) {
  if (!(await evidenceReady(db))) return { enabled: false as const };
  const d = daySchema.parse(day);
  const participant = await ownParticipant(db, actor);
  const [row] = await db.query(
    "SELECT talk_minutes,image IS NOT NULL AS has_image,image_at FROM day_evidence WHERE participant=$1 AND day=$2",
    [participant, d],
  );
  return {
    enabled: true as const,
    talkMinutes: (row?.talk_minutes as number | null) ?? null,
    hasImage: !!row?.has_image,
    imageAt: row?.image_at ? new Date(row.image_at).toISOString() : null,
  };
}

/**
 * Das Bild eines Tages: für die Person selbst oder fürs Team (mit Profil-ID).
 * Niemand sonst bekommt es zu sehen.
 */
export async function evidenceImage(db: Database, actor: Actor, day: string, participant?: string | null) {
  await requireReady(db);
  const d = daySchema.parse(day);
  let id: string;
  if (participant) {
    if (!isTeam(actor)) {
      const own = await ownParticipant(db, actor);
      if (own !== participant) throw new AppError("Diesen Screenshot sieht nur das Team.", 403);
    }
    id = participant;
  } else id = await ownParticipant(db, actor);
  const [row] = await db.query(
    "SELECT image,image_type FROM day_evidence WHERE participant=$1 AND day=$2 AND image IS NOT NULL",
    [id, d],
  );
  if (!row) throw new AppError("Für diesen Tag gibt es keinen Screenshot.", 404);
  return { bytes: new Uint8Array(row.image as Buffer), type: row.image_type as string };
}

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Monatsstand einer Person: starke Tage mit Screenshot und eigene Berichte ab 50 Anwahlen. */
async function standings(db: Database, month: string, participant?: string) {
  const rows = await db.query(
    `SELECT c.participant,c.day,c.origin,(c.counts->>'attempts')::int AS attempts,
            e.talk_minutes,(e.image IS NOT NULL) AS has_image
       FROM checkins c
       LEFT JOIN day_evidence e ON e.participant=c.participant AND e.day=c.day
      WHERE c.day LIKE $1 ${participant ? "AND c.participant=$2" : ""}
      ORDER BY c.day`,
    participant ? [`${month}-%`, participant] : [`${month}-%`],
  );
  const by = new Map<string, { strong: string[]; reports: number; shots: { day: string; attempts: number | null; talkMinutes: number | null }[] }>();
  for (const r of rows) {
    const p = r.participant as string;
    const entry = by.get(p) ?? { strong: [], reports: 0, shots: [] };
    const attempts = (r.attempts as number | null) ?? null;
    const talk = (r.talk_minutes as number | null) ?? null;
    if (r.origin === "closing" && (attempts ?? 0) >= REPORT_MIN_ATTEMPTS) entry.reports++;
    if (
      r.origin === "closing" &&
      (attempts ?? 0) >= STRONG_DAY.attempts &&
      (talk ?? 0) >= STRONG_DAY.talkMinutes &&
      r.has_image
    )
      entry.strong.push(r.day as string);
    if (r.has_image) entry.shots.push({ day: r.day as string, attempts, talkMinutes: talk });
    by.set(p, entry);
  }
  return by;
}

export async function ownMonth(db: Database, actor: Actor, month: string) {
  if (!(await evidenceReady(db))) return { enabled: false as const };
  const m = monthSchema.parse(month);
  const participant = await ownParticipant(db, actor);
  const s = (await standings(db, m, participant)).get(participant);
  return {
    enabled: true as const,
    month: m,
    strongDays: s?.strong ?? [],
    target: STRONG_DAY.target,
    reports: s?.reports ?? 0,
  };
}

/** Fürs Team: Monatsstand aller Personen mit Tagen im Monat, mit Screenshots. */
export async function teamMonth(db: Database, actor: Actor, month: string) {
  if (!isTeam(actor)) throw new AppError("Diesen Überblick sieht nur das Team.", 403);
  if (!(await evidenceReady(db))) return { enabled: false as const };
  const m = monthSchema.parse(month);
  const by = await standings(db, m);
  const ids = [...by.keys()];
  const names = ids.length
    ? await db.query("SELECT id,name FROM participants WHERE id = ANY($1::text[]) AND kind='person'", [ids])
    : [];
  const people = names
    .map((p) => {
      const s = by.get(p.id as string)!;
      return {
        id: p.id as string,
        name: p.name as string,
        strongDays: s.strong,
        reports: s.reports,
        shots: s.shots,
      };
    })
    .filter((p) => p.reports > 0 || p.shots.length > 0)
    .sort((a, b) => b.strongDays.length - a.strongDays.length || b.reports - a.reports || a.name.localeCompare(b.name));
  return { enabled: true as const, month: m, target: STRONG_DAY.target, people };
}

/** Screenshots bleiben 62 Tage (Monat plus Auswertung); die Gesprächszeit bleibt. */
export const IMAGE_KEEP_DAYS = 62;
export async function pruneEvidence(db: Database, now = new Date()) {
  if (!(await evidenceReady(db))) return 0;
  const cutoff = new Date(now.getTime() - IMAGE_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.query(
    "UPDATE day_evidence SET image=NULL,image_type=NULL,image_at=NULL,updated_at=now() WHERE image IS NOT NULL AND day < $1 RETURNING day",
    [cutoff],
  );
  return rows.length;
}
