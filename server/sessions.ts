import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import { AppError } from "./operator";
import { sessionEnd, sessionLeadError, sessionStart } from "../lib/session-rules";
import { normaliseName } from "../lib/wins-parser";

/** Vom Team vorgemerkte Teilnehmer: Profile aus der Rangliste, auch ohne Konto. */
function guestsOf(s: { guests?: unknown }): string[] {
  return Array.isArray(s.guests) ? s.guests.filter((g): g is string => typeof g === "string") : [];
}
export async function toggleAttendance(
  db: Database,
  owner: string,
  id: string,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.query(
      "SELECT data FROM sessions WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!row) throw new AppError("Diese Session existiert nicht mehr.", 404);
    const s = JSON.parse(row.data);
    if (s.cancelled) throw new AppError("Diese Session wurde abgesagt.", 409);
    if (new Date(s.startsAt || `${s.date}T${s.time}`) < new Date())
      throw new AppError("Diese Session hat bereits begonnen.");
    const [present] = await tx.query(
      "SELECT owner FROM rsvps WHERE session=$1 AND owner=$2",
      [id, owner],
    );
    if (present) {
      await tx.query("DELETE FROM rsvps WHERE session=$1 AND owner=$2", [
        id,
        owner,
      ]);
      return { joined: false };
    }
    // War die Person vorgemerkt (ihr Profil gehört jetzt zu diesem Konto),
    // wird aus der Vormerkung eine normale Zusage; der Platz bleibt derselbe.
    const guests = guestsOf(s);
    const mine = guests.length
      ? await tx.query("SELECT id FROM participants WHERE owner=$1 AND id = ANY($2::text[])", [owner, guests])
      : [];
    const rest = guests.filter((g) => !mine.some((m) => m.id === g));
    const [count] = await tx.query(
      "SELECT count(*) AS n FROM rsvps WHERE session=$1",
      [id],
    );
    if (!mine.length && Number(count.n) + rest.length >= s.capacity)
      throw new AppError("Diese Session ist bereits voll.", 409);
    if (mine.length)
      await tx.query("UPDATE sessions SET data=$1 WHERE id=$2", [JSON.stringify({ ...s, guests: rest }), id]);
    await tx.query("INSERT INTO rsvps(session,owner) VALUES($1,$2)", [
      id,
      owner,
    ]);
    return { joined: true };
  });
}
/** Discord-Raum einer Session, eingetragen vom Abgleich (server/discord-sessions.ts). */
export type SessionRoom = {
  channelId?: string;
  eventId?: string;
  url?: string;
  eventUrl?: string;
  hash?: string;
  syncedAt?: string;
  /** Kanal nach Ende oder Absage entfernt. */
  closed?: boolean;
};

export type SessionInput = {
  title: string;
  kind: string;
  date: string;
  time: string;
  minutes: number;
  capacity: number;
  startsAt?: string;
};

type Editor = { userId: string; team: boolean };

/**
 * Neue Session. Vorlauf nach lib/session-rules.ts; einen eigenen Raum-Link gibt
 * es nicht mehr, der Raum entsteht beim Abgleich im Discord.
 */
export async function createSession(db: Database, owner: string, host: string, value: SessionInput) {
  const problem = sessionLeadError(sessionStart(value));
  if (problem) throw new AppError(problem);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO sessions(id,owner,data) VALUES($1,$2,$3)", [
      id,
      owner,
      JSON.stringify({ ...value, url: "", host, cancelled: false }),
    ]);
    await tx.query("INSERT INTO rsvps(session,owner) VALUES($1,$2)", [id, owner]);
  });
  return { id };
}

/**
 * Bearbeiten: die eigene Session oder, fürs Team (Admins, Moderatoren), jede.
 * Host, ein früher hinterlegter Raum-Link und der Discord-Raum bleiben
 * erhalten; der Abgleich zieht Änderungen im Discord nach. Wer den Termin
 * verschiebt, braucht wieder den vollen Vorlauf.
 */
