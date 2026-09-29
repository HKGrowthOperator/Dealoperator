import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import AuthForm from "../features/auth-form";
import { authReady, getCurrentUser, safeNext, viewerOf } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { emailCodeEnabled } from "@/server/email-auth";
import { ownMailReady } from "@/server/email-code";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/**
 * Anmeldung für bestehende Mitglieder. Bewusst getrennt vom Einstieg unter
 * /starten, damit niemand bei jeder Anmeldung erneut durch die Profilauswahl
 * geführt wird. Mit gültiger Sitzung gibt es keine Fehlermeldung, auch nicht
 * nach einem zweiten Klick auf einen Maillink: es geht direkt zum Ziel.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const search = await searchParams;
  const next = safeNext(search.next || null);
  if (await getCurrentUser()) redirect(next);
  const ownMail = databaseReady() && (await ownMailReady(database()).catch(() => false));
  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewerOf(null)} />
      <main className="auth-layout">
        <AuthForm
          ready={authReady() && databaseReady()}
          next={next}
          error={(search.fehler || "").slice(0, 20)}
          codeEnabled={emailCodeEnabled() || ownMail}
          ownMail={ownMail}
          confirmed={search.bestaetigt === "1"}
        />
      </main>
      <OperatorFooter />
    </div>
  );
}
