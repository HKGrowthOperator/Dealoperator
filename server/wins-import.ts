import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import { isTeam, type Actor } from "./auth";
import { AppError, once, outbox } from "./operator";
import {
  berlinDate,
  daySchema,
  emptyCounts,
  metricLabels,
  type Counts,
  type Metric,
} from "../lib/kpis";
import { splitOrigin } from "../lib/joint-reports";
import {
  conflictReason,
  metricLabel,
  normaliseName,
  parseWins,
  settle,
  type DirectoryEntry,
  type FieldConflict,
  type Observation,
  type ReviewKind,
  type WinsEntry,
} from "../lib/wins-parser";

/**
 * Tagesmeldungen („Wins“) aus dem Team-Bereich übernehmen.
 *
 * Ablauf: Text einfügen → Vorschau mit Vergleich zum gespeicherten Stand →
 * übernehmen. Der Rohtext wird nicht gespeichert.
 *
 * Wiederholbar: Je Person, Tag und Kennzahl ist bekannt, aus welcher
 * Nachricht (Zeitpunkt) der gespeicherte Wert stammt. Den ganzen Verlauf oder
 * überlappende Ausschnitte erneut einzufügen, ändert nichts und zählt nichts
 * doppelt. Eine ältere Nachricht überschreibt nie einen Wert aus einer
 * neueren; eine spätere Korrektur gewinnt (Regeln: settle in
 * lib/wins-parser.ts).
 *
 * Der eigene Tagesabschluss gewinnt, der Import füllt Lücken: Tage mit
 * eigenem Abschluss überschreibt der Import nie, auch nicht bei übernommenen
 * Profilen. Einen vom Import gefüllten Tag ersetzt der eigene Abschluss
 * später (server/closing.ts). Neue Profile legt der Import nie an.
 *
 * Unklare Meldungen werden Prüffälle. Sie tragen die gelesenen Werte, damit
 * das Team sie nach der Entscheidung direkt übernehmen kann.
 */

const previewSchema = z
  .object({
    // Der ganze Gruppenverlauf darf erneut eingefügt werden.
    text: z.string().min(1, "Bitte Meldungen einfügen.").max(1_000_000, "Der Text ist zu lang. Bitte nur die letzten Tage einfügen."),
    day: daySchema,
  })
  .strict();

const commitSchema = previewSchema
  .extend({
    key: z.string().uuid(),
    expected: z
      .array(z.object({ key: z.string().max(200), revision: z.number().int().min(0) }))
      .max(5000),
  })
  .strict();

export type WinsAction =
  | "neu"
  | "korrektur"
  | "unverändert"
  | "übersprungen"
  | "prüffall"
  | "bekannt"
  | "ersetzt"
  | "ignoriert";

/** Was ein Prüffall trägt und was sich damit tun lässt. */
export type CaseInfo = {
  kind: ReviewKind;
  /** Gelesene Werte, die sich nach der Entscheidung übernehmen lassen. */
  values: Partial<Counts>;
  /** Bisheriger Wert bei einem Prüffall für eine einzelne Kennzahl. */
  from: Partial<Counts> | null;
  /** Wählbare Leistungstage; der erste ist der Vorschlag. */
  days: string[];
  /** Vorgeschlagenes oder erkanntes Profil. */
  participantId: string | null;
  /** Die Werte lassen sich so übernehmen. */
  applicable: boolean;
  /** Der gemeldete Name lässt sich als Alias merken. */
  aliasable: boolean;
};

export type WinsPreviewRow = {
  key: string | null;
  author: string;
  participantId: string | null;
  participantName: string | null;
  day: string;
  time: string | null;
  action: WinsAction;
  revision: number;
  before: Partial<Counts> | null;
  after: Partial<Counts> | null;
  changed: Metric[];
  reasons: string[];
  notes: string[];
  excerpt: string;
  review: CaseInfo | null;
};

function requireAdmin(actor: Actor) {
  // Admins und Moderatoren dürfen Tagesmeldungen übernehmen und Prüffälle lösen.
  if (!isTeam(actor))
    throw new AppError("Dieser Bereich ist nur für das Team freigeschaltet.", 403);
}

