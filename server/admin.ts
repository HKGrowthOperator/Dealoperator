import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import { isTeam, type Actor } from "./auth";
import { AppError } from "./operator";
import { calendarDaySchema } from "../lib/kpis";
import { saveCommitmentSettings, loadCommitmentSettings } from "./settings";
import { DELIVERY_LABEL, deliveryStates, type DeliveryState } from "./notify";

/**
 * Verwaltung: Team-Inbox, Pausen, Akquise Days und die Dranbleiben-Regeln.
 * Jede Funktion prüft selbst, dass ein Verwaltungskonto handelt — die Route
 * allein reicht nicht.
 */

function requireAdmin(actor: Actor) {
  if (!actor.admin)
    throw new AppError("Das kann nur ein Admin ändern.", 403);
}
/** Admins und Moderatoren. */
function requireTeam(actor: Actor) {
  if (!isTeam(actor))
    throw new AppError("Dieser Bereich ist nur für das Team freigeschaltet.", 403);
}

// ---------------------------------------------------------------------------
// Team-Inbox

export async function teamInbox(db: Database, actor: Actor) {
  requireTeam(actor);
  const rows = await db.query(
    `SELECT id,dedupe_key,kind,ref,state,title,body,created_at,updated_at,resolved_at FROM team_inbox
      ORDER BY (resolved_at IS NULL) DESC, updated_at DESC LIMIT 100`,
  );
  // Zustellstand der Team-Hinweise je Eintrag. Neue Hinweise verweisen auf den
  // Inbox-Schlüssel, ältere noch auf die Anfrage bzw. das Konto.
  const keys = rows.map((r) => r.dedupe_key as string);
  const refs = rows.filter((r) => !String(r.dedupe_key).startsWith("answer:")).map((r) => r.ref as string);
  const sent = keys.length
    ? await deliveryStates(
        db,
        (await db.query(
          `SELECT ref,channel,status,detail,attempts,recipient FROM notifications
            WHERE kind LIKE 'team:%' AND (ref = ANY($1::text[]) OR ref = ANY($2::text[]))`,
          [keys, refs],
        )) as { ref: string; channel: string; status: string; detail: string; attempts: number; recipient: string }[],
      )
    : [];
  const deliveryFor = (key: string, ref: string, legacy: boolean) => {
    const own = sent.filter((n) => n.ref === key || (legacy && n.ref === ref));
    const groups = new Map<string, { channel: string; state: DeliveryState; label: string; count: number }>();
    for (const n of own) {
      const id = `${n.channel}:${n.state}`;
      const g = groups.get(id) ?? { channel: n.channel, state: n.state, label: DELIVERY_LABEL[n.state], count: 0 };
      g.count++;
      groups.set(id, g);
    }
    return [...groups.values()];
  };
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind as string,
    ref: r.ref as string,
    state: r.state as string,
    title: r.title as string,
    body: r.body as string,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    resolved: !!r.resolved_at,
    delivery: deliveryFor(
      r.dedupe_key as string,
      r.ref as string,
      !String(r.dedupe_key).startsWith("answer:"),
    ),
  }));
}

/**
 * Registrierungen mit noch nicht bestätigter E-Mail — nur gesammelt, ohne
 * Push und ohne eigene Inbox-Einträge (die Adresse kann vertippt oder fremd
 * sein). Namen nur im geschützten Verwaltungsbereich.
 */
export async function unconfirmedRegistrations(db: Database, actor: Actor) {
  requireTeam(actor);
  const rows = await db.query(
    `SELECT id,kind,full_name,created_at,updated_at FROM onboarding_requests
      WHERE status='awaiting_email' AND updated_at > now() - interval '14 days'
      ORDER BY updated_at DESC LIMIT 50`,
  );
  const [{ n }] = await db.query(
    "SELECT count(*)::int AS n FROM onboarding_requests WHERE status='awaiting_email' AND updated_at > now() - interval '14 days'",
  );
  return {
    count: n as number,
    recent: rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as "new" | "claim",
      name: r.full_name as string,
      since: new Date(r.updated_at).toISOString(),
    })),
  };
}

