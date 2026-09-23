import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, safeNext } from "@/server/auth";
import { database } from "@/server/database";
import { ownState } from "@/server/operator";
import {
  bindConfirmedRequest,
  noteConfirmedAccount,
  ONBOARDING_COOKIE,
} from "@/server/onboarding";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import MemberOnboarding from "../features/member-onboarding";
export const dynamic = "force-dynamic";

/**
 * Landepunkt nach dem Bestätigungslink. Hier wird die vor der Bestätigung
 * angelegte Anfrage an das Konto gebunden — dadurch überlebt die Profilauswahl
 * den Mailweg, ohne dass Kontaktdaten je in einer URL stehen.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const next = safeNext((await searchParams).next || null);
  const actor = await getCurrentUser();
  if (!actor) redirect(`/anmelden?next=${encodeURIComponent(next)}`);

  const db = database();
  const requestId = (await cookies()).get(ONBOARDING_COOKIE)?.value;
  const bound = await bindConfirmedRequest(db, actor, requestId);
  if (!bound) await noteConfirmedAccount(db, actor);
  const state = await ownState(db, actor);

  // Bereits freigegebenes Profil: direkt in den eigenen Bereich.
  if (state.participant) redirect(next);

  // Laufende Übernahmeanfrage: Prüfstatus statt Profilformular. Es entsteht
  // ausdrücklich kein zweites Profil mit leeren Zahlen.
  const request = state.request as { kind?: string; status?: string } | null;
  if (
    (bound?.kind === "claim" || request?.kind === "claim") &&
    ["pending", "info_needed", "rejected", "superseded"].includes(
      String(request?.status ?? "pending"),
    )
  )
    redirect("/status");

  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        <MemberOnboarding next={next} presetName={bound?.fullName || ""} />
      </main>
      <OperatorFooter />
    </div>
  );
}
