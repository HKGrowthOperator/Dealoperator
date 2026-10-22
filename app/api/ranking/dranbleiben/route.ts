import { database, databaseReady } from "@/server/database";
import { berlinDate, daySchema } from "@/lib/kpis";
import { errorResponse, json } from "@/server/http";
import { commitmentRanking } from "@/server/commitment-public";

export const dynamic = "force-dynamic";

const EARLIEST = "2026-01-01";
// Kurzer Zwischenspeicher: dieselbe öffentliche Rangliste wird höchstens
// einmal pro Minute neu berechnet, egal wie viele Anfragen kommen.
const cache = new Map<string, { at: number; rows: unknown[] }>();

/** Öffentlich: Dranbleiben-Rangliste (Serien, aktive Tage) ohne private Status. */
export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const to = daySchema.parse(search.get("to") || berlinDate());
    const from = daySchema.parse(search.get("from") || `${to.slice(0, 7)}-01`);
    if (from > to) return json({ error: "Der Beginn muss vor dem Ende liegen." }, 400);
    // Öffentlich und ohne Anmeldung: Zeitraum eng begrenzen, damit keine
    // Anfrage den Server mit Jahrhunderten an Kalendertagen beschäftigt.
    if (from < EARLIEST || Date.parse(to) - Date.parse(from) > 62 * 86_400_000)
      return json({ error: "Bitte einen Zeitraum von höchstens zwei Monaten ab 2026 wählen." }, 400);
    if (!databaseReady()) return json({ rows: [] });
    const key = `${from}|${to}`;
    const hit = cache.get(key);
    if (hit && hit.at > Date.now() - 60_000) return json({ rows: hit.rows });
    const rows = await commitmentRanking(database(), from, to);
    if (cache.size > 50) cache.clear();
    cache.set(key, { at: Date.now(), rows });
    return json({ rows });
  } catch (e) {
    return errorResponse(e);
  }
}
