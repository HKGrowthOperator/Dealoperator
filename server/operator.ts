import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import { isTeam, type Actor } from "./auth";
import { teamEvent } from "./notify";
import { normalisePhone } from "../lib/phone";
import {
  aggregate,
  countsSchema,
  importRowSchema,
  isJoint,
  participantKind,
  progress,
  type ImportRow,
  type RankingRow,
} from "../lib/kpis";
/**
 * Wache für alle Wege, die aus einem Datensatz ein persönliches Konto machen.
 *
 * Fehlt die Spalte in der Abfrage, ist das ein Programmfehler und kein Grund,
 * die Prüfung stillschweigend zu bestehen: dann bricht der Aufruf ab, statt
 * eine gemeinsame Meldung durchzulassen.
 */
export function refusePersonalUse(
  row: { kind?: unknown },
  message: string,
): void {
  if (row.kind === undefined)
    throw new AppError(
      "Die Art des Profils konnte nicht geprüft werden. Bitte später erneut versuchen.",
      500,
    );
  if (isJoint(row)) throw new AppError(message, 409);
}
export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** Kanonische JSON-Form für Vergleiche und Fingerabdrücke. */
export const canonicalJson = (value: unknown) => canonical(value);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
async function rememberVerifiedEmail(tx: Database, actor: Actor) {
  await tx.query(
    "INSERT INTO account_private(owner,email) VALUES($1,$2) ON CONFLICT(owner) DO UPDATE SET email=excluded.email,updated_at=now()",
    [actor.userId, actor.email],
  );
}
/**
 * Solange eine Übernahmeanfrage läuft, darf kein zweites Profil mit leeren
 * Zahlen entstehen. Sonst hätte die Person nach der Freigabe zwei Historien.
 */
