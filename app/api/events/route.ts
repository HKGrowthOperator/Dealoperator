import { database, databaseReady } from "@/server/database";
import { errorResponse, json } from "@/server/http";
import { listEvents } from "@/server/admin";

export const dynamic = "force-dynamic";

/** Öffentlich: gekennzeichnete Tage wie der Akquise Day. */
export async function GET() {
  try {
    if (!databaseReady()) return json({ events: [] });
    return json({ events: await listEvents(database()) });
  } catch (e) {
    return errorResponse(e);
  }
}
