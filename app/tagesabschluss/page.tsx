import { redirect } from "next/navigation";
import { getCurrentUser, isTeam, viewerOf } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { closingState } from "@/server/closing";
import { homeState, type HomeState } from "@/server/home";
import { berlinDate, daySchema } from "@/lib/kpis";
import { discordDestination } from "@/server/discord";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import AreaNav from "../features/area-nav";
import ClosingForm, { type ClosingState } from "../features/closing-form";
import DayHub from "../features/day-hub";
import DayProgress from "../features/day-progress";
import { PushPrompt } from "../features/push-setup";
import "../commitment.css";

export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Mein Tag. Ohne gewählten Tag: der eigene Stand für heute mit dem nächsten
 * Schritt (Zahlen eintragen läuft über die Reflexionen, wo der eigene Tag
 * zuerst kommt), darunter Serie und Level. Mit ?tag=… das Formular für
 * genau diesen Tag: ansehen, korrigieren, nachtragen. Erinnerungen, Geräte
 * und die Discord-Verknüpfung liegen unter Profil und Einstellungen; Kalender,
 * Pausen und Level unter Mein Fortschritt.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const today = berlinDate();
  const parsed = daySchema.safeParse(one(search.tag));
  const day = parsed.success ? parsed.data : null;
  const actor = await getCurrentUser();
  if (!actor)
    redirect(
      `/anmelden?next=${encodeURIComponent(day ? `/tagesabschluss?tag=${day}` : "/tagesabschluss")}`,
    );
  // Früherer Pfad der Discord-Rückkehr: dorthin, wo die Verknüpfung jetzt liegt.
  if (one(search.discord))
    redirect(`/profil?modus=eigen&discord=${encodeURIComponent(one(search.discord))}`);

  // Vorladen erspart dem Browser einen leeren Zwischenstand. Klappt es nicht,
  // lädt das Formular selbst und zeigt einen ehrlichen Fehler.
  let initial: ClosingState | null = null;
  let home: HomeState | null = null;
  if (databaseReady()) {
    try {
      const db = database();
      const [state, mine] = await Promise.all([
        closingState(db, actor, today.slice(0, 7)),
        day ? null : homeState(db, actor, today),
      ]);
      initial = JSON.parse(JSON.stringify(state)) as ClosingState;
      home = mine;
    } catch {
      initial = null;
      home = null;
    }
  }

  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewerOf(actor)} />
      <main id="inhalt" className="do-page do-page-narrow md">
        <AreaNav area="mine" />
        {day || !home ? (
          <>
            <h1 className="do-sr">Mein Tag</h1>
            <ClosingForm
              key={day ?? today}
              day={day ?? today}
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
          </>
        ) : (
          <DayHub home={home} closing={initial} today={today} />
        )}
      </main>
      <OperatorFooter showAdmin={isTeam(actor)} />
    </div>
  );
}