async function refuseDuringOpenClaim(tx: Database, actor: Actor) {
  const [open] = await tx.query(
    `SELECT id FROM onboarding_requests
     WHERE owner=$1 AND kind='claim' AND status IN ('pending','info_needed') LIMIT 1`,
    [actor.userId],
  );
  if (open)
    throw new AppError(
      "Deine Profilübernahme wird gerade geprüft. Bis zur Entscheidung legen wir kein zweites Profil an.",
      409,
    );
}
export async function outbox(tx: Database, participant: string) {
  await tx.query(
    "INSERT INTO sync_outbox(participant) VALUES($1) ON CONFLICT(participant) DO UPDATE SET revision=sync_outbox.revision+1,state='pending',attempts=0,next_attempt_at=now(),updated_at=now()",
    [participant],
  );
}
export async function once<T>(
  db: Database,
  actor: string,
  key: string,
  input: unknown,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `request:${actor}:${key}`,
    ]);
    const fingerprint = hash(canonical(input));
    const [previous] = await tx.query(
      "SELECT hash,result FROM requests WHERE actor=$1 AND key=$2",
      [actor, key],
    );
    if (previous) {
      if (previous.hash !== fingerprint)
        throw new AppError(
          "Dieser Speichervorgang wurde mit anderen Werten bereits verwendet.",
          409,
        );
      return previous.result as T;
    }
    const result = await fn(tx);
    await tx.query(
      "INSERT INTO requests(actor,key,hash,result) VALUES($1,$2,$3,$4::jsonb)",
      [actor, key, fingerprint, JSON.stringify(result)],
    );
    return result;
  });
}
export async function publicRanking(db: Database, from: string, to: string) {
  const rows = await db.query(
    `SELECT p.id,p.import_key,p.name,p.company,p.role,p.kind,p.owner IS NOT NULL AS claimed,c.counts,c.origin,c.updated_at FROM participants p JOIN checkins c ON c.participant=p.id WHERE p.public_consent=true AND c.day >= $1 AND c.day <= $2 ORDER BY c.updated_at DESC`,
    [from, to],
  );
  const grouped = new Map<string, RankingRow>();
  for (const r of rows) {
    // Entscheidergespräche werden nicht mehr erfasst und nie öffentlich
    // ausgegeben, auch nicht aus alten Datensätzen.
    r.counts = { ...r.counts, decisionMakerConversations: null };
    const current = grouped.get(r.id);
    if (current) {
      current.counts = aggregate([current.counts, r.counts]);
      if (r.origin === "closing") current.source = "Tagesabschluss";
    } else
      grouped.set(r.id, {
        id: r.id,
        key: r.import_key || "",
        name: r.name,
        company: r.company,
        role: r.role,
        kind: participantKind(r.kind),
        claimed: r.claimed,
        counts: countsSchema.parse(r.counts),
        source: r.origin === "closing" ? "Tagesabschluss" : "Übernommene Meldung",
        updatedAt: new Date(r.updated_at).toISOString(),
      });
  }
  return [...grouped.values()];
}
export async function ownState(db: Database, actor: Actor) {
  const [participant] = await db.query(
    "SELECT id,name,company,role,public_consent FROM participants WHERE owner=$1",
    [actor.userId],
  );
  const records = participant
    ? await db.query(
        "SELECT day,counts,reflection,revision,source,updated_at FROM checkins WHERE participant=$1 ORDER BY day DESC",
        [participant.id],
      )
    : [];
  const [contact] = await db.query(
    "SELECT phone,contact_opt_in FROM account_private WHERE owner=$1",
    [actor.userId],
  );
  // Eine zur E-Mail passende Importzeile ist ausdrücklich KEIN Anspruch mehr.
  // Die Zuordnung entsteht nur über eine Anfrage und die Freigabe durch das Team.
  const [request] = await db.query(
    `SELECT r.id,r.kind,r.status,r.applicant_message,r.created_at,r.decided_at,p.name AS participant_name
     FROM onboarding_requests r LEFT JOIN participants p ON p.id=r.participant
     WHERE r.owner=$1
     ORDER BY (r.status IN ('pending','info_needed')) DESC, r.updated_at DESC LIMIT 1`,
    [actor.userId],
  );
  return {
    participant: participant || null,
    records,
    progress: progress(aggregate(records.map((r) => r.counts))),
    request: request || null,
    contact: contact || { phone: "", contact_opt_in: false },
    email: actor.email,
    admin: actor.admin,
    team: isTeam(actor),
    syncStatus: "Discord-Anbindung wird vorbereitet",
  };
}
// Eigene Tageszahlen entstehen ausschließlich über den vollständigen
// Tagesabschluss in server/closing.ts (Zahlen plus Reflexion). Den früheren
// direkten Check-in ohne Reflexion gibt es nicht mehr.
export async function createMember(db: Database, actor: Actor, raw: unknown) {
  const value = z
    .object({
      name: z.string().trim().min(2).max(60),
      company: z.string().trim().max(120),
      role: z.string().trim().max(80),
      publicConsent: z.boolean(),
    })
    .strict()
    .parse(raw);
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `owner:${actor.userId}`,
    ]);
    const [existing] = await tx.query(
      "SELECT id FROM participants WHERE owner=$1",
      [actor.userId],
    );
    if (existing) return { ok: true, id: existing.id };
    await refuseDuringOpenClaim(tx, actor);
    const id = randomUUID();
    await tx.query(
      "INSERT INTO participants(id,name,company,role,email,owner,public_consent,claimed_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())",
      [
        id,
        value.name,
        value.company,
        value.role,
        actor.email,
        actor.userId,
        value.publicConsent,
      ],
    );
    const [old] = await tx.query("SELECT data FROM profiles WHERE id=$1", [
      actor.userId,
    ]);
    const profile = {
      niche: "Noch offen",
      time: "Flexibel",
      bio: "",
      goal: 100,
      days: [1, 2, 3, 4, 5],
      listed: false,
      channel: "Discord",
      ...(old ? JSON.parse(old.data) : {}),
      name: value.name,
      role: value.role,
    };
    await tx.query(
      "INSERT INTO profiles(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      [actor.userId, JSON.stringify(profile)],
    );
    await rememberVerifiedEmail(tx, actor);
    // Wer über „Anmelden“ ohne Registrierungsanfrage kam, taucht sonst nie im
    // Team auf. Mit Anfrage ist die Meldung bereits bei der E-Mail-Bestätigung
    // entstanden — dann hier nichts Doppeltes.
    const [request] = await tx.query(
      "SELECT id FROM onboarding_requests WHERE owner=$1 LIMIT 1",
      [actor.userId],
    );
    if (!request)
      await teamEvent(tx, {
        dedupeKey: `member:${actor.userId}`,
        kind: "registration",
        ref: id,
        state: "confirmed",
        title: `Neues Profil angelegt: ${value.name}`,
        body: "Ohne Registrierungsanfrage über „Anmelden“ gekommen. E-Mail bestätigt; Telefonnummer fehlt noch.",
        alert: { key: `signup:${actor.userId}`, kind: "new" },
      });
    return { ok: true, id };
  });
}
/**
 * Ein Import überschreibt nie einen eigenen Tagesabschluss. Für ein
 * übernommenes Profil zählen ab dem Übernahmetag nur noch die eigenen
 * Abschlüsse mit Reflexion; ein Import dafür wird nicht geschrieben.
 */
