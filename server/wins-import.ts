import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import type { Actor } from "./auth";
import { AppError, importBlocked, once, outbox } from "./operator";
import {
  berlinDate,
  daySchema,
  emptyCounts,
  metricLabels,
  type Counts,
  type Metric,
} from "../lib/kpis";
import {
  normaliseName,
  parseWins,
  type DirectoryEntry,
  type WinsEntry,
} from "../lib/wins-parser";

/**
 * Tagesmeldungen („Wins“) aus dem Team-Bereich übernehmen.
 *
 * Ablauf: Text einfügen → Vorschau mit Vergleich zum gespeicherten Stand →
 * übernehmen. Der Rohtext wird nicht gespeichert. Ein wiederholter Import
 * desselben Textes erkennt dieselben Personen und Zahlen und ändert nichts.
 *
 * Nie überschrieben werden eigene Tagesabschlüsse und — ab dem Übernahmetag —
 * Tage eines übernommenen Profils. Unklare Meldungen werden Prüffälle.
 */

const previewSchema = z
  .object({
    text: z.string().min(1, "Bitte Meldungen einfügen.").max(200_000),
    day: daySchema,
  })
  .strict();

const commitSchema = previewSchema
  .extend({
    key: z.string().uuid(),
    expected: z
      .array(z.object({ key: z.string().max(200), revision: z.number().int().min(0) }))
      .max(2000),
  })
  .strict();

export type WinsAction = "neu" | "korrektur" | "unverändert" | "übersprungen" | "prüffall" | "ersetzt";

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
};

function requireAdmin(actor: Actor) {
  if (!actor.admin)
    throw new AppError("Dieser Bereich ist nur für die Verwaltung freigeschaltet.", 403);
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

const pick = (counts: Partial<Counts>) =>
  Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== null && v !== undefined)) as Partial<Counts>;

async function build(db: Database, text: string, day: string) {
  const entries: WinsEntry[] = parseWins({
    text,
    defaultDay: day,
    directory: await directory(db),
    today: berlinDate(),
  });
  const rows: WinsPreviewRow[] = [];
  for (const e of entries) {
    const base = {
      author: e.author,
      participantId: e.participantId,
      participantName: e.participantName,
      day: e.day,
      time: e.time,
      reasons: e.reasons,
      notes: e.notes,
      excerpt: redact(e.excerpt),
    };
    if (e.status !== "ok" || !e.participantId) {
      rows.push({
        ...base,
        key: null,
        action: e.status === "superseded" ? "ersetzt" : "prüffall",
        revision: 0,
        before: null,
        after: pick(e.metrics),
        changed: [],
      });
      continue;
    }
    const [p] = await db.query("SELECT id,owner,claimed_at FROM participants WHERE id=$1", [e.participantId]);
    const [c] = await db.query(
      "SELECT counts,revision,origin FROM checkins WHERE participant=$1 AND day=$2",
      [e.participantId, e.day],
    );
    const blocked = importBlocked(p, c, e.day);
    const before = c ? (c.counts as Counts) : null;
    // Eine Meldung ist ein Stand für die genannten Kennzahlen. Nicht genannte
    // Kennzahlen bleiben, wie sie sind.
    const after: Counts = { ...emptyCounts(), ...(before || {}), ...pick(e.metrics) };
    const changed = (Object.keys(metricLabels) as Metric[]).filter(
      (m) => (before?.[m] ?? null) !== (after[m] ?? null),
    );
    rows.push({
      ...base,
      key: `${e.participantId}:${e.day}`,
      action: blocked ? "übersprungen" : !before ? "neu" : changed.length ? "korrektur" : "unverändert",
      reasons: blocked ? [...e.reasons, blocked] : e.reasons,
      revision: c?.revision || 0,
      before: before ? pick(before) : null,
      after: pick(after),
      changed,
    });
  }
  // Pro Person und Tag bleibt nach parseWins höchstens eine gültige Zeile.
  return rows;
}

export async function previewWins(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = previewSchema.parse(raw);
  const rows = await build(db, v.text, v.day);
  const count = (a: WinsAction) => rows.filter((r) => r.action === a).length;
  return {
    rows,
    summary: {
      neu: count("neu"),
      korrektur: count("korrektur"),
      unverändert: count("unverändert"),
      übersprungen: count("übersprungen"),
      prüffall: count("prüffall"),
      ersetzt: count("ersetzt"),
    },
  };
}

function fingerprint(r: WinsPreviewRow) {
  return createHash("sha256")
    .update(`${r.day}|${normaliseName(r.author)}|${r.excerpt}`)
    .digest("hex");
}

