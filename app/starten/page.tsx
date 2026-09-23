import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import OnboardingStart, { type PendingStart } from "../features/onboarding-start";
import { authReady, getCurrentUser, safeNext } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { emailCodeEnabled, RESEND_SECONDS } from "@/server/email-auth";
import {
  ONBOARDING_COOKIE,
  pendingForBrowser,
  profileForSelection,
} from "@/server/onboarding";
import { AppError } from "@/server/operator";
export const dynamic = "force-dynamic";

/**
 * Start für neue Konten mit zwei gleichwertigen Wegen. Die Auswahl eines
 * vorbereiteten Profils ist hier bewusst vor der E-Mail-Eingabe möglich.
 * Angemeldete Konten gehen ohne erneute E-Mail direkt zum nächsten Schritt.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const search = await searchParams;
  const profil = (search.profil || "").slice(0, 100);
  const invite = (search.einladung || "").slice(0, 200);
  if (await getCurrentUser()) {
    // Mit ausgewähltem Profil oder Einladung: direkt zur Übernahme mit dem
    // bestehenden Konto, ohne die Auswahl zu verlieren. Sonst entscheidet
    // /start, was als Nächstes dran ist (Status, Profil anlegen, eigener Bereich).
    if (profil) {
      const params = new URLSearchParams({ profil });
      if (invite) params.set("einladung", invite);
      redirect(`/profil-uebernehmen?${params}`);
    }
    redirect(`/start?next=${encodeURIComponent(safeNext(search.next || null))}`);
  }

  // Direktlink aus dem Ranking oder einer Einladung: Profil vorauswählen,
  // sofern es noch frei ist. Ein vergebenes Profil bekommt eigene Optionen
  // statt still zu verschwinden.
  let preselected = null;
  let taken: { id: string; name: string } | null = null;
  let problem = "";
  let needsInvite = "";
  let pending: PendingStart | null = null;
  if (databaseReady()) {
    const db = database();
    if (profil) {
      try {
        preselected = await profileForSelection(db, profil, invite || undefined);
      } catch (e) {
        if (e instanceof AppError && e.status === 409) {
          const [p] = await db.query(
            "SELECT id,name FROM participants WHERE id=$1 AND owner IS NOT NULL AND kind='person'",
            [profil],
          );
          if (p) taken = { id: p.id as string, name: p.name as string };
        }
        if (!taken)
          problem =
            e instanceof AppError
              ? e.message
              : "Dieses Profil lässt sich gerade nicht auswählen.";
        if (e instanceof AppError && e.status === 403) needsInvite = profil;
      }
    }
    // Angaben aus diesem Browser, solange die E-Mail noch unbestätigt ist:
    // nach Zurück, Neuladen oder einem Link-Fehler steht der Stand wieder da.
    const found = await pendingForBrowser(
      db,
      (await cookies()).get(ONBOARDING_COOKIE)?.value,
    );
    if (found) {
      pending = {
        kind: found.kind,
        profile: found.profile,
        profileTaken: found.profileTaken,
        email: found.email,
        fullName: found.fullName,
        phone: found.phone,
        hint: found.hint,
        resendIn: Math.max(0, Math.ceil(RESEND_SECONDS - found.secondsAgo)),
      };
    }
  }

  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        <OnboardingStart
          ready={authReady() && databaseReady()}
          codeEnabled={emailCodeEnabled()}
          preselected={preselected}
          taken={taken}
          invite={invite}
          linkError={(search.fehler || "").slice(0, 20)}
          problem={problem}
          needsInvite={needsInvite}
          pending={pending}
          initialWeg={(search.weg || "").slice(0, 10)}
        />
      </main>
      <OperatorFooter />
    </div>
  );
}