/**
 * Absender, die WhatsApp als Telefonnummer zeigt (kein Kontakt beim
 * Exportierenden). Die Nummer wird nie gespeichert oder angezeigt: sichtbar
 * ist eine maskierte Form, zugeordnet wird über einen Schlüssel aus der
 * Nummer (Alias „tel:…“).
 */
function senderDigits(author: string) {
  if (!/^\+?[\d\s()./-]{7,}$/.test(author.trim())) return null;
  const digits = author.replace(/^\s*00/, "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}
export function phoneAliasKey(author: string) {
  const digits = senderDigits(author);
  return digits ? `tel:${hash(`wins-absender:${digits}`).slice(0, 32)}` : null;
}
/** „+49 170 0000000“ → „+49 ••• •••••00“: Ländervorwahl und die letzten zwei Ziffern. */
export function maskSender(author: string) {
  if (!senderDigits(author)) return author;
  const total = author.replace(/\D/g, "").length;
  let seen = 0;
  return author.trim().replace(/\d/g, (d) => {
    seen++;
    return seen <= 2 || seen > total - 2 ? d : "•";
  });
}

/** Kontaktdaten aus Auszügen entfernen, bevor etwas gespeichert oder gezeigt wird. */
export function redact(value: string) {
  return value
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[E-Mail entfernt]")
    .replace(/\+?\d[\d\s/().-]{6,}\d/g, (m) =>
      m.replace(/\D/g, "").length >= 7 ? "[Nummer entfernt]" : m,
    );
}

async function directory(db: Database): Promise<DirectoryEntry[]> {
  const people = await db.query("SELECT id,name,kind FROM participants");
  const aliases = await db.query("SELECT alias,participant FROM participant_aliases");
  const byId = new Map<string, string[]>();
  for (const a of aliases) byId.set(a.participant, [...(byId.get(a.participant) || []), a.alias]);
  return people.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    kind: p.kind === "joint" ? "joint" : "person",
    aliases: byId.get(p.id) || [],
  }));
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const pick = (counts: Partial<Counts>) =>
  Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== null && v !== undefined)) as Partial<Counts>;
const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;
const whenText = (stamp: string | null) =>
  stamp ? `${shortDay(stamp.slice(0, 10))} ${stamp.slice(11)} Uhr` : "ohne Uhrzeit";

const STAMP_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** Zeitpunkt „YYYY-MM-DD HH:MM“ in Berliner Zeit, wie die Chat-Zeitstempel. */
export const berlinStamp = (at: Date) => STAMP_FORMAT.format(at).replace("T", " ");

// ---------------------------------------------------------------------------
// Gespeicherter Stand und seine Herkunft

/**
 * Herkunft je Kennzahl: Zeitpunkt der Nachricht, aus der der gespeicherte
 * Wert stammt. Ohne Schemaänderung liegt sie an der Revisionszeile, die der
 * Import schreibt: checkin_revisions.reflection = { winsStamps: {…} } bei
 * source='wins-import'. Import-Revisionen haben keine Reflexion, und diese
 * Spalte wird für sie nirgends gelesen. Die Angabe gilt nur, solange diese
 * Revision der aktuelle Stand ist. Sonst (z. B. CSV-Import oder ein Stand aus
 * der Zeit vor dieser Angabe) gilt der Zeitpunkt der letzten Änderung: was
 * vorher geschrieben wurde, ist darin enthalten oder überholt.
 */
type DayState = {
  counts: Counts;
  revision: number;
  origin: string;
  source: string;
  stamps: Partial<Record<Metric, string>>;
  /** Revisionszeile mit Herkunft, falls sie zum aktuellen Stand gehört. */
  provenanceId: string | null;
};