export async function resolveInbox(db: Database, actor: Actor, raw: unknown) {
  requireTeam(actor);
  const v = z.object({ id: z.number().int().positive(), reopen: z.boolean().default(false) }).strict().parse(raw);
  await db.query(
    v.reopen
      ? "UPDATE team_inbox SET resolved_at=NULL,resolved_by=NULL WHERE id=$1"
      : "UPDATE team_inbox SET resolved_at=now(),resolved_by=$2 WHERE id=$1 AND resolved_at IS NULL",
    v.reopen ? [v.id] : [v.id, actor.userId],
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pausen

export async function pauseList(db: Database, actor: Actor) {
  requireTeam(actor);
  const rows = await db.query(
    `SELECT pa.id,pa.from_day,pa.to_day,pa.reason,pa.status,pa.created_at,p.name
       FROM pauses pa JOIN participants p ON p.id=pa.participant
      ORDER BY (pa.status='requested') DESC, pa.from_day DESC LIMIT 200`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    from: r.from_day as string,
    to: r.to_day as string,
    reason: r.reason as string,
    status: r.status as string,
  }));
}

const decideSchema = z
  .object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]) })
  .strict();

export async function decidePause(db: Database, actor: Actor, raw: unknown) {
  requireTeam(actor);
  const v = decideSchema.parse(raw);
  const rows = await db.query(
    `UPDATE pauses SET status=$2,decided_by=$3,decided_at=now() WHERE id=$1 AND status='requested' RETURNING id`,
    [v.id, v.decision, actor.userId],
  );
  if (!rows.length) throw new AppError("Über diesen Antrag wurde schon entschieden.", 409);
  await db.query(
    "UPDATE team_inbox SET state=$2,resolved_at=now(),resolved_by=$3 WHERE dedupe_key=$1",
    [`pause:${v.id}`, v.decision, actor.userId],
  );
  return { ok: true };
}

/** Das Team kann eine Pause auch direkt eintragen (z. B. Urlaub, Krankheit). */
export async function addPause(db: Database, actor: Actor, raw: unknown) {
  requireTeam(actor);
  const v = z
    .object({
      participantId: z.string().min(1).max(100),
      from: calendarDaySchema,
      to: calendarDaySchema,
      reason: z.string().trim().max(300).default(""),
    })
    .strict()
    .refine((x) => x.from <= x.to, "Das Ende der Pause liegt vor dem Beginn.")
    .parse(raw);
  const [p] = await db.query("SELECT id FROM participants WHERE id=$1 AND kind='person'", [v.participantId]);
  if (!p) throw new AppError("Dieses Profil gibt es nicht.", 404);
  const id = randomUUID();
  await db.query(
    `INSERT INTO pauses(id,participant,from_day,to_day,reason,status,requested_by,decided_by,decided_at)
     VALUES($1,$2,$3,$4,$5,'approved',$6,$6,now())`,
    [id, v.participantId, v.from, v.to, v.reason, actor.userId],
  );
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Akquise Days und andere Tages-Events

/** Dauerhaft: der erste Akquise Day. Er lässt sich umbenennen, nicht löschen. */
export const PERMANENT_EVENT_DAYS = ["2026-09-22"];

export type EventDay = {
  day: string;
  title: string;
  partner: string;
  url: string;
  thanks: string;
};

export async function listEvents(db: Database): Promise<EventDay[]> {
  const rows = await db.query("SELECT day,title,partner,url,thanks FROM events ORDER BY day DESC");
  return rows.map((r) => ({
    day: r.day,
    title: r.title,
    partner: r.partner,
    url: r.url,
    thanks: r.thanks,
  }));
}

const eventSchema = z
  .object({
    day: calendarDaySchema,
    title: z.string().trim().min(3).max(80),
    partner: z.string().trim().max(80).default(""),
    url: z
      .string()
      .trim()
      .max(300)
      .refine((u) => u === "" || /^https:\/\/[^\s]+$/.test(u), "Bitte eine https-Adresse angeben.")
      .default(""),
    thanks: z.string().trim().max(400).default(""),
  })
  .strict();

export async function saveEvent(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = eventSchema.parse(raw);
  await db.query(
    `INSERT INTO events(day,title,partner,url,thanks,created_by) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(day) DO UPDATE SET title=excluded.title,partner=excluded.partner,url=excluded.url,thanks=excluded.thanks`,
    [v.day, v.title, v.partner, v.url, v.thanks, actor.userId],
  );
  return { ok: true };
}

export async function deleteEvent(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const day = calendarDaySchema.parse((raw as { day?: unknown })?.day);
  if (PERMANENT_EVENT_DAYS.includes(day))
    throw new AppError("Der Akquise Day vom 22.09.2026 bleibt dauerhaft gekennzeichnet.", 409);
  await db.query("DELETE FROM events WHERE day=$1", [day]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dranbleiben-Regeln

export async function commitmentRules(db: Database, actor: Actor) {
  requireTeam(actor);
  return loadCommitmentSettings(db);
}

export async function saveCommitmentRules(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  return saveCommitmentSettings(db, actor.userId, raw);
}
