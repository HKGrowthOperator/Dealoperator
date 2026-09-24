import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import type { Actor } from "./auth";
import { AppError, canonicalJson, once, outbox } from "./operator";
import { normalisePhone } from "../lib/phone";
import {
  berlinDate,
  calendarDaySchema,
  daySchema,
  emptyCounts,
  numberSchema,
  type Counts,
} from "../lib/kpis";
import { summarize, type Closing, type ImportedDay } from "../lib/commitment";
import { teamEvent } from "./notify";
import {
  approvedPauses,
  firstClosableDay,
  loadCommitmentSettings,
  trackingStart,
} from "./settings";

/**
 * Der Tagesabschluss: Zahlen und Reflexion gemeinsam.
 *
 * Eigene Zahlen zählen erst, wenn beides vollständig eingereicht ist. Bis
 * dahin liegen sie als privater Entwurf in checkin_drafts und tauchen weder
 * im Ranking noch in der Gruppensumme, der Serie, dem Austausch oder auf
 * Discord auf. Bei einer Korrektur bleibt die zuletzt eingereichte Fassung
 * gültig, bis die neue vollständig eingereicht ist.
 *
 * Website, API und Discord gehen durch dieselben Funktionen; es gibt keinen
 * zweiten Weg, Zahlen ohne Reflexion zu zählen.
 */

// ---------------------------------------------------------------------------
// Berechtigung

export type Eligibility = {
  eligible: boolean;
  participant: {
    id: string;
    name: string;
    publicConsent: boolean;
    claimedAt: string | null;
    /** Seit wann alle Voraussetzungen erfüllt sind; Beginn der Erfassung. */
    eligibleSince: string | null;
  } | null;
  /** Was fehlt, in der Reihenfolge, in der es sich erledigen lässt. */
  missing: ("profile" | "phone" | "review")[];
};

export async function eligibility(
  db: Database,
  actor: Actor | null,
): Promise<Eligibility> {
  // Ohne Actor gibt es keine bestätigte E-Mail: getCurrentUser() liefert nur
  // bestätigte Konten.
  if (!actor) return { eligible: false, participant: null, missing: ["profile"] };
  const [p] = await db.query(
    "SELECT id,name,kind,public_consent,claimed_at,eligible_since FROM participants WHERE owner=$1",
    [actor.userId],
  );
  const [contact] = await db.query(
    "SELECT phone FROM account_private WHERE owner=$1",
    [actor.userId],
  );
  const [openClaim] = p
    ? []
    : await db.query(
        `SELECT id FROM onboarding_requests
         WHERE owner=$1 AND kind='claim' AND status IN ('pending','info_needed') LIMIT 1`,
        [actor.userId],
      );
  const missing: Eligibility["missing"] = [];
  if (!p || p.kind !== "person") missing.push(openClaim ? "review" : "profile");
  if (!normalisePhone(contact?.phone || "").ok) missing.push("phone");
  let eligibleSince: Date | null = p?.eligible_since ? new Date(p.eligible_since) : null;
  if (!missing.length && !eligibleSince) {
    // Erstmals vollständig berechtigt: ab jetzt beginnt die Erfassung.
    const [row] = await db.query(
      `UPDATE participants SET eligible_since=COALESCE(eligible_since, now())
        WHERE id=$1 RETURNING eligible_since`,
      [p.id],
    );
    eligibleSince = new Date(row.eligible_since);
  }
  return {
    eligible: missing.length === 0,
    participant:
      p && p.kind === "person"
        ? {
            id: p.id,
            name: p.name,
            publicConsent: !!p.public_consent,
            claimedAt: p.claimed_at ? new Date(p.claimed_at).toISOString() : null,
            eligibleSince: eligibleSince ? eligibleSince.toISOString() : null,
          }
        : null,
    missing,
  };
}

const MISSING_TEXT: Record<Eligibility["missing"][number], string> = {
  profile:
    "Für einen eigenen Tagesabschluss brauchst du ein persönliches Profil. Lege es an oder übernimm dein vorbereitetes Profil.",
  review:
    "Deine Profilübernahme wird gerade geprüft. Sobald das Team sie freigibt, kannst du deinen Tagesabschluss einreichen.",
  phone:
    "Bitte hinterlege eine gültige Telefonnummer mit Ländervorwahl in deinem Profil. Sie wird nicht per SMS geprüft und ist nur für das Team sichtbar.",
};

