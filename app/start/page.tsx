import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, isTeam, safeNext } from "@/server/auth";
import { database } from "@/server/database";
import { ownState } from "@/server/operator";
import {
  bindConfirmedRequest,
  noteConfirmedAccount,
  ONBOARDING_COOKIE,
  requestIdFromCookie,
} from "@/server/onboarding";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import MemberOnboarding from "../features/member-onboarding";
import { discordDestination } from "@/server/discord";
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
  // Anmeldung aus der Profilübernahme heraus: dort entsteht die Anfrage mit
  // genau der gewählten Auswahl. Eine ältere, unbestätigte Anfrage aus diesem
  // Browser wird dann nicht gebunden, und der Team-Hinweis kommt mit der
  // Übernahme statt doppelt.
  const target = new URL(next, "https://operator.invalid");
  const toClaim = target.pathname === "/profil-uebernehmen";
  const requestId = requestIdFromCookie((await cookies()).get(ONBOARDING_COOKIE)?.value);
  // Aus der Übernahme heraus nur eine Anfrage für genau das gewählte Profil
  // binden; dann geht es direkt zum Status.
  const bound = await bindConfirmedRequest(
    db,
    actor,
    requestId,
    toClaim ? target.searchParams.get("profil") || "" : undefined,
  );
  // Das Team sieht das Konto auch dann, wenn die Übernahme nicht abgeschickt
  // wird; Push und E-Mail kommen in diesem Fall erst mit der Anfrage.
  if (!bound) await noteConfirmedAccount(db, actor, toClaim);
  const state = await ownState(db, actor);

  // Team-Konten mit Ziel Verwaltung (etwa aus einem Team-Push) direkt dorthin,
  // auch ohne eigenes Profil.
  if (isTeam(actor) && target.pathname === "/verwaltung" && !bound) redirect(next);

  // Aus „Passwort vergessen oder noch keins?“: zuerst das Passwort festlegen,
  // danach führt /passwort wieder hierher.
  if (target.pathname === "/passwort") redirect("/passwort");

  // Bereits freigegebenes Profil: direkt in den eigenen Bereich.
  if (state.participant) redirect(next);

  // Laufende Übernahmeanfrage: Prüfstatus statt Profilformular. Es entsteht
  // ausdrücklich kein zweites Profil mit leeren Zahlen. Nach einer Ablehnung
  // zeigt /status das Ergebnis; von dort geht es mit ?weiter=eigen zum
  // eigenen Profil.
  const request = state.request as { kind?: string; status?: string } | null;
  const status = String(request?.status ?? "pending");
  const claim = bound?.kind === "claim" || request?.kind === "claim";
  if (claim && ["pending", "info_needed"].includes(status)) redirect("/status");

  // Anmeldung aus der Profilübernahme heraus: dorthin zurück, mit Auswahl
  // und Einladung, auch nach einer früheren Ablehnung.
  if (toClaim) redirect(next);

  if (claim && ["rejected", "superseded"].includes(status) && search.weiter !== "eigen")
    redirect("/status");

  // Nur fragen, was fehlt: eine Nummer liegt vor, wenn sie beim Start
  // angegeben wurde; wer über „Anmelden“ mit neuer Adresse kam, hat keine.
  const [contact] = await db.query("SELECT phone FROM account_private WHERE owner=$1", [
    actor.userId,
  ]);
  const phone = (contact?.phone as string | undefined) || "";
  // Die Übernahme aus diesem Browser lief ins Leere, weil das Profil
  // inzwischen jemand anderem zugeordnet wurde: das sagen, statt nur ein
  // neues Profil anzubieten.
  const [lost] =
    !bound && requestId
      ? await db.query(
          `SELECT p.name FROM onboarding_requests r JOIN participants p ON p.id=r.participant
            WHERE r.id=$1 AND lower(r.email)=$2 AND r.status='superseded'
              AND p.owner IS NOT NULL AND p.owner<>$3`,
          [requestId, actor.email, actor.userId],
        )
      : [];

  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        <MemberOnboarding
          next={next}
          presetName={bound?.fullName || ""}
          needsPhone={!phone}
          takenProfile={(lost?.name as string | undefined) || ""}
          discordUrl={discordDestination().url}
        />
      </main>
      <OperatorFooter />
    </div>
  );
}
