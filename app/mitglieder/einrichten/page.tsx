import { redirect } from "next/navigation";
import { getCurrentUser, viewerOf, safeNext } from "@/server/auth";
import { database } from "@/server/database";
import { memberAccess } from "@/server/member-access";
import { networkReady, ownMemberProfile } from "@/server/members";
import { OperatorHeader, OperatorFooter } from "../../features/operator-shell";
import MemberEditor from "../../features/member-editor";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/anmelden?next=%2Fmitglieder");
  const db = database(),
    access = await memberAccess(db, actor);
  if (!access.allowed) redirect(access.next);
  const query = await searchParams;
  const destination =
    query.next === "/mitglieder/angebote"
      ? safeNext(query.next)
      : "/mitglieder";
  if (await networkReady(db, actor)) redirect(destination);
  if (!access.participant) redirect("/start");
  const own = await ownMemberProfile(db, actor);
  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewerOf(actor)} />
      <MemberEditor
        initial={{ ...own.profile, listed: true }}
        name={own.name}
        avatarUrl={own.avatarUrl}
        onboarding
        initialStep={own.setupStep}
        destination={destination}
      />
      <OperatorFooter />
    </div>
  );
}