async function loadStates(db: Database, participants: string[], days: string[], lock = false) {
  const states = new Map<string, DayState>();
  if (!participants.length || !days.length) return states;
  const rows = await db.query(
    `SELECT participant,day,counts,revision,origin,source,updated_at FROM checkins
      WHERE participant = ANY($1::text[]) AND day = ANY($2::text[])${lock ? " FOR UPDATE" : ""}`,
    [participants, days],
  );
  const provenance = await db.query(
    `SELECT DISTINCT ON (participant,day) id,participant,day,revision,reflection FROM checkin_revisions
      WHERE source='wins-import' AND participant = ANY($1::text[]) AND day = ANY($2::text[])
      ORDER BY participant,day,id DESC`,
    [participants, days],
  );
  const byKey = new Map(provenance.map((p) => [`${p.participant}:${p.day}`, p]));
  for (const r of rows) {
    const key = `${r.participant}:${r.day}`;
    const p = byKey.get(key);
    const current = p && p.revision === r.revision ? p : null;
    const recorded = (current?.reflection?.winsStamps || {}) as Partial<Record<Metric, string>>;
    const changedAt = berlinStamp(new Date(r.updated_at));
    const counts = { ...emptyCounts(), ...(r.counts as Counts) };
    const stamps: Partial<Record<Metric, string>> = {};
    for (const m of Object.keys(metricLabels) as Metric[])
      if (counts[m] !== null && counts[m] !== undefined) stamps[m] = recorded[m] ?? changedAt;
    states.set(key, {
      counts,
      revision: r.revision,
      origin: r.origin,
      source: r.source,
      stamps,
      provenanceId: current ? String(current.id) : null,
    });
  }
  return states;
}

type Merge = {
  before: Counts | null;
  after: Counts;
  stamps: Partial<Record<Metric, string>>;
  changed: Metric[];
  conflicts: FieldConflict[];
  older: Observation[];
  /** Nur die Herkunft rückt vor (gleicher Wert aus einer neueren Nachricht). */
  stampsAdvanced: boolean;
};

/** Gemeldete Werte mit dem gespeicherten Stand abgleichen (je Kennzahl). */
function merge(state: DayState | null, observations: Observation[], now: string): Merge {
  const before = state ? state.counts : null;
  const after: Counts = { ...emptyCounts(), ...(before || {}) };
  const stamps = { ...(state?.stamps || {}) };
  const conflicts: FieldConflict[] = [];
  const older: Observation[] = [];
  for (const metric of new Set(observations.map((o) => o.metric))) {
    const s = settle(
      metric,
      before ? { value: before[metric] ?? null, stamp: state!.stamps[metric] ?? null } : null,
      observations,
      now,
    );
    after[metric] = s.value;
    if (s.stamp && s.value !== null) stamps[metric] = s.stamp;
    if (s.conflict) conflicts.push(s.conflict);
    older.push(...s.older);
  }
  const changed = (Object.keys(metricLabels) as Metric[]).filter(
    (m) => (before?.[m] ?? null) !== (after[m] ?? null),
  );
  const stampsAdvanced = (Object.keys(stamps) as Metric[]).some((m) => stamps[m] !== state?.stamps[m]);
  return { before, after, stamps, changed, conflicts, older, stampsAdvanced };
}

function olderNote(older: Observation[], after: Counts, stamps: Partial<Record<Metric, string>>) {
  if (!older.length) return null;
  const parts = older.map(
    (o) => `${metricLabel(o.metric)} ${o.value} (${whenText(o.stamp)})`,
  );
  const kept = [...new Set(older.map((o) => o.metric))].map(
    (m) => `${metricLabel(m)} ${after[m]} (${whenText(stamps[m] ?? null)})`,
  );
  return `Ältere Meldung überholt: ${parts.join(", ")}. Es gilt der neuere Stand: ${kept.join(", ")}.`;
}

async function writeDay(
  tx: Database,
  actor: Actor,
  w: { participantId: string; day: string; counts: Counts; stamps: Partial<Record<Metric, string>> },
) {
  const counts = JSON.stringify({ ...emptyCounts(), ...w.counts });
  // Zweite Sicherung auf Datenbankebene: ein eigener Abschluss wird nie durch
  // einen Import ersetzt.
  const [c] = await tx.query(
    `INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,$2,$3::jsonb,'wins-import','import')
     ON CONFLICT(participant,day) DO UPDATE SET counts=excluded.counts,revision=checkins.revision+1,
       source=excluded.source,updated_at=now()
     WHERE checkins.origin='import'
     RETURNING revision`,
    [w.participantId, w.day, counts],
  );
  if (!c) return false;
  const stamps = Object.fromEntries(
    Object.entries(w.stamps).filter(([m]) => w.counts[m as Metric] !== null && w.counts[m as Metric] !== undefined),
  );
  await tx.query(
    `INSERT INTO checkin_revisions(participant,day,revision,counts,reflection,actor,source)
     VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,'wins-import')`,
    [w.participantId, w.day, c.revision, counts, JSON.stringify({ winsStamps: stamps }), actor.userId],
  );
  await outbox(tx, w.participantId);
  return true;
}

