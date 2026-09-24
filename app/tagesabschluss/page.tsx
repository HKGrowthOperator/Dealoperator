import { redirect } from "next/navigation";
import { getCurrentUser, isTeam } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { closingState } from "@/server/closing";
import { berlinDate, daySchema } from "@/lib/kpis";
import { discordDestination } from "@/server/discord";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import AreaNav from "../features/area-nav";
import ClosingForm, { type ClosingState } from "../features/closing-form";
import DayProgress from "../features/day-progress";
import { PushPrompt } from "../features/push-setup";
import "../commitment.css";

export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Mein Tag: der Tagesabschluss für den gewählten Tag (?tag=…, Standard
 * heute) und darunter ein kompakter Stand. Erinnerungen, Geräte und die
 * Discord-Verknüpfung liegen unter Profil und Einstellungen; Kalender, Pausen
 * und Level unter Mein Fortschritt.
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
      `/anmelden?next=${encodeURIComponent(day === today ? "/tagesabschluss" : `/tagesabschluss?tag=${day}`)}`,
    );
  // Früherer Pfad der Discord-Rückkehr: dorthin, wo die Verknüpfung jetzt liegt.
  if (one(search.discord))
    redirect(`/profil?modus=eigen&discord=${encodeURIComponent(one(search.discord))}`);

  // Vorladen erspart dem Browser einen leeren Zwischenstand. Klappt es nicht,
  // lädt das Formular selbst und zeigt einen ehrlichen Fehler.
  let initial: ClosingState | null = null;
  if (databaseReady()) {
    try {
      initial = JSON.parse(
        JSON.stringify(await closingState(database(), actor, today.slice(0, 7))),
      ) as ClosingState;
    } catch {
      initial = null;
    }
  }

  return (
    <div className="operator-site">
      <OperatorHeader
        viewer={{ signedIn: true, hasPassword: !!actor.hasPassword, team: isTeam(actor) }}
      />
      <main id="inhalt" className="do-page do-page-narrow md">
        <AreaNav area="mine" />
        <h1 className="do-sr">Mein Tag</h1>
        <ClosingForm
          key={day}
          day={day}
          initial={initial}
          syncUrl
          afterSubmit={
            <>
              <p className="md-discord">
                Call-Partner für den nächsten Calling-Tag?{" "}
                <a href={discordDestination().url} target="_blank" rel="noopener noreferrer">
                  Im Discord Sessions und Roleplay finden
                  <span className="do-sr"> (neues Fenster)</span>
                </a>
              </p>
              <PushPrompt settings={initial?.settings} variant="after-submit" />
            </>
          }
        />
        <DayProgress initial={initial} />
      </main>
      <OperatorFooter showAdmin={isTeam(actor)} />
    </div>
  );
}
