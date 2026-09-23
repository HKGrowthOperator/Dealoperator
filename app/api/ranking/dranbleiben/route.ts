import { database, databaseReady } from "@/server/database";
import { berlinDate, daySchema } from "@/lib/kpis";
import { errorResponse, json } from "@/server/http";
import { commitmentRanking } from "@/server/commitment-public";

export const dynamic = "force-dynamic";

/** Öffentlich: Dranbleiben-Rangliste (Serien, aktive Tage) ohne private Status. */
export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const to = daySchema.parse(search.get("to") || berlinDate());
    const from = daySchema.parse(search.get("from") || `${to.slice(0, 7)}-01`);
    if (from > to) return json({ error: "Der Beginn muss vor dem Ende liegen." }, 400);
    if (!databaseReady()) return json({ rows: [] });
    return json({ rows: await commitmentRanking(database(), from, to) });
  } catch (e) {
    return errorResponse(e);
  }
}
