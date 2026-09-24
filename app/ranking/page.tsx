import { discordDestination } from "@/server/discord";
import RankingBoard from "../features/ranking-board";
import { viewerState } from "@/server/home";
export const dynamic = "force-dynamic";

/** Dieselben Ergebnisse wie auf der Startseite, ohne Einstieg und Erklärung. */
export default async function Page() {
  const { viewer, home } = await viewerState();
  return (
    <RankingBoard onlyRanking discordUrl={discordDestination().url} viewer={viewer} home={home} />
  );
}
