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
  const search = await searchParams;
  const next = safeNext(search.next || null);
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
  // ausdrücklich kein zweites Profil mit leeren Zahlen. Nach einer Ablehnung
  // zeigt /status das Ergebnis; von dort geht es mit ?weiter=eigen zum
  // eigenen Profil.
  const request = state.request as { kind?: string; status?: string } | null;
  const status = String(request?.status ?? "pending");
  if (
    (bound?.kind === "claim" || request?.kind === "claim") &&
    (["pending", "info_needed"].includes(status) ||
      (["rejected", "superseded"].includes(status) && search.weiter !== "eigen"))
  )
    redirect("/status");

  // Anmeldung aus der Profilübernahme heraus: dorthin zurück, mit Auswahl.
  if (new URL(next, "https://operator.invalid").pathname === "/profil-uebernehmen")
    redirect(next);

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