// ---------------------------------------------------------------------------
// Prüffälle: Inhalt und Fingerabdruck

type CasePayload = CaseInfo & {
  v: 1;
  /** Zeitpunkt der Nachricht, aus der die Werte stammen. */
  stamp: string | null;
  /** Alias für den gemeldeten Namen (bei Telefonnummern ein Schlüssel statt der Nummer). */
  aliasKey?: string | null;
};

/**
 * Die gelesenen Werte eines Prüffalls liegen ohne Schemaänderung am Ende von
 * import_review_cases.reason, hinter einer festen Kennung. reviewCases()
 * trennt sie ab; sichtbar ist nur der Prüfgrund.
 */
const PAYLOAD_MARK = "\n⟦wins⟧";
const payloadSchema = z.object({
  v: z.literal(1),
  kind: z.enum(["person", "day", "value", "unclear"]),
  values: z.record(z.number().int().min(0).max(100000)),
  from: z.record(z.number().int().min(0).max(100000)).nullable(),
  days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(10),
  participantId: z.string().max(100).nullable(),
  applicable: z.boolean(),
  aliasable: z.boolean(),
  stamp: z.string().max(20).nullable(),
  aliasKey: z.string().max(100).nullable().optional(),
});
const onlyMetrics = (values: Record<string, number>) =>
  Object.fromEntries(Object.entries(values).filter(([k]) => k in metricLabels)) as Partial<Counts>;

function encodeReason(reason: string, payload: CasePayload) {
  return `${reason.slice(0, 500)}${PAYLOAD_MARK}${JSON.stringify(payload)}`;
}
function decodeReason(stored: string): { reason: string; payload: CasePayload | null } {
  const at = stored.indexOf(PAYLOAD_MARK);
  if (at < 0) return { reason: stored, payload: null };
  try {
    const p = payloadSchema.parse(JSON.parse(stored.slice(at + PAYLOAD_MARK.length)));
    return {
      reason: stored.slice(0, at),
      payload: { ...p, values: onlyMetrics(p.values), from: p.from ? onlyMetrics(p.from) : null },
    };
  } catch {
    return { reason: stored.slice(0, at), payload: null };
  }
}
const publicCase = (p: CasePayload): CaseInfo => ({
  kind: p.kind,
  values: p.values,
  from: p.from,
  days: p.days,
  participantId: p.participantId,
  applicable: p.applicable,
  aliasable: p.aliasable,
});

/**
 * Dieselbe Nachricht ergibt denselben Fingerabdruck, egal in welchem
 * Ausschnitt sie eingefügt wird: ein Prüffall entsteht nur einmal und kommt
 * nach der Entscheidung nicht wieder. Eine neue Nachricht oder ein neuer
 * Widerspruch ergibt einen neuen Fingerabdruck.
 */
function entryFingerprint(e: WinsEntry) {
  return hash(
    ["meldung", e.review, e.messageDay, e.time ?? "", normaliseName(e.author), e.text.replace(/\s+/g, " ").trim()].join("|"),
  );
}
function conflictFingerprint(participantId: string, day: string, c: FieldConflict) {
  return hash(["wert", participantId, day, c.metric, c.to, c.stamp ?? "", c.kind].join("|"));
}

// ---------------------------------------------------------------------------
// Vorschau

type Built = {
  row: WinsPreviewRow;
  write?: {
    mode: "write" | "stamps";
    participantId: string;
    day: string;
    counts: Counts;
    stamps: Partial<Record<Metric, string>>;
    provenanceId: string | null;
  };
  review?: { fingerprint: string; nameSeen: string; reason: string; payload: CasePayload };
};

