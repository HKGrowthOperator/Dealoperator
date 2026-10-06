import { discordDestination } from "@/server/discord";
import RankingBoard from "../features/ranking-board";
import { viewerState } from "@/server/home";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
// Dieselben Ergebnisse wie auf der Startseite: eine Adresse im Index.
export const metadata: Metadata = { title: "Rangliste · Deal Operator", alternates: { canonical: "/" } };

/**
 * Dieselben Ergebnisse wie auf der Startseite, ohne Einstieg und Erklärung.
 * Die Karte „Mein Tag“ steht auch hier, deshalb mit Tagesrunde.
 */
export default async function Page() {
  const { viewer, home } = await viewerState({ game: true });
  return (
    <RankingBoard onlyRanking discordUrl={discordDestination().url} viewer={viewer} home={home} />
  );
}
