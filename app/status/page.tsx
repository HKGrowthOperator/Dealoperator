import { redirect } from "next/navigation";
import { getCurrentUser, isTeam } from "@/server/auth";
import { database } from "@/server/database";
import { ownState } from "@/server/operator";
import { requestForActor } from "@/server/onboarding";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import RequestStatus from "../features/request-status";
export const dynamic = "force-dynamic";

/**
 * Prüfstatus der eigenen Übernahmeanfrage. Nach einer Freigabe geht es von
 * hier direkt in den eigenen Bereich; eine offene Seite erkennt die Freigabe
 * selbst (siehe RequestStatus). Der Antragsteller sieht seine
 * eigenen Angaben und den Stand, aber keine privaten Daten des ausgewählten
 * Profils — diese gibt erst die Freigabe frei.
 */
export default async function Page() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/anmelden?next=%2Fheute%3Fmodus%3Deigen");
  const db = database();
  const state = await ownState(db, actor);
  if (state.participant) redirect("/heute?modus=eigen");
  const request = await requestForActor(db, actor);
  if (!request) redirect("/start");
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        <RequestStatus
          request={{
            kind: String(request.kind),
            status: String(request.status),
            fullName: String(request.fullName),
            email: String(request.email),
            phone: String(request.phone),
            hint: String(request.hint || ""),
            message: String(request.message || ""),
            lastAnswer: String(request.lastAnswer || ""),
            participantName: request.participantName
              ? String(request.participantName)
              : "",
            createdAt: new Date(request.createdAt as string).toISOString(),
          }}
        />
      </main>
      <OperatorFooter showAdmin={isTeam(actor)} />
    </div>
  );
}
