import { redirect } from "next/navigation";
import { getCurrentUser, viewerOf } from "@/server/auth";
import { database } from "@/server/database";
import { memberAccess } from "@/server/member-access";
import { listMemberOffers, networkReady } from "@/server/members";
import { OperatorHeader, OperatorFooter } from "../../features/operator-shell";
import MemberOffers from "../../features/member-offers";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/anmelden?next=%2Fmitglieder%2Fangebote");
  const db = database(),
    access = await memberAccess(db, actor);
  if (!access.allowed) redirect(access.next);
  if (!(await networkReady(db, actor)))
    redirect("/mitglieder/einrichten?next=%2Fmitglieder%2Fangebote");
  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewerOf(actor)} />
      <MemberOffers initial={await listMemberOffers(db, actor)} />
      <OperatorFooter />
    </div>
  );
}