async function build(db: Database, text: string, day: string, now = new Date()): Promise<Built[]> {
  const nowStamp = berlinStamp(now);
  const entries = parseWins({
    text,
    defaultDay: day,
    directory: await directory(db),
    today: berlinDate(now),
    aliasKeyOf: phoneAliasKey,
  });
  const ok = entries.filter((e) => e.status === "ok" && e.participantId);
  const ids = [...new Set(ok.map((e) => e.participantId!))];
  const participants = new Map(
    ids.length
      ? (await db.query("SELECT id,import_key FROM participants WHERE id = ANY($1::text[])", [ids])).map((p) => [p.id, p])
      : [],
  );
  const states = await loadStates(db, ids, [...new Set(ok.map((e) => e.day))]);
  const byLine = new Map(entries.map((e) => [e.line, e]));

  const built: Built[] = [];
  // Telefonnummern als Absender auch in Prüfgründen nur maskiert.
  const masked = (e: WinsEntry, texts: string[]) =>
    maskSender(e.author) === e.author ? texts : texts.map((t) => t.split(e.author).join(maskSender(e.author)));
  const base = (e: WinsEntry) => ({
    author: maskSender(e.author),
    participantId: e.participantId,
    participantName: e.participantName,
    day: e.day,
    time: e.time,
    notes: e.notes,
    excerpt: redact(e.excerpt),
  });
  for (const e of entries) {
    if (e.status === "ignored") {
      built.push({
        row: { ...base(e), key: null, action: "ignoriert", revision: 0, before: null, after: null, changed: [], reasons: [], review: null },
      });
      continue;
    }
    if (e.status === "superseded") {
      built.push({
        row: { ...base(e), key: null, action: "ersetzt", revision: 0, before: null, after: pick(e.metrics), changed: [], reasons: e.reasons, review: null },
      });
      continue;
    }
    if (e.status === "review" || !e.participantId) {
      const payload: CasePayload = {
        v: 1,
        kind: e.review ?? "unclear",
        values: pick(e.metrics),
        from: null,
        days: e.days.length ? e.days : [e.day],
        participantId: e.participantId,
        applicable: e.applicable,
        aliasable: !e.identified && !!e.author && e.author !== "(ohne Absender)",
        stamp: e.stamp,
        aliasKey: phoneAliasKey(e.author) ?? normaliseName(e.author),
      };
      built.push({
        row: { ...base(e), key: null, action: "prüffall", revision: 0, before: null, after: pick(e.metrics), changed: [], reasons: masked(e, e.reasons), review: publicCase(payload) },
        review: { fingerprint: entryFingerprint(e), nameSeen: maskSender(e.author), reason: masked(e, e.reasons).join(" "), payload },
      });
      continue;
    }
    const key = `${e.participantId}:${e.day}`;
    const state = states.get(key) ?? null;
    const split = splitOrigin(participants.get(e.participantId)?.import_key);
    const blocked =
      state?.origin === "closing"
        ? "Übersprungen: eigener Tagesabschluss vorhanden. Der eigene Abschluss gewinnt."
        : split && split.day === e.day
          ? // Aufgeteilte Duo-Meldungen (50/50) nie durch eine Einzelmeldung
            // ersetzen: die Gruppensumme würde sonst doppelt zählen.
            "Übersprungen: 50/50 aus gemeinsamer Meldung aufgeteilt. Korrektur bitte bewusst im Team."
          : null;
    if (blocked) {
      built.push({
        row: {
          ...base(e),
          key,
          action: "übersprungen",
          revision: state?.revision || 0,
          before: state ? pick(state.counts) : null,
          after: pick(e.metrics),
          changed: [],
          reasons: [...e.reasons, blocked],
          review: null,
        },
      });
      continue;
    }
    const m = merge(state, e.observations, nowStamp);
    const action: WinsAction = !state ? "neu" : m.changed.length ? "korrektur" : "unverändert";
    const note = olderNote(m.older, m.after, m.stamps);
    built.push({
      row: {
        ...base(e),
        key,
        action,
        revision: state?.revision || 0,
        before: state ? pick(state.counts) : null,
        after: pick(m.after),
        changed: m.changed,
        reasons: e.reasons,
        notes: note ? [...e.notes, note] : e.notes,
        review: null,
      },
      write:
        action !== "unverändert"
          ? { mode: "write", participantId: e.participantId, day: e.day, counts: m.after, stamps: m.stamps, provenanceId: null }
          : m.stampsAdvanced && state?.provenanceId
            ? { mode: "stamps", participantId: e.participantId, day: e.day, counts: m.after, stamps: m.stamps, provenanceId: state.provenanceId }
            : undefined,
    });
    // Späterer niedrigerer Wert: eigener Prüffall nur für diese Kennzahl.
    for (const c of m.conflicts) {
      const source = byLine.get(c.line) ?? e;
      const payload: CasePayload = {
        v: 1,
        kind: "value",
        values: { [c.metric]: c.to },
        from: { [c.metric]: c.from },
        days: [e.day],
        participantId: e.participantId,
        applicable: true,
        aliasable: false,
        stamp: c.stamp,
      };
      const reason = conflictReason(c);
      built.push({
        row: {
          ...base(source),
          day: e.day,
          time: c.stamp ? c.stamp.slice(11) : source.time,
          key: null,
          action: "prüffall",
          revision: 0,
          before: { [c.metric]: c.from },
          after: { [c.metric]: c.to },
          changed: [c.metric],
          reasons: [reason],
          notes: [],
          review: publicCase(payload),
        },
        review: { fingerprint: conflictFingerprint(e.participantId, e.day, c), nameSeen: maskSender(e.author), reason, payload },
      });
    }
  }
  // Schon bekannte Prüffälle (offen oder entschieden) nicht erneut anlegen.
  const fingerprints = built.filter((b) => b.review).map((b) => b.review!.fingerprint);
  const known = new Map(
    fingerprints.length
      ? (
          await db.query(
            "SELECT fingerprint,status FROM import_review_cases WHERE fingerprint = ANY($1::text[])",
            [fingerprints],
          )
        ).map((c) => [c.fingerprint as string, c.status as string])
      : [],
  );
  for (const b of built) {
    const status = b.review && known.get(b.review.fingerprint);
    if (!status) continue;
    b.row.action = "bekannt";
    b.row.notes = [
      ...b.row.notes,
      status === "open"
        ? "Dieser Prüffall ist schon angelegt und noch offen (siehe Prüffälle)."
        : "Dieser Prüffall ist schon entschieden. Er wird nicht erneut angelegt.",
    ];
  }
  return built;
}

