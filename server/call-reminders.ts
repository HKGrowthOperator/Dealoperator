import type { Database } from "./database";
import { sessionStart } from "../lib/session-rules";
import { enqueue, type Recheck } from "./notify";

/** Ein Hinweis pro zugesagtem Termin und Startzeit, 15 Minuten vor Beginn. */
export async function planCallReminders(db: Database, now = new Date()) {
  const rows = await db.query(
    `SELECT s.id,s.data,r.owner FROM sessions s JOIN rsvps r ON r.session=s.id
     LEFT JOIN notification_prefs p ON p.owner=r.owner
     WHERE COALESCE(p.reminders,true)
       AND EXISTS (SELECT 1 FROM push_subscriptions d WHERE d.owner=r.owner AND d.disabled_at IS NULL)`,
  );
  let planned = 0;
  for (const row of rows) {
    const call = JSON.parse(row.data);
    const start = sessionStart(call);
    const left = start.getTime() - now.getTime();
    if (call.cancelled || !Number.isFinite(left) || left <= 0 || left > 15 * 60_000) continue;
    const stamp = start.toISOString();
    if (await enqueue(db, {
      dedupeKey: `call:${row.id}:${stamp}:${row.owner}`,
      recipient: row.owner, channel: "push", kind: "call:reminder",
      ref: JSON.stringify({ id: row.id, start: stamp }),
      title: "Dein Call beginnt gleich",
      body: `${call.title} · ${new Intl.DateTimeFormat("de-DE", {hour:"2-digit", minute:"2-digit", timeZone:"Europe/Berlin"}).format(start)} Uhr.`,
      url: `/sessions?modus=eigen&call=${encodeURIComponent(row.id)}`, notAfter: start,
    })) planned++;
  }
  return planned;
}

/** Absagen, Terminänderungen oder ausgeschaltete Erinnerungen stoppen offene Pushs. */
export const recheckCallReminder: Recheck = async (db, n) => {
  let ref: { id: string; start: string };
  try { ref = JSON.parse(n.ref); } catch { return "Ungültiger Termin."; }
  const [row] = await db.query(
    `SELECT s.data,p.reminders FROM sessions s JOIN rsvps r ON r.session=s.id AND r.owner=$2
     LEFT JOIN notification_prefs p ON p.owner=r.owner WHERE s.id=$1`, [ref.id, n.recipient],
  );
  if (!row) return "Teilnahme abgesagt oder Termin entfernt.";
  if (row.reminders === false) return "Erinnerungen ausgeschaltet.";
  const call = JSON.parse(row.data);
  if (call.cancelled) return "Call abgesagt.";
  if (sessionStart(call).toISOString() !== ref.start) return "Termin wurde verschoben.";
  return null;
};
