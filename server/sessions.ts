import type { Database } from "./database";
import { AppError } from "./operator";
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
export async function editSession(
  db: Database,
  owner: string,
  id: string,
  value: { capacity: number; [key: string]: unknown },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.query(
      "SELECT id FROM sessions WHERE id=$1 AND owner=$2 FOR UPDATE",
      [id, owner],
    );
    if (!row)
      throw new AppError("Du kannst nur eigene Sessions bearbeiten.", 403);
    const [count] = await tx.query(
      "SELECT count(*) AS n FROM rsvps WHERE session=$1",
      [id],
    );
    if (value.capacity < Number(count.n))
      throw new AppError(
        "Die Kapazität darf nicht kleiner als die Zahl der Teilnehmenden sein.",
        409,
      );
    await tx.query("UPDATE sessions SET data=$1 WHERE id=$2 AND owner=$3", [
      JSON.stringify(value),
      id,
      owner,
    ]);
  });
}
