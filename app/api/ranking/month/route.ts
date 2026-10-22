import { database, databaseReady } from "@/server/database";
import { latestPublicDay, publicRankingMonth } from "@/server/ranking-history";
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
    // Startansicht ohne gewählten Zeitraum: heute, oder der letzte Tag mit
    // Meldungen, wenn heute noch nichts gemeldet ist. Gewählte Tage und
    // Monate sowie geteilte Links behalten ihren Zeitraum.
    if (params.get("latest") === "1" && !params.has("day") && !params.has("month")) {
      const today = berlinDate();
      const found = databaseReady()
        ? await latestPublicDay(database(), today)
        : REPORTED_DAY <= today
          ? REPORTED_DAY
          : null;
      const day = found ?? today;
      const latest = { day, today, fallback: day !== today };
      if (!databaseReady()) {
        const records = reportedSnapshot().map((row) => ({
          ...row,
          day: REPORTED_DAY,
          counts: { ...row.counts, decisionMakerConversations: null },
        }));
        return json({
          ...summarizeRankingMonth(records, day.slice(0, 7), day),
          ready: true,
          snapshot: true,
          label: REPORTED_LABEL,
          day,
          latest,
        });
      }
      return json({
        ...(await publicRankingMonth(database(), day.slice(0, 7), day)),
        ready: true,
        snapshot: false,
        label: "",
        day,
        latest,
      });
    }
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
