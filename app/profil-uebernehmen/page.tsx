import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isTeam } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { AppError } from "@/server/operator";
import { profileForSelection } from "@/server/onboarding";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import ClaimRequest from "../features/claim-request";
export const dynamic = "force-dynamic";

/**
 * Profilübernahme. Ohne Anmeldung führt die Seite in den Start unter /starten
 * (Auswahl vor der E-Mail). Mit Anmeldung stellt die Person die Anfrage direkt
 * mit ihrem bestätigten Konto; ausgewähltes Profil und Einladung bleiben dabei
 * erhalten. Freigeben kann weiterhin nur das Team.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const search = await searchParams;
  const profil = (search.profil || "").slice(0, 100);
  const invite = (search.einladung || "").slice(0, 200);
  const actor = await getCurrentUser();
  if (!actor) {
    const params = new URLSearchParams();
    if (profil && profil !== "beispiel") params.set("profil", profil);
    if (invite) params.set("einladung", invite);
    const query = params.toString();
    redirect(`/starten${query ? `?${query}` : ""}`);
  }
  if (!databaseReady()) redirect("/starten");
  const db = database();

  const [owned] = await db.query("SELECT id FROM participants WHERE owner=$1", [
    actor.userId,
  ]);
  const [open] = owned
    ? []
    : await db.query(
        `SELECT id FROM onboarding_requests
          WHERE owner=$1 AND kind='claim' AND status IN ('pending','info_needed') LIMIT 1`,
        [actor.userId],
      );
  // Eine laufende Anfrage zeigt ihren Stand, statt eine zweite zu beginnen.
  if (open) redirect("/status");

  let preselected: { id: string; name: string; company: string; role: string } | null =
    null;
  let problem = "";
  let needsInvite = "";
  let taken = "";
  if (!owned && profil && profil !== "beispiel") {
    try {
      preselected = await profileForSelection(db, profil, invite || undefined);
    } catch (e) {
      if (e instanceof AppError && e.status === 409) {
        const [p] = await db.query(
          "SELECT name FROM participants WHERE id=$1 AND owner IS NOT NULL AND kind='person'",
          [profil],
        );
        taken = (p?.name as string | undefined) || "";
      }
      if (!taken)
        problem =
          e instanceof AppError
            ? e.message
            : "Dieses Profil lässt sich gerade nicht auswählen.";
      if (e instanceof AppError && e.status === 403) needsInvite = profil;
    }
  }
  const [contact] = await db.query(
    "SELECT phone FROM account_private WHERE owner=$1",
    [actor.userId],
  );

  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        {owned ? (
          <section className="auth-card card flow">
            <h1>Dein Konto hat bereits ein Profil.</h1>
            <p className="flow-lead">
              Jedes Konto gehört zu genau einem Profil. Eine zweite Übernahme
              ist deshalb nicht möglich.
            </p>
            <Link className="btn primary full" href="/tagesabschluss">
              Zu meinem Tag
            </Link>
          </section>
        ) : (
          <ClaimRequest
            email={actor.email}
            phone={(contact?.phone as string | undefined) || ""}
            preselected={preselected}
            invite={invite}
            problem={problem}
            needsInvite={needsInvite}
            taken={taken}
            assign={search.weg === "team"}
          />
        )}
      </main>
      <OperatorFooter showAdmin={isTeam(actor)} />
    </div>
  );
}
