import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import OnboardingStart from "../features/onboarding-start";
import { authReady, getCurrentUser, safeNext } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { profileForSelection } from "@/server/onboarding";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/**
 * Einstieg mit zwei gleichwertigen Wegen. Die Auswahl eines vorbereiteten
 * Profils ist hier bewusst vor der E-Mail-Eingabe möglich.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const search = await searchParams;
  if (await getCurrentUser()) redirect(safeNext(search.next || null));

  // Direktlink aus einer persönlichen Einladung: Profil vorauswählen, sofern
  // es noch frei ist. Ein bereits übernommenes Profil fällt hier heraus.
  let preselected = null;
  const invite = (search.einladung || "").slice(0, 200);
  if (search.profil && databaseReady()) {
    try {
      preselected = await profileForSelection(
        database(),
        search.profil,
        invite || undefined,
      );
    } catch {
      preselected = null;
    }
  }

  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        <OnboardingStart
          ready={authReady() && databaseReady()}
          preselected={preselected}
          invite={invite}
          linkError={(search.fehler || "").slice(0, 20)}
        />
      </main>
      <OperatorFooter />
    </div>
  );
}