export function importBlocked(
  p: { owner?: string | null; claimed_at?: string | Date | null } | undefined,
  c: { origin?: string } | undefined,
  day: string,
) {
  if (c?.origin === "closing")
    return "Übersprungen: eigener Tagesabschluss liegt vor";
  if (p?.owner && p.claimed_at) {
    const claimed = new Date(p.claimed_at).toLocaleDateString("sv-SE", {
      timeZone: "Europe/Berlin",
    });
    if (day >= claimed)
      return "Übersprungen: Profil übernommen, ab dann zählt nur der eigene Tagesabschluss";
  }
  return null;
}
export async function previewImport(db: Database, rows: ImportRow[]) {
  const result = [];
  for (const r of rows) {
    const [p] = await db.query(
      "SELECT id,owner,claimed_at FROM participants WHERE import_key=$1",
      [r.participantKey],
    );
    const [c] = p
      ? await db.query(
          "SELECT revision,counts,origin FROM checkins WHERE participant=$1 AND day=$2",
          [p.id, r.date],
        )
      : [];
    const blocked = importBlocked(p, c, r.date);
    result.push({
      key: `${r.participantKey}:${r.date}`,
      revision: c?.revision || 0,
      participantId: p?.id || null,
      change: blocked
        ? blocked
        : !p
          ? "Neues Profil"
          : !c
            ? "Neuer Tagesstand"
            : "Tagesstand ersetzen",
      blocked: !!blocked,
      claimed: !!p?.owner,
      previous: c?.counts || null,
    });
  }
  return result;
}
export async function commitImport(db: Database, actor: Actor, raw: unknown) {
  if (!actor.admin)
    throw new AppError(
      "Dieser Bereich ist nur für die Verwaltung freigeschaltet.",
      403,
    );
  const v = z
    .object({
      rows: z.array(importRowSchema).min(1).max(500),
      key: z.string().uuid(),
      expected: z.array(
        z.object({
          key: z.string(),
          revision: z.number().int(),
          participantId: z.string().nullable(),
        }),
      ),
    })
    .parse(raw);
  if (
    new Set(v.rows.map((r) => `${r.participantKey}:${r.date}`)).size !==
    v.rows.length
  )
    throw new AppError("Doppelte Tagesmeldung im Import.");
  return once(db, actor.userId, v.key, v, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('operator-import'))");
    const current = await previewImport(tx, v.rows);
    for (const c of current) {
      const e = v.expected.find((x) => x.key === c.key);
      if (
        !e ||
        e.revision !== c.revision ||
        e.participantId !== c.participantId
      )
        throw new AppError(
          "Der Datenstand hat sich geändert. Bitte die Import-Vorschau neu laden.",
          409,
        );
    }
    let skipped = 0;
    for (const r of v.rows) {
      if (current.find((c) => c.key === `${r.participantKey}:${r.date}`)?.blocked) {
        skipped++;
        continue;
      }
      let [p] = await tx.query(
        "SELECT id,owner FROM participants WHERE import_key=$1 FOR UPDATE",
        [r.participantKey],
      );
      if (!p) {
        [p] = await tx.query(
          "INSERT INTO participants(id,import_key,name,company,role,email,public_consent,kind,searchable) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,owner",
          [
            randomUUID(),
            r.participantKey,
            r.name,
            r.company,
            r.role,
            r.email.toLowerCase() || null,
            r.publicConsent,
            r.kind,
            r.kind === "person",
          ],
        );
      } else if (!p.owner)
        await tx.query(
          "UPDATE participants SET name=$2,company=$3,role=$4,email=$5,public_consent=$6,kind=$7,searchable=(searchable AND $8) WHERE id=$1",
          [
            p.id,
            r.name,
            r.company,
            r.role,
            r.email.toLowerCase() || null,
            r.publicConsent,
            r.kind,
            r.kind === "person",
          ],
        );
      const expected = v.expected.find(
        (e) => e.key === `${r.participantKey}:${r.date}`,
      )!;
      const [prior] = await tx.query(
        "SELECT revision FROM checkins WHERE participant=$1 AND day=$2",
        [p.id, r.date],
      );
      if ((prior?.revision || 0) !== expected.revision)
        throw new AppError(
          "Zwischenzeitliche Änderung. Bitte Import neu prüfen.",
          409,
        );
      // Zweite Sicherung auf Datenbankebene: ein eigener Abschluss wird nie
      // durch einen Import ersetzt.
      const [c] = await tx.query(
        "INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,$2,$3::jsonb,$4,'import') ON CONFLICT(participant,day) DO UPDATE SET counts=excluded.counts,revision=checkins.revision+1,source=excluded.source,updated_at=now() WHERE checkins.origin='import' RETURNING revision",
        [p.id, r.date, JSON.stringify(r.counts), "owner-import"],
      );
      if (!c) {
        skipped++;
        continue;
      }
      await tx.query(
        "INSERT INTO checkin_revisions(participant,day,revision,counts,actor,source) VALUES($1,$2,$3,$4::jsonb,$5,$6)",
        [
          p.id,
          r.date,
          c.revision,
          JSON.stringify(r.counts),
          actor.userId,
          "owner-import",
        ],
      );
      await outbox(tx, p.id);
    }
    return { ok: true, count: v.rows.length - skipped, skipped };
  });
}
/**
 * Persönliche Einladung für ein Profil, das nicht öffentlich auffindbar ist.
 * Der Code macht das Profil in der Auswahl sichtbar — er überträgt kein
 * Eigentum und überspringt die Teamfreigabe nicht.
 */
