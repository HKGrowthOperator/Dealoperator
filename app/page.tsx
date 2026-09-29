import { discordDestination } from "@/server/discord";
import { viewerState } from "@/server/home";
import { database, databaseReady } from "@/server/database";
import { upcomingSessions, type PublicSession } from "@/server/sessions";
import RankingBoard from "./features/ranking-board";
export const dynamic = "force-dynamic";

/**
 * Gemeinsame Startseite, auch nach der Anmeldung das Zentrum. Angemeldet
 * kommt ein kompakter Abschnitt „Mein Tag“ dazu; die gemeinsamen Ergebnisse
 * bleiben im Vordergrund. Kommende Sessions sieht jeder.
 */
export default async function Page() {
  const [{ viewer, home }, sessions] = await Promise.all([viewerState(), nextSessions()]);
  return (
    <RankingBoard discordUrl={discordDestination().url} viewer={viewer} home={home} sessions={sessions} />
  );
}

async function nextSessions(): Promise<PublicSession[]> {
  if (!databaseReady()) return [];
  try {
    return await upcomingSessions(database());
  } catch {
    // Die Startseite steht auch ohne diese Liste.
    return [];
  }
}
