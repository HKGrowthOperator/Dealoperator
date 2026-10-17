import type { Database } from "./database";
import { callRoomOf } from "../lib/call-room";
import { sessionEnd } from "../lib/session-rules";

/** Resolve the current room on click, so a changed link never leaves an old room in a push. */
export async function callEntryDestination(db: Database, id: string, now = new Date()) {
  if (!id || id.length > 100) return null;
  const [row] = await db.query("SELECT data FROM sessions WHERE id=$1", [id]);
  if (!row) return null;
  const call = JSON.parse(row.data);
  const end = sessionEnd(call).getTime();
  if (call.cancelled || !Number.isFinite(end) || end <= now.getTime()) return null;
  // Only validated Google Meet links or the existing shared room are permitted.
  return callRoomOf(call.roomUrl, call.url);
}
