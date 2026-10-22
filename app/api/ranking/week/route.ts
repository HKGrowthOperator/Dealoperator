import { database, databaseReady } from "@/server/database";
import { communityWeekState } from "@/server/game";
import { errorResponse, json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Öffentlich: gemeinsames Wochenziel aller Anwahlen der laufenden Woche
 * (Montag bis Sonntag). Nur Summen, keine Namen, keine IDs, keine Rangfolge.
 * Höchstens einmal pro Minute neu berechnet (server/game.ts).
 */
export async function GET() {
  try {
    // Ohne Datenbank gibt es keine echte Wochensumme; nichts erfinden.
    if (!databaseReady()) return json({ ready: false });
    const week = await communityWeekState(database());
    return json({
      ready: true,
      weekStart: week.weekStart,
      attempts: week.attempts,
      goal: week.goal,
      auto: week.auto,
      reached: week.reached,
      people: week.people,
      lastWeek: week.lastWeek
        ? { attempts: week.lastWeek.attempts, goal: week.lastWeek.goal, reached: week.lastWeek.reached }
        : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
