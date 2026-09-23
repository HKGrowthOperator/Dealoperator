import { database, databaseReady } from "@/server/database";
import { json } from "@/server/http";
import { secretMatches } from "@/server/notify";
import { tick } from "@/server/scheduler";

export const dynamic = "force-dynamic";

/**
 * Optionaler externer Takt (z. B. Coolify Scheduled Task), zusätzlich zum
 * Takt im Server-Prozess. Nur mit CRON_SECRET (mindestens 32 Zeichen) im
 * Authorization-Header; ohne gesetztes Geheimnis gibt es den Endpunkt nicht.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return new Response(null, { status: 404 });
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!secretMatches(given, secret)) return new Response(null, { status: 404 });
  if (!databaseReady()) return json({ error: "Die Datenbank ist noch nicht verbunden." }, 503);
  try {
    const result = await tick(database());
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: (error as Error).message.slice(0, 200) }, 500);
  }
}
