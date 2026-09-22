import { redirect } from "next/navigation";
import { getCurrentUser, safeNext } from "@/server/auth";
import { database } from "@/server/database";
import { ownState } from "@/server/operator";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import MemberOnboarding from "../features/member-onboarding";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const next = safeNext((await searchParams).next || null);
  const actor = await getCurrentUser();
  if (!actor) redirect(`/beitreten?next=${encodeURIComponent(next)}`);
  const state = await ownState(database(), actor);
  if (state.participant || next.startsWith("/profil-uebernehmen"))
    redirect(next);
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        <MemberOnboarding
          next={next}
          candidates={state.candidates.map((p) => ({
            id: p.id,
            name: p.name,
            company: p.company,
          }))}
        />
      </main>
      <OperatorFooter />
    </div>
  );
}