const ACTIONS: WinsAction[] = ["neu", "korrektur", "unverändert", "übersprungen", "prüffall", "bekannt", "ersetzt", "ignoriert"];

export async function previewWins(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = previewSchema.parse(raw);
  const rows = (await build(db, v.text, v.day)).map((b) => b.row);
  return {
    rows,
    summary: Object.fromEntries(ACTIONS.map((a) => [a, rows.filter((r) => r.action === a).length])) as Record<
      WinsAction,
      number
    >,
  };
}

export async function commitWins(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = commitSchema.parse(raw);
  // Der Text wird nur für den Fingerabdruck der Anfrage verwendet, nicht gespeichert.
  const input = { ...v, text: createHash("sha256").update(v.text).digest("hex") };
  return once(db, actor.userId, v.key, input, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('operator-import'))");
    const built = await build(tx, v.text, v.day);
    const expected = new Map(v.expected.map((e) => [e.key, e.revision]));
    let written = 0,
      cases = 0;
    for (const { row: r, write, review } of built) {
      if (review && r.action === "prüffall") {
        const created = await tx.query(
          `INSERT INTO import_review_cases(id,day,name_seen,excerpt,reason,fingerprint,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(fingerprint) DO NOTHING RETURNING id`,
          [
            randomUUID(),
            r.day,
            review.nameSeen.slice(0, 80),
            r.excerpt,
            encodeReason(review.reason, review.payload),
            review.fingerprint,
            actor.userId,
          ],
        );
        cases += created.length;
        continue;
      }
      if (!write) continue;
      if (write.mode === "stamps") {
        // Gleicher Wert aus einer neueren Nachricht: nur die Herkunft rückt vor.
        await tx.query("UPDATE checkin_revisions SET reflection=$2::jsonb WHERE id=$1", [
          write.provenanceId,
          JSON.stringify({ winsStamps: write.stamps }),
        ]);
        continue;
      }
      if (expected.get(r.key!) !== r.revision)
        throw new AppError(
          "Der Datenstand hat sich seit der Vorschau geändert. Bitte die Vorschau neu laden.",
          409,
        );
      if (await writeDay(tx, actor, write)) written++;
    }
    return {
      ok: true,
      written,
      cases,
      unchanged: built.filter((b) => b.row.action === "unverändert").length,
      skipped: built.filter((b) => b.row.action === "übersprungen").length,
    };
  });
}