/**
 * Für den Scheduler: Mitglieder, die alle Voraussetzungen erfüllen, ohne die
 * Seite seither geöffnet zu haben, bekommen ihren Erfassungsbeginn. Nur mit
 * einheitlich gespeicherter Nummer (E.164); alte Schreibweisen werden beim
 * nächsten Besuch über eligibility() erkannt.
 */
export async function markEligibleMembers(db: Database) {
  await db.query(
    `UPDATE participants p SET eligible_since=now()
       FROM account_private a
      WHERE a.owner=p.owner AND p.owner IS NOT NULL AND p.kind='person'
        AND p.eligible_since IS NULL AND a.phone ~ '^\\+[1-9][0-9]{7,14}$'`,
  );
}

export function assertEligible(e: Eligibility) {
  if (!e.eligible)
    throw new AppError(MISSING_TEXT[e.missing[0]] || MISSING_TEXT.profile, 403);
}

// ---------------------------------------------------------------------------
// Eingaben

/** Pflicht: Anwahlen, Settings vereinbart, Closings vereinbart (0 erlaubt). */
const required = z
  .number({
    required_error: "Bitte trage Anwahlen, Settings und Closings ein (0 ist erlaubt).",
    invalid_type_error: "Bitte eine Zahl eintragen.",
  })
  .int("Bitte eine ganze Zahl eintragen.")
  .min(0)
  .max(100000);
export const closingCountsSchema = z
  .object({
    attempts: required,
    settingsBooked: required,
    closingsBooked: required,
    settingsHeld: numberSchema.default(null),
    closingsHeld: numberSchema.default(null),
    dealsWon: numberSchema.default(null),
  })
  .strict();

const text = (label: string) =>
  z
    .string()
    .trim()
    .min(3, `Bitte beantworte „${label}“ in ein paar Worten.`)
    .max(1500);
export const reflectionSchema = z
  .object({
    // Kein Vorgabewert: die Energie wird bewusst gewählt.
    energy: z
      .number({
        required_error: "Bitte wähle deine Energie von 1 bis 10.",
        invalid_type_error: "Bitte wähle deine Energie von 1 bis 10.",
      })
      .int()
      .min(1)
      .max(10),
    win: text("Was lief richtig gut?"),
    next: text("Was willst du beim nächsten Calling-Tag besser machen?"),
    help: z.string().trim().max(1500).default(""),
  })
  .strict();

export const submitSchema = z
  .object({
    day: daySchema,
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().uuid(),
    counts: closingCountsSchema,
    reflection: reflectionSchema,
    // Früher: „Zusätzlich im Discord-Channel teilen“. Discord ist nur noch für
    // Calls und Sessions da; ältere Formulare schicken das Feld noch mit. Es
    // wird angenommen und nicht beachtet (discord_share bleibt false).
    discord: z.boolean().optional(),
    // „Ich habe gelesen, wer meinen Tagesabschluss sieht.“ Pflicht nur, bis
    // die Bestätigung einmal vorliegt (visibilityConfirmed); geprüft wird in
    // submitClosing, weil es dafür das Profil braucht.
    acknowledged: z.boolean().optional(),
    // „Meine Zahlen in der Rangliste zeigen“ direkt im Tagesabschluss. Nur
    // einschalten; ausschalten bleibt bewusst im Profil, wo steht, was damit
    // verschwindet.
    publicConsent: z.literal(true).optional(),
  })
  .strict();

const ACK_MISSING = "Bitte bestätige, dass du gelesen hast, wer deinen Tagesabschluss sieht.";

/**
 * Hat das Mitglied schon einmal bestätigt, wer seinen Tagesabschluss sieht?
 *
 * Kein eigenes Feld: Ein eigener Abschluss (origin='closing') entsteht nur
 * über submitClosing, und der erste davon nur mit dieser Bestätigung. Gibt
 * es also einen, liegt die Bestätigung vor, auf jedem Gerät und an jedem
 * späteren Tag. Eigene Abschlüsse werden nicht gelöscht und nicht zu
 * Importen zurückgestuft.
 */
