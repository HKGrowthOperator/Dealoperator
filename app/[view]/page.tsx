import CommunityApp from "../community-app";
import { getCurrentUser } from "@/server/auth";
import { discordDestination } from "@/server/discord";
import { database, databaseReady } from "@/server/database";
import { views, type View } from "../data";
import { notFound, redirect } from "next/navigation";
export const dynamic = "force-dynamic";
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
      `/community?modus=${query.modus === "eigen" ? "eigen" : "demo"}#discord`,
    );
  }
  if (!views.includes(view as View)) notFound();
  const user = await getCurrentUser();
  const query = await searchParams;
  if (query.modus !== "demo") {
    const next = `/${view}?modus=eigen`;
    if (!user) redirect(`/beitreten?next=${encodeURIComponent(next)}`);
    if (databaseReady()) {
      const [member] = await database().query(
        "SELECT id FROM participants WHERE owner=$1",
        [user.userId],
      );
      if (!member) redirect(`/start?next=${encodeURIComponent(next)}`);
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
