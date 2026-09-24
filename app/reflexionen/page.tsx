import Link from "next/link";
import { getCurrentUser, isTeam, viewerOf } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { reflectionFeed } from "@/server/reflections";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import AreaNav from "../features/area-nav";
import ReflectionFeed, { type ReflectionFeedData } from "../features/reflection-feed";
import "../commitment.css";

export const dynamic = "force-dynamic";

/**
 * Reflexionen der anderen. Wer lesen darf, sieht sie sofort; die Regeln sind
 * eingeklappt. Ohne Anmeldung gibt es nur den kurzen Nutzen und den direkten
 * Weg hinein, keine Vorschau privater Inhalte.
 */
export default async function Page() {
  const actor = await getCurrentUser();
  let initial: ReflectionFeedData | null = null;
  if (actor && databaseReady()) {
    try {
      initial = JSON.parse(
        JSON.stringify(await reflectionFeed(database(), actor, {})),
      ) as ReflectionFeedData;
    } catch {
      initial = null;
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
          <ReflectionFeed initial={initial} />
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
              Profil.
            </li>
            <li>
              Ein Beitrag entsteht nur aus einem vollständig eingereichten Tagesabschluss. Entwürfe
              und übernommene Zahlen erscheinen hier nicht.
            </li>
            <li>
              Zahlen stehen nur auf Karten von Personen, die der öffentlichen Anzeige zugestimmt
              haben. Unterstützungswünsche sieht nur das Team.
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