// ---------------------------------------------------------------------------
// Prüffälle

export async function reviewCases(db: Database, actor: Actor) {
  requireAdmin(actor);
  const rows = await db.query(
    `SELECT id,day,name_seen,excerpt,reason,status,created_at FROM import_review_cases
      ORDER BY (status='open') DESC, created_at DESC LIMIT 200`,
  );
  return rows.map((r) => {
    const { reason, payload } = decodeReason(r.reason);
    return {
      id: r.id as string,
      day: r.day as string,
      name_seen: r.name_seen as string,
      excerpt: r.excerpt as string,
      reason,
      status: r.status as string,
      created_at: r.created_at,
      kind: payload?.kind ?? null,
      values: payload?.values ?? {},
      from: payload?.from ?? null,
      days: payload?.days ?? [r.day as string],
      participantId: payload?.participantId ?? null,
      // Ältere Prüffälle ohne gespeicherte Werte: nur zuordnen oder verwerfen.
      applicable: !!payload?.applicable && Object.keys(payload.values).length > 0,
      aliasable: payload ? payload.aliasable : !!r.name_seen,
    };
  });
}

const resolveSchema = z
  .object({
    id: z.string().uuid(),
    decision: z.enum(["alias", "apply", "dismiss"]),
    participantId: z.string().max(100).optional(),
    day: daySchema.optional(),
  })
  .strict();

/** Werte eines Prüffalls für ein Profil und einen Tag übernehmen. */
async function applyCase(
  tx: Database,
  actor: Actor,
  payload: CasePayload,
  participantId: string,
  day: string,
) {
  const [p] = await tx.query("SELECT id,kind,import_key FROM participants WHERE id=$1", [participantId]);
  if (!p) throw new AppError("Dieses Profil gibt es nicht.", 404);
  if (p.kind !== "person")
    throw new AppError("Eine gemeinsame Meldung ist kein Ziel für einzelne Zahlen.", 409);
  const split = splitOrigin(p.import_key);
  if (split && split.day === day)
    throw new AppError("Dieser Tag ist 50/50 aus einer gemeinsamen Meldung aufgeteilt. Korrektur bitte bewusst im Team.", 409);
  const state = (await loadStates(tx, [participantId], [day], true)).get(`${participantId}:${day}`) ?? null;
  if (state?.origin === "closing")
    throw new AppError(
      "Für diesen Tag liegt ein eigener Tagesabschluss vor. Der eigene Abschluss gewinnt; bitte den Prüffall verwerfen.",
      409,
    );
  // Vom Team bestätigt: ein niedrigerer Wert gilt ohne weiteren Prüffall. Ein
  // Wert aus einer neueren Nachricht bleibt trotzdem stehen.
  const observations: Observation[] = (Object.entries(payload.values) as [Metric, number][]).map(
    ([metric, value]) => ({ metric, value, stamp: payload.stamp, line: 0, correction: true }),
  );
  const m = merge(state, observations, berlinStamp(new Date()));
  if (!m.changed.length) {
    if (m.older.length)
      throw new AppError(
        `${olderNote(m.older, m.after, m.stamps)} Nichts übernommen — bitte den Prüffall verwerfen.`,
        409,
      );
    return { written: false, message: "Der Stand stimmt schon überein. Nichts geändert." };
  }
  await writeDay(tx, actor, { participantId, day, counts: m.after, stamps: m.stamps });
  const note = olderNote(m.older, m.after, m.stamps);
  return {
    written: true,
    message: `Übernommen für ${shortDay(day)}: ${m.changed.map((k) => `${metricLabel(k)} ${m.after[k]}`).join(", ")}.${note ? ` ${note}` : ""}`,
  };
}

