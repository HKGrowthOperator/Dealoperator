import { discordDestination } from "@/server/discord";
import RankingBoard from "../features/ranking-board";
export const dynamic = "force-dynamic";
export default function Page() {
  return <RankingBoard onlyRanking discordUrl={discordDestination().url} />;
}