export async function editSession(db: Database, editor: Editor, id: string, value: SessionInput) {
  return db.transaction(async (tx) => {
    const [row] = await tx.query("SELECT owner,data FROM sessions WHERE id=$1 FOR UPDATE", [id]);
    if (!row || (row.owner !== editor.userId && !editor.team))
      throw new AppError("Du kannst nur eigene Sessions bearbeiten.", 403);
    const old = JSON.parse(row.data);
    if (old.cancelled) throw new AppError("Diese Session wurde abgesagt.", 409);
    if (sessionStart(old) <= new Date())
      throw new AppError("Diese Session hat bereits begonnen.", 409);
    if (sessionStart(value).getTime() !== sessionStart(old).getTime()) {
      const problem = sessionLeadError(sessionStart(value));
      if (problem) throw new AppError(problem);
    }
    const [count] = await tx.query("SELECT count(*) AS n FROM rsvps WHERE session=$1", [id]);
    if (value.capacity < Number(count.n) + guestsOf(old).length)
      throw new AppError(
        "Die Kapazität darf nicht kleiner als die Zahl der Teilnehmenden sein.",
        409,
      );
    await tx.query("UPDATE sessions SET data=$1 WHERE id=$2", [
      JSON.stringify({
        ...old,
        ...value,
        startsAt: value.startsAt,
        host: old.host,
        url: old.url ?? "",
        cancelled: false,
      }),
      id,
    ]);
  });
}

/** Absagen: die eigene Session oder, fürs Team, jede. Der Abgleich räumt den Discord-Raum ab. */
export async function cancelSession(db: Database, editor: Editor, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.query("SELECT owner,data FROM sessions WHERE id=$1 FOR UPDATE", [id]);
    if (!row || (row.owner !== editor.userId && !editor.team))
      throw new AppError("Du kannst nur eigene Sessions absagen.", 403);
    await tx.query("UPDATE sessions SET data=$1 WHERE id=$2", [
      JSON.stringify({ ...JSON.parse(row.data), cancelled: true }),
      id,
    ]);
  });
}

type TeamEditor = { userId: string; team: boolean };

async function lockOpenSession(tx: Database, id: string) {
  const [row] = await tx.query("SELECT owner,data FROM sessions WHERE id=$1 FOR UPDATE", [id]);
  if (!row) throw new AppError("Diese Session existiert nicht mehr.", 404);
  const data = JSON.parse(row.data);
  if (data.cancelled) throw new AppError("Diese Session wurde abgesagt.", 409);
  if (sessionEnd(data) <= new Date()) throw new AppError("Diese Session ist schon vorbei.", 409);
  return { owner: row.owner as string, data };
}

/** ASCII-Kürzel für Importschlüssel: „Linus Zornig“ → „linus-zornig“. */
export function nameSlug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "person"
  );
}

/**
 * Das Team merkt eine Person für eine Session vor: ein vorhandenes Profil aus
 * der Rangliste (auch ohne Konto) oder, wenn es noch keins gibt, ein neues
 * Profil mit diesem Namen. Wer sich später anmeldet und zusagt, belegt
 * denselben Platz.
 */
export async function addSessionGuest(
  db: Database,
  editor: TeamEditor,
  id: string,
  pick: { participant?: string; name?: string },
) {
  if (!editor.team) throw new AppError("Teilnehmer vormerken kann nur das Team.", 403);
  return db.transaction(async (tx) => {
    const { data } = await lockOpenSession(tx, id);
    type Person = { id: string; name: string; owner: string | null };
    let participant: Person | undefined;
    let created = false;
    if (pick.participant) {
      participant = (await tx.query(
        "SELECT id,name,owner FROM participants WHERE id=$1 AND kind='person'",
        [pick.participant],
      ))[0] as Person | undefined;
      if (!participant) throw new AppError("Dieses Profil gibt es nicht.", 404);
    } else {
      const name = (pick.name ?? "").replace(/\s+/g, " ").trim();
      if (name.length < 2) throw new AppError("Bitte einen Namen angeben.");
      const key = normaliseName(name);
      const same = (await tx.query("SELECT id,name,owner FROM participants WHERE kind='person'")).filter(
        (p) => normaliseName(p.name) === key,
      );
      if (same.length > 1)
        throw new AppError(`„${name}“ gibt es mehrfach. Bitte das passende Profil auswählen.`, 409);
      participant = same[0] as Person | undefined;
      if (!participant) {
        const base = `session-${nameSlug(name)}`;
        let importKey = base;
        for (let n = 2; (await tx.query("SELECT 1 FROM participants WHERE import_key=$1", [importKey])).length; n++)
          importKey = `${base}-${n}`;
        participant = (await tx.query(
          `INSERT INTO participants(id,import_key,name,company,role,public_consent,searchable,kind)
           VALUES($1,$2,$3,'','',true,true,'person') RETURNING id,name,owner`,
          [randomUUID(), importKey, name],
        ))[0] as Person;
        created = true;
      }
    }
    const guests = guestsOf(data);
    if (guests.includes(participant!.id)) throw new AppError(`${participant!.name} ist schon vorgemerkt.`, 409);
    if (participant!.owner) {
      const [joined] = await tx.query("SELECT 1 FROM rsvps WHERE session=$1 AND owner=$2", [id, participant!.owner]);
      if (joined) throw new AppError(`${participant!.name} ist schon dabei.`, 409);
    }
    const [count] = await tx.query("SELECT count(*) AS n FROM rsvps WHERE session=$1", [id]);
    if (Number(count.n) + guests.length >= data.capacity)
      throw new AppError("Alle Plätze sind belegt. Erhöhe zuerst die Plätze.", 409);
    await tx.query("UPDATE sessions SET data=$1 WHERE id=$2", [
      JSON.stringify({ ...data, guests: [...guests, participant!.id] }),
      id,
    ]);
    return { participant: participant!.id, name: participant!.name, created };
  });
}

