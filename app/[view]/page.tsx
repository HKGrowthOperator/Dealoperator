import CommunityApp from "../community-app";
import { getCurrentUser } from "@/server/auth";
import { discordDestination } from "@/server/discord";
import { database, databaseReady } from "@/server/database";
import { views, type View } from "../data";
import { notFound, redirect } from "next/navigation";
export const dynamic = "force-dynamic";
// Frühere Pfade bleiben erreichbar. Der Browser übernimmt ein #Ziel der alten
// Adresse selbst, solange die Weiterleitung kein eigenes #Ziel setzt.
const renamedViews = new Map<string, View>([
  ["community", "so-funktionierts"],
  ["crew", "partner"],
]);
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { view } = await params;
  if (view === "partnerregister") {
    const query = await searchParams;
    redirect(
      `/so-funktionierts?modus=${query.modus === "eigen" ? "eigen" : "demo"}#discord`,
    );
  }
  const renamed = renamedViews.get(view);
  if (renamed) {
    const query = await searchParams;
    const rest = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      for (const item of [value].flat())
        if (item !== undefined) rest.append(key, item);
    const suffix = rest.toString();
    redirect(`/${renamed}${suffix ? `?${suffix}` : ""}`);
  }
  if (!views.includes(view as View)) notFound();
  const user = await getCurrentUser();
  const query = await searchParams;
  // Kein Demo-Modus mehr: echte Daten oder ehrlicher Anmelde-/Leerzustand.
  {
    const next = `/${view}?modus=eigen`;
    if (!user) redirect(`/anmelden?next=${encodeURIComponent(next)}`);
    if (databaseReady()) {
      const db = database();
      const [member] = await db.query(
        "SELECT id FROM participants WHERE owner=$1",
        [user.userId],
      );
      if (!member) {
        // Laufende Übernahmeanfrage: Prüfstatus statt Profilformular, damit
        // kein zweites Profil mit leeren Zahlen entsteht.
        const [open] = await db.query(
          `SELECT id FROM onboarding_requests
           WHERE owner=$1 AND kind='claim'
             AND status IN ('pending','info_needed') LIMIT 1`,
          [user.userId],
        );
        redirect(open ? "/status" : `/start?next=${encodeURIComponent(next)}`);
      }
    }
    if (query.modus !== "eigen") redirect(next);
  }
  return (
    <CommunityApp
      initialView={view as View}
      signedIn={!!user}
      discordUrl={discordDestination().url}
    />
  );
}
