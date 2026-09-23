import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import { AppError } from "./operator";
import { sessionLeadError, sessionStart } from "../lib/session-rules";
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
    const [count] = await tx.query(
      "SELECT count(*) AS n FROM rsvps WHERE session=$1",
      [id],
    );
    if (Number(count.n) >= s.capacity)
      throw new AppError("Diese Session ist bereits voll.", 409);
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
    if (value.capacity < Number(count.n))
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
