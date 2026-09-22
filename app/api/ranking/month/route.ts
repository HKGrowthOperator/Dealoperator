import { database, databaseReady } from "@/server/database";
import { publicRankingMonth } from "@/server/ranking-history";
import { berlinDate, daySchema } from "@/lib/kpis";
import { monthSchema, summarizeRankingMonth } from "@/lib/ranking-history";
import {
  REPORTED_DAY,
  REPORTED_LABEL,
  reportedSnapshot,
} from "@/lib/reported-snapshot";
import { errorResponse, json } from "@/server/http";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const month = monthSchema.parse(
      params.get("month") || berlinDate().slice(0, 7),
    );
    const day = params.has("day")
      ? daySchema.parse(params.get("day"))
      : undefined;
    if (day && !day.startsWith(`${month}-`))
      return json({ error: "Der Tag muss im ausgewählten Monat liegen." }, 400);
    if (!databaseReady()) {
      const records = reportedSnapshot().map((row) => ({
        ...row,
        day: REPORTED_DAY,
        counts: { ...row.counts, decisionMakerConversations: null },
      }));
      return json({
        ...summarizeRankingMonth(records, month, day),
        ready: true,
        snapshot: true,
        label: REPORTED_LABEL,
      });
    }
    return json({
      ...(await publicRankingMonth(database(), month, day)),
      ready: true,
      snapshot: false,
      label: "",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
