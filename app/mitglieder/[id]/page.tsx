import { notFound, redirect } from "next/navigation";
import { getCurrentUser, viewerOf } from "@/server/auth";
import { database } from "@/server/database";
import { memberAccess } from "@/server/member-access";
import { directory } from "@/server/members";
import MemberDetail from "../../features/member-detail";
import { OperatorHeader, OperatorFooter } from "../../features/operator-shell";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/starten");
  const db = database(),
    access = await memberAccess(db, actor);
  if (!access.allowed) redirect(access.next);
  const { id } = await params,
    m = (await directory(db, actor)).find((m) => m.id === id);
  if (!m) notFound();
  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewerOf(actor)} />
      <MemberDetail member={m} />
      <OperatorFooter />
    </div>
  );
}
