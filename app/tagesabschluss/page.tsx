import { redirect } from "next/navigation";
import { getCurrentUser, isTeam, viewerOf } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { closingState } from "@/server/closing";
import { homeState } from "@/server/home";
import { berlinDate, daySchema } from "@/lib/kpis";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import AreaNav from "../features/area-nav";
import type { ClosingState } from "../features/closing-form";
import DayEntry from "../features/day-entry";
import DayProgress from "../features/day-progress";
import "../commitment.css";

export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Mein Tag: das Formular für heute, ohne Zwischenseite. Zahlen und zwei kurze
 * Antworten, einreichen, fertig; danach geht es direkt zu den Ergebnissen.
 * Mit ?tag=… derselbe Weg für einen anderen Tag (ansehen, korrigieren,
 * nachtragen). Darunter Serie und Level. Erinnerungen, Geräte und die
 * Discord-Verknüpfung liegen unter Profil und Einstellungen.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const today = berlinDate();
  const parsed = daySchema.safeParse(one(search.tag));
  const day = parsed.success ? parsed.data : today;
  const actor = await getCurrentUser();
  if (!actor)
    redirect(
      `/anmelden?next=${encodeURIComponent(parsed.success ? `/tagesabschluss?tag=${day}` : "/tagesabschluss")}`,
    );
  // Früherer Pfad der Discord-Rückkehr: dorthin, wo die Verknüpfung jetzt liegt.
  if (one(search.discord))
    redirect(`/profil?modus=eigen&discord=${encodeURIComponent(one(search.discord))}`);

  // Vorladen erspart dem Browser einen leeren Zwischenstand. Klappt es nicht,
  // lädt das Formular selbst und zeigt einen ehrlichen Fehler.
  let initial: ClosingState | null = null;
  let name = "";
  if (databaseReady()) {
    try {
      const db = database();
      const [state, home] = await Promise.all([
        closingState(db, actor, today.slice(0, 7)),
        homeState(db, actor, today),
      ]);
      initial = JSON.parse(JSON.stringify(state)) as ClosingState;
      name = home.participant?.name ?? "";
    } catch {
      initial = null;
      name = "";
    }
  }

  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewerOf(actor)} />
      <main id="inhalt" className="do-page do-page-narrow md">
        <AreaNav area="mine" />
        <div className="do-page-head md-page-head">
          <div>
            <h1>Mein Tag</h1>
            <p>
              {name ? (
                <>
                  Du trägst ein als <strong>{name}</strong>. Zahlen und zwei kurze Antworten,
                  dann zählt dein Tag.
                </>
              ) : (
                "Zahlen und zwei kurze Antworten, dann zählt dein Tag."
              )}
            </p>
          </div>
        </div>
        <DayEntry day={day} today={today} initial={initial} />
        <DayProgress initial={initial} />
      </main>
      <OperatorFooter showAdmin={isTeam(actor)} />
    </div>
  );
}
