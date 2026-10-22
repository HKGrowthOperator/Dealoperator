import { redirect } from "next/navigation";
import { getCurrentUser, viewerOf } from "@/server/auth";
import { database } from "@/server/database";
import { memberAccess } from "@/server/member-access";
import { ownMemberProfile } from "@/server/members";
import MemberEditor from "../../features/member-editor";
import { OperatorHeader, OperatorFooter } from "../../features/operator-shell";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/starten");
  const db = database(),
    access = await memberAccess(db, actor);
  if (!access.allowed) redirect(access.next);
  if (!access.participant) redirect("/start");
  const own = await ownMemberProfile(db, actor);
  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewerOf(actor)} />
      <MemberEditor
        initial={own.profile}
        name={own.name}
        avatarUrl={own.avatarUrl}
      />
      <OperatorFooter />
    </div>
  );
}
