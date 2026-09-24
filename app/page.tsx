import { discordDestination } from "@/server/discord";
import { viewerState } from "@/server/home";
import RankingBoard from "./features/ranking-board";
export const dynamic = "force-dynamic";

/**
 * Gemeinsame Startseite, auch nach der Anmeldung das Zentrum. Angemeldet
 * kommt ein kompakter Abschnitt „Mein Tag“ dazu; die gemeinsamen Ergebnisse
 * bleiben im Vordergrund.
 */
export default async function Page() {
  const { viewer, home } = await viewerState();
  return <RankingBoard discordUrl={discordDestination().url} viewer={viewer} home={home} />;
}
