import Link from "next/link";
import { getCurrentUser, isTeam, viewerOf } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { reflectionFeed } from "@/server/reflections";
import { closingState } from "@/server/closing";
import { homeState, type HomeState } from "@/server/home";
import { berlinDate } from "@/lib/kpis";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import AreaNav from "../features/area-nav";
import ReflectionGate from "../features/reflection-gate";
import type { ReflectionFeedData } from "../features/reflection-feed";
import type { ClosingState } from "../features/closing-form";
import "../commitment.css";

export const dynamic = "force-dynamic";

/**
 * Reflexionen: erst der eigene Tag, dann die anderen. Angemeldet mit
 * eigenem Profil steht hier zuerst das eigene Blatt für heute; nach dem
 * Einreichen die Beiträge des Tages. Ohne Anmeldung gibt es nur den kurzen
 * Nutzen und den direkten Weg hinein, keine Vorschau privater Inhalte.
 */
export default async function Page() {
  const actor = await getCurrentUser();
  const today = berlinDate();
  let home: HomeState | null = null;
  let feed: ReflectionFeedData | null = null;
  let closing: ClosingState | null = null;
  // Ohne Stand vom Server gilt der eigene Tag als offen: dann steht das eigene
  // Blatt (es lädt selbst und nennt einen Fehler ehrlich), nicht die anderen.
  let known = false;
  if (actor && databaseReady()) {
    try {
      const db = database();
      home = await homeState(db, actor, today);
      const status = home.today?.status ?? null;
      // Solange der eigene Tag offen ist, braucht es die Beiträge noch nicht;
      // sie laden nach dem Einreichen frisch, mit dem eigenen dabei.
      if (status === "open" || status === "draft")
        closing = JSON.parse(
          JSON.stringify(await closingState(db, actor, today.slice(0, 7))),
        ) as ClosingState;
      else
        feed = JSON.parse(JSON.stringify(await reflectionFeed(db, actor, {}))) as ReflectionFeedData;
      known = true;
    } catch {
      home = null;
      feed = null;
      closing = null;
    }
  }
  const viewer = viewerOf(actor);

  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewer} />
      <main id="inhalt" className="do-page do-page-narrow rf">
        {actor && <AreaNav area="exchange" />}
        <div className="do-page-head">
          <div>
            <h1>Reflexionen</h1>
            <p>Was bei anderen gut lief und was sie beim nächsten Calling-Tag besser machen.</p>
          </div>
        </div>

        {actor ? (
          <ReflectionGate
            closing={closing}
            feed={feed}
            today={today}
            due={known ? (home?.today?.due ?? false) : true}
            status={known ? (home?.today?.status ?? null) : "open"}
          />
        ) : (
          <section className="rf-gate" aria-labelledby="rf-gate-title">
            <h2 id="rf-gate-title">Lies mit, was bei anderen funktioniert.</h2>
            <p>
              Jeden Tag reichen Caller ihre Learnings ein: ein Einstieg, der Gespräche geöffnet
              hat, ein Einwand, der besser lief. Zum Lesen brauchst du ein kostenfreies Profil mit
              Telefonnummer.
            </p>
            <div className="rf-gate-actions">
              <Link className="do-button do-button-primary" href="/anmelden?next=%2Freflexionen">
                Anmelden und lesen
              </Link>
              <Link className="do-button do-button-secondary" href="/starten">
                Kostenfrei starten
              </Link>
            </div>
          </section>
        )}

        <details className="rf-rules">
          <summary>Wer liest mit, und wie entstehen Beiträge?</summary>
          <ul>
            <li>
              Lesen können alle Angemeldeten mit bestätigter E-Mail, Telefonnummer und eigenem
              Profil. Der eigene Tag kommt zuerst: An Calling-Tagen erscheinen die Beiträge der
              anderen, sobald der eigene Tagesabschluss eingereicht ist.
            </li>
            <li>
              Ein Beitrag entsteht nur aus einem vollständig eingereichten Tagesabschluss. Entwürfe
              und übernommene Zahlen erscheinen hier nicht.
            </li>
            <li>
              Auf jeder Karte stehen die eingereichten Zahlen. Unterstützungswünsche sieht nur das
              Team.
            </li>
            <li>
              Antworten geht über Discord, mit dem Knopf an jeder Karte. Hier gibt es kein
              Antwortfeld.
            </li>
          </ul>
        </details>
      </main>
      <OperatorFooter showAdmin={isTeam(actor)} />
    </div>
  );
}