export async function issueClaim(db: Database, actor: Actor, id: string) {
  // Einladungscodes entstehen im CSV-Reiter, der nur Admins offensteht.
  if (!actor.admin)
    throw new AppError("Einladungen erstellt nur ein Admin.", 403);
  return db.transaction(async (tx) => {
    const [p] = await tx.query(
      "SELECT id,kind FROM participants WHERE id=$1 AND owner IS NULL FOR UPDATE",
      [id],
    );
    if (!p)
      throw new AppError(
        "Dieses Profil ist nicht mehr zur Übernahme verfügbar.",
        409,
      );
    // Eine Einladung darf die Sperre für gemeinsame Meldungen nicht umgehen.
    refusePersonalUse(
      p,
      "Für eine gemeinsam gemeldete Leistung gibt es keine persönliche Einladung. Sie gehört mehreren Personen.",
    );
    const token = randomBytes(32).toString("base64url");
    await tx.query("DELETE FROM claim_tokens WHERE participant=$1", [id]);
    await tx.query(
      "INSERT INTO claim_tokens(hash,participant,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [hash(token), id],
    );
    return { token, expiresInDays: 7 };
  });
}
// Die frühere direkte Übernahme über passende E-Mail oder Einmalcode ist
// entfallen. Ein vorbereitetes Profil wird ausschließlich über eine Anfrage in
// server/onboarding.ts und die anschließende Freigabe durch das
// Deal-Operator-Team mit einem Konto verbunden.
export async function updateAccount(db: Database, actor: Actor, raw: unknown) {
  const v = z
    .object({
      name: z.string().trim().min(2).max(60),
      company: z.string().trim().max(120),
      role: z.string().trim().max(80),
      publicConsent: z.boolean(),
      phone: z.string().trim().max(40),
      contactOptIn: z.boolean(),
    })
    .parse(raw);
  // Leer lassen ist erlaubt; eine angegebene Nummer muss gültig sein. Sie wird
  // nicht per SMS geprüft, sondern nur einheitlich gespeichert.
  let phone = "";
  if (v.phone) {
    const checked = normalisePhone(v.phone);
    if (!checked.ok) throw new AppError(checked.reason);
    phone = checked.value;
  }
  return db.transaction(async (tx) => {
    const [p] = await tx.query(
      "UPDATE participants SET name=$2,company=$3,role=$4,public_consent=$5 WHERE owner=$1 RETURNING id",
      [actor.userId, v.name, v.company, v.role, v.publicConsent],
    );
    if (!p)
      throw new AppError(
        "Übernimm zuerst dein Profil oder speichere deinen ersten Check-in.",
      );
    await tx.query(
      "UPDATE profiles SET data=(data::jsonb || jsonb_build_object('name',$2::text,'role',$3::text))::text WHERE id=$1",
      [actor.userId, v.name, v.role],
    );
    await tx.query(
      "INSERT INTO account_private(owner,phone,contact_opt_in) VALUES($1,$2,$3) ON CONFLICT(owner) DO UPDATE SET phone=excluded.phone,contact_opt_in=excluded.contact_opt_in,updated_at=now()",
      [actor.userId, phone, v.contactOptIn],
    );
    await rememberVerifiedEmail(tx, actor);
    // Name oder Zustimmung zur öffentlichen Anzeige geändert: vorhandene
    // Discord-Beiträge ziehen nach (Zahlen nur mit Zustimmung).
    await outbox(tx, p.id);
    return { ok: true };
  });
}
export async function rateLimit(
  db: Database,
  key: string,
  max: number,
  windowSeconds = 60,
  message = "Zu viele Versuche in kurzer Zeit. Bitte warte etwa 15 Minuten und probiere es dann erneut. Deine Angaben bleiben gespeichert.",
) {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const [r] = await db.query(
    "INSERT INTO rate_limits(key,bucket,hits) VALUES($1,$2,1) ON CONFLICT(key,bucket) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits",
    [hash(key), bucket],
  );
  if (r.hits > max) throw new AppError(message, 429);
}