export async function removeSessionGuest(db: Database, editor: TeamEditor, id: string, participant: string) {
  if (!editor.team) throw new AppError("Vormerkungen ändert nur das Team.", 403);
  return db.transaction(async (tx) => {
    const { data } = await lockOpenSession(tx, id);
    const guests = guestsOf(data);
    if (!guests.includes(participant)) return { removed: false };
    await tx.query("UPDATE sessions SET data=$1 WHERE id=$2", [
      JSON.stringify({ ...data, guests: guests.filter((g) => g !== participant) }),
      id,
    ]);
    return { removed: true };
  });
}

/** Nur Einladungs- oder Kanallinks in den Discord, sonst nichts. */
export function discordRoomLink(value: string) {
  const text = value.trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new AppError("Bitte einen Discord-Link einfügen, zum Beispiel https://discord.gg/…");
  }
  const host = url.hostname.toLowerCase();
  const ok =
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (host === "discord.gg" || host === "discord.com" || host.endsWith(".discord.com"));
  if (!ok) throw new AppError("Bitte einen Link zu discord.gg oder discord.com einfügen.");
  return url.toString();
}

/**
 * Raum-Link von Hand, solange der Abgleich keinen Discord-Raum anlegt: vom
 * Host oder vom Team. Ein vom Abgleich angelegter Raum hat Vorrang.
 */
export async function setSessionRoom(db: Database, editor: TeamEditor, id: string, link: string) {
  const roomUrl = discordRoomLink(link);
  return db.transaction(async (tx) => {
    const { owner, data } = await lockOpenSession(tx, id);
    if (owner !== editor.userId && !editor.team)
      throw new AppError("Den Raum-Link ändert der Host oder das Team.", 403);
    await tx.query("UPDATE sessions SET data=$1 WHERE id=$2", [JSON.stringify({ ...data, roomUrl }), id]);
    return { roomUrl };
  });
}

export type PublicSession = {
  title: string;
  kind: string;
  date: string;
  time: string;
  startsAt: string;
  minutes: number;
  capacity: number;
  attendees: number;
  host: string;
};

/**
 * Kommende Sessions für alle, auch ohne Anmeldung: Titel, Art, Termin,
 * belegte Plätze und der Host. Teilnehmernamen gibt es nur angemeldet.
 */
export async function upcomingSessions(db: Database, now = new Date(), limit = 3): Promise<PublicSession[]> {
  const [rows, rsvps] = await Promise.all([
    db.query("SELECT id,data FROM sessions"),
    db.query("SELECT session,count(*)::int AS n FROM rsvps GROUP BY session"),
  ]);
  return rows
    .map((r) => ({ id: r.id as string, s: JSON.parse(r.data) }))
    .filter(({ s }) => !s.cancelled && sessionEnd(s) > now)
    .sort((a, b) => sessionStart(a.s).getTime() - sessionStart(b.s).getTime())
    .slice(0, limit)
    .map(({ id, s }) => ({
      title: String(s.title),
      kind: String(s.kind),
      date: String(s.date),
      time: String(s.time),
      startsAt: sessionStart(s).toISOString(),
      minutes: Number(s.minutes),
      capacity: Number(s.capacity),
      attendees: Number(rsvps.find((x) => x.session === id)?.n ?? 0) + guestsOf(s).length,
      host: String(s.host ?? ""),
    }));
}
