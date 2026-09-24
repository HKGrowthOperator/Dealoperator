import Link from "next/link";
import { Eye, PenLine, MessageCircle } from "lucide-react";
import { getCurrentUser, isTeam } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { reflectionFeed } from "@/server/reflections";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import ReflectionFeed, { type ReflectionFeedData } from "../features/reflection-feed";
import "../commitment.css";

export const dynamic = "force-dynamic";

/**
 * Austausch der Reflexionen. Ohne Anmeldung nur die Erklärung, wer mitliest
 * und wie Beiträge entstehen; die Karten selbst lesen verifizierte Mitglieder.
 * Öffentliche Zahlen bleiben ohne Anmeldung im Ranking sichtbar.
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

  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="cm-page">
        <div className="cm-page-head">
          <p className="cm-kicker">AUSTAUSCH</p>
          <h1>Reflexionen</h1>
          <p>
            Echte Tagesabschlüsse: was gut lief und was beim nächsten Calling-Tag besser werden
            soll. Zum Mitlesen, Lernen und Antworten.
          </p>
        </div>

        <div className="cm-explain">
          <section className="cm-card">
            <h2>
              <Eye size={18} aria-hidden="true" /> Wer liest mit?
            </h2>
            <p>
              Lesen können alle Angemeldeten mit bestätigter E-Mail, hinterlegter Telefonnummer und
              eigenem Profil.
            </p>
            <p>
              Zahlen stehen nur auf den Karten von Personen, die der öffentlichen Anzeige
              zugestimmt haben.
            </p>
          </section>
          <section className="cm-card">
            <h2>
              <PenLine size={18} aria-hidden="true" /> Wie entstehen Beiträge?
            </h2>
            <p>
              Ein Beitrag erscheint nur, wenn jemand seinen Tagesabschluss vollständig einreicht:
              Zahlen, Energie und beide Reflexionsfragen. Entwürfe, ältere private Reflexionen und
              übernommene Zahlen erscheinen hier nicht. Unterstützungswünsche gehen nur an das
              Team.
            </p>
            <p>
              <MessageCircle size={15} aria-hidden="true" /> Antworten ist optional und geht über
              Discord, mit dem Knopf an jeder Karte. Hier gibt es bewusst kein Antwortfeld.
            </p>
          </section>
        </div>

        {actor ? (
          <>
            <div className="cm-page-links">
              <Link href="/tagesabschluss">Eigenen Tagesabschluss einreichen</Link>
            </div>
            <ReflectionFeed initial={initial} />
          </>
        ) : (
          <section className="cm-card cm-signin">
            <h2>Melde dich an, um die Reflexionen zu lesen.</h2>
            <p>
              Mit einem eigenen Profil und hinterlegter Telefonnummer liest du hier mit und
              reichst deinen eigenen Tagesabschluss ein.
            </p>
            <div className="cm-actions">
              <Link className="btn primary" href="/anmelden?next=%2Freflexionen">
                Anmelden
              </Link>
              <Link className="btn secondary" href="/starten">
                Registrieren
              </Link>
            </div>
            <p className="cm-muted">
              Die öffentlichen Zahlen siehst du auch ohne Anmeldung im{" "}
              <Link className="cm-link" href="/">
                Ranking auf der Startseite
              </Link>
              .
            </p>
          </section>
        )}
      </main>
      <OperatorFooter showAdmin={isTeam(actor)} />
    </div>
  );
}