/**
 * „alias“: Der gemeldete Name gehört zu diesem Profil; künftige Meldungen
 * werden direkt zugeordnet. Trägt der Prüffall übernehmbare Werte, werden sie
 * gleich mit übernommen.
 * „apply“: Die Werte für das erkannte oder gewählte Profil und den gewählten
 * Tag übernehmen (z. B. „Vortag oder heute?“, späterer niedrigerer Wert).
 * „dismiss“: nichts übernehmen. Dieselbe Meldung wird kein neuer Prüffall.
 */
export async function resolveReviewCase(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = resolveSchema.parse(raw);
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('operator-import'))");
    const [c] = await tx.query(
      "SELECT * FROM import_review_cases WHERE id=$1 AND status='open' FOR UPDATE",
      [v.id],
    );
    if (!c) throw new AppError("Dieser Prüffall ist schon erledigt.", 409);
    const { payload } = decodeReason(c.reason);
    const day = v.day ?? payload?.days[0] ?? c.day;
    if (payload && !payload.days.includes(day))
      throw new AppError("Dieser Tag steht für diesen Prüffall nicht zur Wahl.");
    let applied: { written: boolean; message: string } | null = null;
    if (v.decision === "alias") {
      if (!v.participantId) throw new AppError("Bitte das passende Profil wählen.");
      if (payload && !payload.aliasable)
        throw new AppError("Für diesen Prüffall gibt es keinen Namen zum Zuordnen.", 409);
      const [p] = await tx.query("SELECT id,kind FROM participants WHERE id=$1", [v.participantId]);
      if (!p) throw new AppError("Dieses Profil gibt es nicht.", 404);
      if (p.kind !== "person")
        throw new AppError("Eine gemeinsame Meldung ist kein Ziel für einen Namen.", 409);
      // Bei Telefonnummern ist name_seen maskiert; der Schlüssel steht im Prüffall.
      const alias = payload?.aliasKey || normaliseName(c.name_seen);
      if (!alias) throw new AppError("Für diesen Prüffall gibt es keinen Namen zum Zuordnen.", 409);
      const [existing] = await tx.query("SELECT participant FROM participant_aliases WHERE alias=$1", [alias]);
      if (existing && existing.participant !== p.id)
        throw new AppError("Dieser Name ist bereits einem anderen Profil zugeordnet.", 409);
      await tx.query(
        "INSERT INTO participant_aliases(alias,participant,created_by) VALUES($1,$2,$3) ON CONFLICT(alias) DO NOTHING",
        [alias, p.id, actor.userId],
      );
      if (payload?.applicable && Object.keys(payload.values).length) {
        // Zuordnung bleibt, auch wenn sich die Werte nicht übernehmen lassen.
        await tx.query("SAVEPOINT apply_case");
        try {
          applied = await applyCase(tx, actor, payload, p.id, day);
          await tx.query("RELEASE SAVEPOINT apply_case");
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          await tx.query("ROLLBACK TO SAVEPOINT apply_case");
          applied = { written: false, message: e.message };
        }
      }
    } else if (v.decision === "apply") {
      if (!payload?.applicable || !Object.keys(payload.values).length)
        throw new AppError("Dieser Prüffall enthält keine Werte, die sich so übernehmen lassen.", 409);
      const participantId = v.participantId ?? payload.participantId;
      if (!participantId) throw new AppError("Bitte das passende Profil wählen.");
      applied = await applyCase(tx, actor, payload, participantId, day);
    }
    await tx.query(
      "UPDATE import_review_cases SET status=$2,resolved_by=$3,resolved_at=now() WHERE id=$1",
      [v.id, v.decision === "dismiss" ? "dismissed" : "resolved", actor.userId],
    );
    return { ok: true, written: !!applied?.written, message: applied?.message ?? null };
  });
}