export async function visibilityConfirmed(db: Database, participant: string) {
  const [row] = await db.query(
    "SELECT EXISTS(SELECT 1 FROM checkins WHERE participant=$1 AND origin='closing') AS confirmed",
    [participant],
  );
  return !!row?.confirmed;
}

const draftSchema = z
  .object({
    day: daySchema,
    /** Revision der eingereichten Fassung, auf der der Entwurf beruht (0 = keine). */
    baseRevision: z.number().int().min(0).optional(),
    counts: z
      .object({
        attempts: numberSchema,
        settingsBooked: numberSchema,
        closingsBooked: numberSchema,
        settingsHeld: numberSchema,
        closingsHeld: numberSchema,
        dealsWon: numberSchema,
      })
      .partial()
      .strict(),
    reflection: z
      .object({
        energy: z.number().int().min(1).max(10).nullable(),
        win: z.string().max(1500),
        next: z.string().max(1500),
        help: z.string().max(1500),
      })
      .partial()
      .strict(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Entwurf

export async function saveDraft(db: Database, actor: Actor, raw: unknown) {
  const v = draftSchema.parse(raw);
  const e = await eligibility(db, actor);
  // Entwürfe sind auch ohne Telefonnummer möglich — sie zählen nirgends.
  if (!e.participant)
    throw new AppError(MISSING_TEXT[e.missing[0]] || MISSING_TEXT.profile, 403);
  return db.transaction(async (tx) => {
    // Dieselbe Sperre wie beim Einreichen: ein verspätetes automatisches
    // Speichern kann einen gerade eingereichten Stand nicht als Entwurf
    // wiederbeleben.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`owner:${actor.userId}`]);
    const [current] = await tx.query(
      "SELECT revision FROM checkins WHERE participant=$1 AND day=$2",
      [e.participant!.id, v.day],
    );
    const revision = (current?.revision as number) || 0;
    if (v.baseRevision !== undefined && v.baseRevision < revision)
      return { ok: false, stale: true, day: v.day, revision };
    await tx.query(
      `INSERT INTO checkin_drafts(participant,day,counts,reflection,base_revision) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)
       ON CONFLICT(participant,day) DO UPDATE SET counts=excluded.counts,reflection=excluded.reflection,
         base_revision=excluded.base_revision,updated_at=now()`,
      [e.participant!.id, v.day, JSON.stringify(v.counts), JSON.stringify(v.reflection), v.baseRevision ?? revision],
    );
    return { ok: true, day: v.day, revision };
  });
}

export async function discardDraft(db: Database, actor: Actor, raw: unknown) {
  const day = daySchema.parse((raw as { day?: unknown })?.day);
  await db.query(
    "DELETE FROM checkin_drafts d USING participants p WHERE d.participant=p.id AND p.owner=$1 AND d.day=$2",
    [actor.userId, day],
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Einreichen

/**
 * Ein Tag aus den Gruppenmeldungen (Wins-Import) füllt nur eine Lücke. Der
 * eigene Tagesabschluss ersetzt ihn; umgekehrt überschreibt der Import nie
 * einen eigenen Abschluss (server/wins-import.ts). Andere Importe (CSV,
 * aufgeteilte Duo-Meldungen) bleiben kuratiert und gesperrt.
 */
export function replaceableImport(row: { origin?: string; source?: string }) {
  return row.origin === "import" && row.source === "wins-import";
}

export async function submitClosing(db: Database, actor: Actor, raw: unknown) {
  const v = submitSchema.parse(raw);
  if (v.day > berlinDate())
    throw new AppError("Ein Tagesabschluss für einen künftigen Tag ist nicht möglich.");
  return once(db, actor.userId, v.idempotencyKey, v, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `owner:${actor.userId}`,
    ]);
    const e = await eligibility(tx, actor);
    assertEligible(e);
    const participant = e.participant!.id;
    // Wer sieht was: einmal bestätigen reicht, auch über die API.
    if (!v.acknowledged && !(await visibilityConfirmed(tx, participant)))
      throw new AppError(ACK_MISSING, 400, undefined, "acknowledged");
    if (v.publicConsent && !e.participant!.publicConsent)
      await tx.query("UPDATE participants SET public_consent=true WHERE id=$1", [participant]);
    const settings = await loadCommitmentSettings(tx);
    const first = firstClosableDay(e.participant!.eligibleSince, settings);
    if (first && v.day < first)
      throw new AppError(
        "Für Tage vor deinem Start im Tagesabschluss gilt der bisher übernommene Stand. Korrekturen dafür bitte über das Team.",
        409,
      );
    const [old] = await tx.query(
      "SELECT counts,reflection,revision,origin,source,first_submitted_at,discord_share,calls_documented_at FROM checkins WHERE participant=$1 AND day=$2 FOR UPDATE",
      [participant, v.day],
    );
    // Kuratierte Importe (z. B. Akquise Day, aufgeteilte Duo-Meldungen) werden
    // nie durch einen Abschluss ersetzt. Ein Tag aus den Gruppenmeldungen
    // (Wins-Import) füllt nur eine Lücke: der eigene Abschluss ersetzt ihn.
    if (old && old.origin !== "closing" && !replaceableImport(old))
      throw new AppError(
        "Für diesen Tag gibt es einen übernommenen Stand. Eine Korrektur dafür läuft über das Team.",
        409,
      );
    if ((old?.revision || 0) !== v.expectedRevision)
      throw new AppError(
        "Für diesen Tag gibt es inzwischen einen neueren Stand. Lade ihn und prüfe deine Eingabe erneut.",
        409,
      );
    // Termine ohne Typangabe und Entscheidergespräche nimmt das Formular
    // nicht mehr an; vorhandene Werte eines früheren Abschlusses bleiben
    // stehen. Ein ersetzter Import-Tag gibt keine Werte weiter: es gilt
    // allein, was die Person selbst einreicht.
    const kept = old?.origin === "closing" ? old.counts : null;
    const counts: Counts = {
      ...emptyCounts(),
      decisionMakerConversations: kept?.decisionMakerConversations ?? null,
      legacyMeetings: kept?.legacyMeetings ?? null,
      ...v.counts,
    };
    const reflection = v.reflection;
    if (
      old?.origin === "closing" &&
      canonicalJson(old.counts) === canonicalJson(counts) &&
      canonicalJson(old.reflection) === canonicalJson(reflection)
    ) {
      await tx.query("DELETE FROM checkin_drafts WHERE participant=$1 AND day=$2", [
        participant,
        v.day,
      ]);
      // Eine alte Discord-Freigabe dieses Tages fällt auch ohne neue Fassung weg.
      if (old.discord_share) {
        await tx.query(
          "UPDATE checkins SET discord_share=false,updated_at=now() WHERE participant=$1 AND day=$2",
          [participant, v.day],
        );
        await outbox(tx, participant);
      }
      return { ok: true, revision: old.revision as number, unchanged: true };
    }
    const revision = (old?.revision || 0) + 1;
    // Fristgerecht ist, was ZUERST vollständig einging. Eine spätere
    // Korrektur macht einen pünktlichen Tag nicht verspätet. Geteilt wird
    // nichts mehr auf Discord: discord_share ist immer false.
    const [row] = await tx.query(
      `INSERT INTO checkins(participant,day,counts,reflection,revision,source,origin,first_submitted_at,submitted_at,shared,discord_share,calls_documented_at)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,'website','closing',now(),now(),true,false,CASE WHEN $6 THEN now() END)
       ON CONFLICT(participant,day) DO UPDATE SET
         counts=excluded.counts, reflection=excluded.reflection, revision=excluded.revision,
         source='website', origin='closing', shared=true, discord_share=false,
         submitted_at=now(), updated_at=now(),
         -- Erste Dokumentation von Anrufen bleibt, auch über Korrekturen hinweg.
         calls_documented_at=COALESCE(checkins.calls_documented_at, CASE WHEN $6 THEN now() END),
         -- Ein ersetzter Import-Tag hat noch keine erste Einreichung.
         first_submitted_at=COALESCE(checkins.first_submitted_at, excluded.first_submitted_at)
       WHERE checkins.origin='closing' OR (checkins.origin='import' AND checkins.source='wins-import')
       RETURNING revision, first_submitted_at, submitted_at`,
      [participant, v.day, JSON.stringify(counts), JSON.stringify(reflection), revision, (counts.attempts ?? 0) > 0],
    );
    await tx.query(
      "INSERT INTO checkin_revisions(participant,day,revision,counts,reflection,actor,source) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,'website')",
      [participant, v.day, revision, JSON.stringify(counts), JSON.stringify(reflection), actor.userId],
    );
    await tx.query("DELETE FROM checkin_drafts WHERE participant=$1 AND day=$2", [
      participant,
      v.day,
    ]);
    await outbox(tx, participant);
    // Ein Unterstützungswunsch geht an das Team, nicht in den öffentlichen
    // Austausch. Je Tag ein Eintrag; eine Korrektur aktualisiert ihn.
    if (reflection.help)
      await teamEvent(tx, {
        dedupeKey: `help:${participant}:${v.day}`,
        kind: "help",
        ref: participant,
        state: "open",
        title: `Unterstützungswunsch: ${e.participant!.name}`,
        body: `${v.day}: ${reflection.help}`.slice(0, 1600),
        alert: false,
      });
    return {
      ok: true,
      revision: row.revision as number,
      firstSubmittedAt: new Date(row.first_submitted_at).toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Eigener Stand: Abschlüsse, Entwürfe, Serien, Kalender

export async function ownClosings(db: Database, participant: string) {
  const rows = await db.query(
    `SELECT day,counts,reflection,revision,origin,source,first_submitted_at,submitted_at,shared,calls_documented_at
     FROM checkins WHERE participant=$1 ORDER BY day DESC`,
    [participant],
  );
  return rows.map((r) => ({
    day: r.day as string,
    counts: r.counts as Counts,
    reflection: r.reflection as Record<string, unknown>,
    revision: r.revision as number,
    origin: r.origin as "import" | "closing",
    /** Übernommener Tag, den der eigene Abschluss ersetzen darf. */
    replaceable: replaceableImport(r),
    firstSubmittedAt: r.first_submitted_at
      ? new Date(r.first_submitted_at).toISOString()
      : null,
    submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null,
    shared: !!r.shared,
    callsDocumentedAt: r.calls_documented_at
      ? new Date(r.calls_documented_at).toISOString()
      : null,
  }));
}

/** Übernommene Tage (Import aus der Gruppe) ohne eigenen Abschluss. */
export function toImported(rows: Awaited<ReturnType<typeof ownClosings>>): ImportedDay[] {
  return rows
    .filter((r) => r.origin === "import")
    .map((r) => ({
      day: r.day,
      attempts: typeof r.counts?.attempts === "number" ? r.counts.attempts : null,
    }));
}

export function toClosings(rows: Awaited<ReturnType<typeof ownClosings>>): Closing[] {
  return rows
    .filter((r) => r.origin === "closing" && r.firstSubmittedAt)
    .map((r) => ({
      day: r.day,
      attempts: r.counts.attempts,
      firstSubmittedAt: r.firstSubmittedAt!,
      submittedAt: r.submittedAt!,
      callsDocumentedAt: r.callsDocumentedAt,
    }));
}

export async function closingState(
  db: Database,
  actor: Actor,
  month: string,
  now = new Date(),
) {
  const e = await eligibility(db, actor);
  const settings = await loadCommitmentSettings(db);
  if (!e.participant)
    return {
      eligibility: e,
      settings,
      closings: [],
      drafts: [],
      summary: null,
      calendar: null,
      trackingStart: null,
      firstClosableDay: null,
      pauses: [],
      visibilityConfirmed: false,
    };
  const [rows, drafts, pauses, pending] = await Promise.all([
    ownClosings(db, e.participant.id),
    db.query(
      `SELECT d.day,d.counts,d.reflection,d.updated_at,d.base_revision FROM checkin_drafts d
        LEFT JOIN checkins c ON c.participant=d.participant AND c.day=d.day
       WHERE d.participant=$1 AND (d.base_revision >= COALESCE(c.revision,0)
         -- Ein später importierter Tag verdrängt den eigenen Entwurf nicht.
         OR (c.origin='import' AND c.source='wins-import'))
       ORDER BY d.day DESC`,
      [e.participant.id],
    ),
    approvedPauses(db, e.participant.id),
    db.query(
      "SELECT id,from_day,to_day,reason,status FROM pauses WHERE participant=$1 ORDER BY from_day DESC LIMIT 20",
      [e.participant.id],
    ),
  ]);
  const from = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  const closings = toClosings(rows);
  const start = trackingStart(
    e.participant.eligibleSince,
    settings,
    closings.map((c) => c.day),
  );
  // Serien, Status und Frist immer bis heute; der Kalender für den Monat.
  const today = berlinDate(now);
  const imported = toImported(rows);
  const summary = summarize({
    closings,
    imported,
    pauses,
    trackingStart: start,
    from: start && start < today ? start : today,
    to: today,
    now,
    settings,
  });
  const calendar = summarize({
    closings,
    imported,
    pauses,
    trackingStart: start,
    from,
    to: last,
    now,
    settings,
  });
  return {
    eligibility: e,
    settings,
    closings: rows,
    drafts: drafts.map((d) => ({
      day: d.day as string,
      baseRevision: d.base_revision as number,
      counts: d.counts,
      reflection: d.reflection,
      updatedAt: new Date(d.updated_at).toISOString(),
    })),
    summary: { ...summary, days: undefined },
    calendar: {
      month,
      days: calendar.days,
      activeDays: calendar.activeDays,
      closedDays: calendar.closedDays,
    },
    trackingStart: start,
    firstClosableDay: firstClosableDay(e.participant.eligibleSince, settings),
    pauses: pending.map((p) => ({
      id: p.id,
      from: p.from_day,
      to: p.to_day,
      reason: p.reason,
      status: p.status,
    })),
    /**
     * Einmal bestätigt, wer den Tagesabschluss sieht: Der Hinweis mit der
     * Pflichtbestätigung entfällt. Dieselbe Regel wie visibilityConfirmed(),
     * hier aus den ohnehin geladenen Zeilen.
     */
    visibilityConfirmed: rows.some((r) => r.origin === "closing"),
  };
}

// ---------------------------------------------------------------------------
// Pausen: Mitglieder beantragen, die Verwaltung gibt frei.

const pauseSchema = z
  .object({
    from: calendarDaySchema,
    to: calendarDaySchema,
    reason: z.string().trim().max(300).default(""),
  })
  .strict()
  .refine((v) => v.from <= v.to, "Das Ende der Pause liegt vor dem Beginn.")
  // Rückwirkende Pausen trägt nur das Team ein (nachvollziehbar in der
  // Verwaltung); Mitglieder beantragen ab heute.
  .refine((v) => v.from >= berlinDate(), "Eine Pause kannst du ab heute melden. Für zurückliegende Tage sprich bitte das Team an.")
  .refine(
    (v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 62,
    "Eine Pause kann höchstens zwei Monate am Stück dauern.",
  );

export async function requestPause(db: Database, actor: Actor, raw: unknown) {
  const v = pauseSchema.parse(raw);
  const e = await eligibility(db, actor);
  if (!e.participant)
    throw new AppError(MISSING_TEXT[e.missing[0]] || MISSING_TEXT.profile, 403);
  const [open] = await db.query(
    "SELECT count(*)::int AS n FROM pauses WHERE participant=$1 AND status='requested'",
    [e.participant.id],
  );
  if (open.n >= 3)
    throw new AppError("Es warten schon drei Pausenmeldungen auf das Team.", 409);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO pauses(id,participant,from_day,to_day,reason,requested_by) VALUES($1,$2,$3,$4,$5,$6)",
      [id, e.participant!.id, v.from, v.to, v.reason, actor.userId],
    );
    await teamEvent(tx, {
      dedupeKey: `pause:${id}`,
      kind: "pause",
      ref: id,
      state: "requested",
      title: `Pause gemeldet: ${e.participant!.name}`,
      body: `${v.from} bis ${v.to}${v.reason ? ` · ${v.reason}` : ""}`,
      alert: false,
    });
  });
  return { ok: true, id };
}

export async function withdrawPause(db: Database, actor: Actor, raw: unknown) {
  const id = z.string().uuid().parse((raw as { id?: unknown })?.id);
  const rows = await db.query(
    `DELETE FROM pauses p USING participants pa
      WHERE p.id=$1 AND p.participant=pa.id AND pa.owner=$2 AND p.status='requested' RETURNING p.id`,
    [id, actor.userId],
  );
  if (!rows.length) throw new AppError("Diese Pausenmeldung kann nicht mehr zurückgezogen werden.", 409);
  return { ok: true };
}
