import { redirect } from "next/navigation";
import { getCurrentUser, viewerOf } from "@/server/auth";
import { database } from "@/server/database";
import { memberAccess } from "@/server/member-access";
import { directory } from "@/server/members";
import { GET as community } from "../api/community/route";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import CallsHub from "../features/calls-hub";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/starten");
  const db = database(),
    access = await memberAccess(db, actor);
  if (!access.allowed) redirect(access.next);
  const response = await community();
  if (!response.ok) throw Error("Die Calls konnten nicht geladen werden.");
  const data = await response.json(),
    search = await searchParams;
  const target = search.mit
    ? (await directory(db, actor)).find((m) => m.id === search.mit) || null
    : null;
  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewerOf(actor)} />
      <CallsHub
        initial={{ sessions: data.sessions, callUrl: data.callUrl }}
        target={target}
      />
      <OperatorFooter />
    </div>
  );
}