/**
 * Ein vorbereitetes Profil aus der öffentlichen Suche nehmen oder wieder
 * aufnehmen. Ein nicht auffindbares Profil bleibt über eine persönliche
 * Einladung erreichbar.
 */
export async function setSearchable(db: Database, actor: Actor, raw: unknown) {
  if (!actor.admin)
    throw new AppError("Nur die Verwaltung kann die Auffindbarkeit ändern.", 403);
  const v = z
    .object({ id: z.string().trim().min(1).max(100), searchable: z.boolean() })
    .strict()
    .parse(raw);
  const [p] = await db.query(
    "UPDATE participants SET searchable=$2 WHERE id=$1 RETURNING id,searchable",
    [v.id, v.searchable],
  );
  if (!p) throw new AppError("Dieses Profil gibt es nicht.", 404);
  return { ok: true, searchable: p.searchable };
}

export async function adminContacts(db: Database, actor: Actor) {
  if (!actor.admin) throw new AppError("Nur für die Verwaltung.", 403);
  return db.query(
    "SELECT p.id,p.name,p.company,p.role,p.kind,p.email AS imported_email,a.email AS verified_email,a.phone,a.contact_opt_in,p.searchable,p.owner IS NOT NULL AS registered FROM participants p LEFT JOIN account_private a ON a.owner=p.owner ORDER BY p.name",
  );
}
