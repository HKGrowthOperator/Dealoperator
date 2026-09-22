import { database, databaseReady } from "@/server/database";
import { publicRanking } from "@/server/operator";
import { berlinDate, daySchema } from "@/lib/kpis";
import { json, errorResponse } from "@/server/http";
import {
  REPORTED_DAY,
  REPORTED_LABEL,
  reportedSnapshot,
} from "@/lib/reported-snapshot";

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const from = daySchema.parse(search.get("from") || berlinDate());
    const to = daySchema.parse(search.get("to") || berlinDate());
    if (from > to)
      return json({ error: "Der Beginn muss vor dem Ende liegen." }, 400);

    if (!databaseReady()) {
      // Solange die Datenbank noch nicht verbunden ist, trägt die freigegebene
      // Momentaufnahme die öffentliche Ansicht. Es sind echte gemeldete Zahlen,
      // klar als Stand gekennzeichnet — keine erfundenen Werte.
      const inRange = REPORTED_DAY >= from && REPORTED_DAY <= to;
      return json({
        ready: true,
        snapshot: true,
        label: REPORTED_LABEL,
        reportedOn: REPORTED_DAY,
        rows: inRange ? reportedSnapshot() : [],
      });
    }

    return json({
      ready: true,
      snapshot: false,
      label: "",
      reportedOn: "",
      rows: await publicRanking(database(), from, to),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