export async function commitWins(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = commitSchema.parse(raw);
  // Der Text wird nur für den Fingerabdruck der Anfrage verwendet, nicht gespeichert.
  const input = { ...v, text: createHash("sha256").update(v.text).digest("hex") };
  return once(db, actor.userId, v.key, input, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('operator-import'))");
    const rows = await build(tx, v.text, v.day);
    const expected = new Map(v.expected.map((e) => [e.key, e.revision]));
    let written = 0,
      cases = 0;
    for (const r of rows) {
      if (r.action === "prüffall") {
        const created = await tx.query(
          `INSERT INTO import_review_cases(id,day,name_seen,excerpt,reason,fingerprint,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(fingerprint) DO NOTHING RETURNING id`,
          [
            randomUUID(),
            r.day,
            r.author.slice(0, 80),
            r.excerpt,
            r.reasons.join(" ").slice(0, 500),
            fingerprint(r),
            actor.userId,
          ],
        );
        cases += created.length;
        continue;
      }
      if (r.action !== "neu" && r.action !== "korrektur") continue;
      if (expected.get(r.key!) !== r.revision)
        throw new AppError(
          "Der Datenstand hat sich seit der Vorschau geändert. Bitte die Vorschau neu laden.",
          409,
        );
      const [c] = await tx.query(
        `INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,$2,$3::jsonb,'wins-import','import')
         ON CONFLICT(participant,day) DO UPDATE SET counts=excluded.counts,revision=checkins.revision+1,
           source=excluded.source,updated_at=now()
         WHERE checkins.origin='import'
         RETURNING revision`,
        [r.participantId, r.day, JSON.stringify({ ...emptyCounts(), ...r.after })],
      );
      if (!c) continue;
      await tx.query(
        "INSERT INTO checkin_revisions(participant,day,revision,counts,actor,source) VALUES($1,$2,$3,$4::jsonb,$5,'wins-import')",
        [r.participantId, r.day, c.revision, JSON.stringify({ ...emptyCounts(), ...r.after }), actor.userId],
      );
      await outbox(tx, r.participantId!);
      written++;
    }
    return {
      ok: true,
      written,
      cases,
      unchanged: rows.filter((r) => r.action === "unverändert").length,
      skipped: rows.filter((r) => r.action === "übersprungen").length,
    };
  });
}

// ---------------------------------------------------------------------------
// Prüffälle

export async function reviewCases(db: Database, actor: Actor) {
  requireAdmin(actor);
  return db.query(
    `SELECT id,day,name_seen,excerpt,reason,status,created_at FROM import_review_cases
      ORDER BY (status='open') DESC, created_at DESC LIMIT 200`,
  );
}

const resolveSchema = z
  .object({
    id: z.string().uuid(),
    decision: z.enum(["alias", "dismiss"]),
    participantId: z.string().max(100).optional(),
  })
  .strict();

/**
 * „alias“: Der gemeldete Name gehört zu diesem Profil. Beim nächsten Import
 * desselben Textes wird die Meldung dann normal übernommen.
 */
export async function resolveReviewCase(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = resolveSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [c] = await tx.query(
      "SELECT * FROM import_review_cases WHERE id=$1 AND status='open' FOR UPDATE",
      [v.id],
    );
    if (!c) throw new AppError("Dieser Prüffall ist schon erledigt.", 409);
    if (v.decision === "alias") {
      if (!v.participantId) throw new AppError("Bitte das passende Profil wählen.");
      const [p] = await tx.query("SELECT id,kind FROM participants WHERE id=$1", [v.participantId]);
      if (!p) throw new AppError("Dieses Profil gibt es nicht.", 404);
      if (p.kind !== "person")
        throw new AppError("Eine gemeinsame Meldung ist kein Ziel für einen Namen.", 409);
      const alias = normaliseName(c.name_seen);
      const [existing] = await tx.query("SELECT participant FROM participant_aliases WHERE alias=$1", [alias]);
      if (existing && existing.participant !== p.id)
        throw new AppError("Dieser Name ist bereits einem anderen Profil zugeordnet.", 409);
      await tx.query(
        "INSERT INTO participant_aliases(alias,participant,created_by) VALUES($1,$2,$3) ON CONFLICT(alias) DO NOTHING",
        [alias, p.id, actor.userId],
      );
    }
    await tx.query(
      "UPDATE import_review_cases SET status=$2,resolved_by=$3,resolved_at=now() WHERE id=$1",
      [v.id, v.decision === "alias" ? "resolved" : "dismissed", actor.userId],
    );
    return { ok: true };
  });
}
