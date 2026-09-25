import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getCurrentUser, isTeam, viewerOf } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { loadCommitmentSettings } from "@/server/settings";
import { discordDestination } from "@/server/discord";
import { defaultCommitmentSettings, type CommitmentSettings } from "@/lib/commitment";
import { ACTIVE_LOST_AFTER_IDLE, ACTIVE_MIN_ATTEMPTS, ACTIVE_RUN_DAYS } from "@/lib/active-caller";
import { tracks } from "@/lib/kpis";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "So funktioniert’s · Deal Operator",
  description:
    "Wie der Tagesabschluss, die Abschluss-Serie, aktive Calling-Tage und Leistungslevel funktionieren, und wer was sieht.",
};

const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const DAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** „Montag bis Freitag“ oder eine Aufzählung, aus den tatsächlichen Regeln. */
function callingDays(days: number[]) {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length >= 3 && contiguous)
    return `${DAY_NAMES[sorted[0] - 1]} bis ${DAY_NAMES[sorted.at(-1)! - 1]}`;
  const names = sorted.map((d) => DAY_NAMES[d - 1]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} und ${names.at(-1)}` : names[0] ?? "";
}
const clock = ({ hour, minute }: { hour: number; minute: number }) =>
  `${hour}:${String(minute).padStart(2, "0")} Uhr`;
const n = (v: number) => v.toLocaleString("de-DE");

/**
 * So funktioniert’s: öffentlich lesbar. Alle Regeln (Calling-Tage, Frist,
 * Erinnerungszeiten, Schwellen) kommen aus denselben Einstellungen und
 * Konstanten wie die App, damit die Erklärung nie von der Wirklichkeit
 * abweicht.
 */
export default async function Page() {
  const actor = await getCurrentUser().catch(() => null);
  let settings: CommitmentSettings = defaultCommitmentSettings;
  if (databaseReady()) {
    try {
      settings = await loadCommitmentSettings(database());
    } catch {
      settings = defaultCommitmentSettings;
    }
  }
  const signedIn = !!actor;
  const days = callingDays(settings.callingWeekdays);
  const deadline = `${settings.deadlineHour}:00 Uhr`;
  // Der Satz zum Freitag stimmt nur bei Calling-Tagen Montag bis Freitag.
  const weekdaysOnly = [1, 2, 3, 4, 5].every((d) => settings.callingWeekdays.includes(d)) &&
    !settings.callingWeekdays.some((d) => d > 5);
  const firstLevels = tracks.map((t) => t.thresholds[0]);
  const discord = discordDestination().url;

  return (
    <div className="operator-site">
      <OperatorHeader viewer={viewerOf(actor)} />
      <main id="inhalt" className="do-page hw">
        <header className="hw-head">
          <h1>So funktioniert’s</h1>
          <p>
            Deal Operator hält fest, was beim gemeinsamen Callen entsteht: deine Zahlen, deine
            Learnings und was alle zusammen schaffen. Kostenfrei.
          </p>
          <nav className="hw-jump" aria-label="Auf dieser Seite">
            <a href="#dein-tag">Dein Tag</a>
            <a href="#was-zaehlt">Was zählt</a>
            <a href="#sichtbarkeit">Wer sieht was</a>
            <a href="#fair">Fair gezählt</a>
            <a href="#discord">Discord</a>
          </nav>
        </header>

        <section className="hw-section" id="dein-tag" aria-labelledby="hw-day">
          <h2 id="hw-day">Dein Calling-Tag in drei Schritten</h2>
          <ol className="hw-steps">
            <li>
              <div className="hw-step-text">
                <h3>Callen</h3>
                <p>
                  Du callst wie gewohnt. Calling-Tage sind {days}; an anderen Tagen ist ein
                  Abschluss freiwillig.
                </p>
              </div>
              <div className="hw-visual hw-week" aria-hidden="true">
                {DAY_SHORT.map((d, i) => (
                  <span key={d} data-on={settings.callingWeekdays.includes(i + 1) || undefined}>
                    {d}
                  </span>
                ))}
              </div>
            </li>
            <li>
              <div className="hw-step-text">
                <h3>Tag abschließen</h3>
                <p>
                  Anwahlen, Settings und Closings eintragen, Energie wählen und zwei Fragen
                  beantworten: Was lief gut? Was machst du beim nächsten Calling-Tag besser?
                </p>
                <p className="hw-quiet">
                  Ein Entwurf speichert sich automatisch und zählt erst nach dem Einreichen.
                </p>
              </div>
              <div className="hw-visual hw-form" aria-hidden="true">
                <span>
                  <small>Anwahlen</small>
                  <b>64</b>
                </span>
                <span>
                  <small>Settings</small>
                  <b>2</b>
                </span>
                <span>
                  <small>Closings</small>
                  <b>0</b>
                </span>
                <em>Beispiel</em>
              </div>
            </li>
            <li>
              <div className="hw-step-text">
                <h3>Sehen, was entsteht</h3>
                <p>
                  Deine Zahlen zählen in der gemeinsamen Summe und in der Rangliste. Unter
                  Reflexionen liest du, was bei anderen funktioniert hat.
                </p>
              </div>
              <div className="hw-visual hw-rank" aria-hidden="true">
                {[1, 2, 2].map((place, i) => (
                  <span key={i} data-place={place}>
                    <b>{place}</b>
                    <i style={{ width: `${[92, 70, 70][i]}%` }} />
                  </span>
                ))}
                <em>Gleichstand, gleicher Platz</em>
              </div>
            </li>
          </ol>
          <Cta signedIn={signedIn} />
        </section>

        <section className="hw-section" id="was-zaehlt" aria-labelledby="hw-counts">
          <h2 id="hw-counts">Was wofür zählt</h2>
          <p className="hw-lead">
            Drei Dinge laufen nebeneinander. Jedes misst etwas anderes, keines ersetzt das andere.
          </p>
          <div className="hw-systems">
            <article id="serie">
              <div className="hw-key">
                <strong>bis {deadline}</strong>
                <span>am nächsten Calling-Tag</span>
              </div>
              <div>
                <h3>Abschluss-Serie</h3>
                <p>
                  Jeder rechtzeitige Tagesabschluss an einem Calling-Tag verlängert deine Serie,
                  auch mit 0 Anwahlen.
                  {weekdaysOnly ? ` Für Freitag bleibt also Zeit bis Montag, ${deadline}.` : ""}{" "}
                  Wochenenden und bestätigte Pausen unterbrechen die Serie nicht. Später
                  eingereicht zählen deine Zahlen trotzdem, nur die Serie nicht.
                </p>
              </div>
            </article>
            <article id="aktive-calling-tage">
              <div className="hw-key">
                <strong>{ACTIVE_RUN_DAYS} Tage am Stück</strong>
                <span>mit mindestens {ACTIVE_MIN_ATTEMPTS} Anwahlen</span>
              </div>
              <div>
                <h3>Aktive Calling-Tage</h3>
                <p>
                  Damit wirst du Aktiver Caller: Sessions und Roleplay stehen dir offen, im
                  Discord trägst du die gleichnamige Rolle. Nach {ACTIVE_LOST_AFTER_IDLE}{" "}
                  Calling-Tagen in Folge ohne Anwahlen ist der Rang wieder weg.
                </p>
              </div>
            </article>
            <article id="leistungslevel">
              <div className="hw-key">
                <strong>Level 1</strong>
                <span>ab {n(firstLevels[0])} Anwahlen</span>
              </div>
              <div>
                <h3>Leistungslevel</h3>
                <p>
                  Aus allen deinen Tagen, getrennt je Kennzahl: Level 1 gibt es ab{" "}
                  {n(firstLevels[0])} Anwahlen, {n(firstLevels[1])} Settings,{" "}
                  {n(firstLevels[2])} Closings oder dem ersten Deal. Dein Fortschritt steht in
                  echten Einheiten, zum Beispiel „40 von 100 Anwahlen“.
                </p>
              </div>
            </article>
          </div>
          {signedIn && (
            <Link className="do-link" href="/heute?modus=eigen">
              Mein Fortschritt ansehen
            </Link>
          )}
        </section>

        <section className="hw-section" id="sichtbarkeit" aria-labelledby="hw-who">
          <h2 id="hw-who">Wer sieht was</h2>
          <dl className="hw-who">
            <div>
              <dt>Alle</dt>
              <dd>
                Anzeigename, Firma, Rolle und deine Zahlen in Rangliste und gemeinsamer Summe,
                nur wenn du der öffentlichen Anzeige zustimmst.
              </dd>
            </div>
            <div>
              <dt>Angemeldete mit Profil und Telefonnummer</dt>
              <dd>
                Deine eingereichten Reflexionen: was gut lief, dein nächster Schritt, deine
                Energie. Zahlen stehen dort nur mit deiner Zustimmung. Dein Call-Profil, wenn du
                es bei den Call-Partnern zeigst.
              </dd>
            </div>
            <div>
              <dt>Nur das Team</dt>
              <dd>E-Mail-Adresse, Telefonnummer und dein Wunsch nach Unterstützung.</dd>
            </div>
            <div>
              <dt>Nur du</dt>
              <dd>Entwürfe, bis du sie einreichst.</dd>
            </div>
          </dl>
          <Link className="do-link" href="/datenschutz">
            Datenschutz
          </Link>
        </section>

        <section className="hw-section" id="fair" aria-labelledby="hw-fair">
          <h2 id="hw-fair">Fair gezählt</h2>
          <ul className="hw-rules">
            <li>
              <strong>Abschlüsse wiegen mehr als Anwahlen.</strong> Die Reihenfolge folgt dem
              Gesamterfolg des Tages aus Anwahlen, vereinbarten Settings und Closings und
              gewonnenen Deals; die Zahlen selbst stehen in jeder Zeile.
            </li>
            <li>
              <strong>0 ist eine Meldung, keine Meldung ist keine 0.</strong> Wer nichts meldet,
              steht in der Rangliste nicht.
            </li>
            <li>
              <strong>Gleichstände teilen sich einen Platz.</strong> Stehen drei Personen auf
              Platz 2, folgt Platz 5.
            </li>
            <li>
              <strong>Tag und Monat stehen getrennt.</strong> Der Verlauf zeigt jeden Tag einzeln,
              keine laufende Summe.
            </li>
            <li>
              <strong>Gemeinsame Meldungen zählen genau einmal.</strong> Sie bekommen keinen
              eigenen Platz; aufgeteilte Werte sind als zugeteilt gekennzeichnet.
            </li>
            <li>
              <strong>Ehrlich bei leeren Tagen.</strong> Ist für heute noch nichts gemeldet, zeigt
              die Startseite den letzten gemeldeten Tag und sagt das dazu.
            </li>
          </ul>
        </section>

        <section className="hw-section" aria-labelledby="hw-more">
          <h2 id="hw-more">Gut zu wissen</h2>
          <div className="hw-details">
            <details>
              <summary>Urlaub, Krankheit, Pause</summary>
              <p>
                Melde eine Pause unter Mein Fortschritt. Sobald das Team sie bestätigt, zählen
                diese Tage nicht, und deine Serie wartet. Eine Pause beginnt frühestens heute und
                dauert höchstens zwei Monate am Stück. Für vergangene Tage sprich das Team an.
              </p>
            </details>
            <details>
              <summary>Einen Tag nachtragen oder korrigieren</summary>
              <p>
                Unter Mein Tag wählst du einen anderen Tag. Nachgetragene Zahlen zählen in der
                Rangliste; für die Serie zählt nur, was rechtzeitig kam. Bei einer Korrektur gilt
                die eingereichte Fassung, bis du die neue vollständig einreichst. Fehlen mehrere
                Abschlüsse, fragt das Team kurz nach, ob alles passt.
              </p>
            </details>
            <details>
              <summary>Erinnerungen</summary>
              <p>
                Nur wenn du sie auf deinem Gerät einschaltest: um {clock(settings.eveningReminder)},
                falls dein Abschluss an einem Calling-Tag noch fehlt, und um{" "}
                {clock(settings.streakWarning)} am nächsten Calling-Tag vor Fristende. Geräte stellst
                du unter Profil und Einstellungen ein.
              </p>
            </details>
            <details>
              <summary>Deine Zahlen stehen schon in der Rangliste</summary>
              <p>
                Such deinen Namen in der Rangliste, tipp ihn an und wähle „Das sind meine
                Zahlen“. Nach der Prüfung durch das Team gehört das Profil mit allen bisherigen
                Tagen zu deinem Konto. Es entsteht kein zweites Profil.
              </p>
            </details>
          </div>
        </section>

        <section className="hw-section hw-discord" id="discord" aria-labelledby="hw-discord">
          <div>
            <h2 id="hw-discord">Zahlen hier, Calls im Discord</h2>
            <p>
              Tagesabschlüsse und Reflexionen bleiben auf dieser Website. Im Discord trefft ihr
              euch zu Sessions und Roleplay, findet Call-Partner und pusht euch gegenseitig.
              Aktive Caller tragen dort ihren Rang.
            </p>
          </div>
          <a className="do-button do-button-secondary" href={discord} target="_blank" rel="noopener noreferrer">
            Discord öffnen
            <ExternalLink size={16} aria-hidden="true" />
            <span className="do-sr">(neues Fenster)</span>
          </a>
        </section>

        <section className="hw-end" aria-label="Loslegen">
          <p>{signedIn ? "Bereit für heute?" : "Kostenfrei, ohne Verpflichtung."}</p>
          <Cta signedIn={signedIn} />
        </section>
      </main>
      <OperatorFooter discordUrl={discord} showAdmin={!!actor && isTeam(actor)} />
    </div>
  );
}

function Cta({ signedIn }: { signedIn: boolean }) {
  return signedIn ? (
    <div className="hw-cta">
      <Link className="do-button do-button-primary" href="/reflexionen">
        Zahlen eintragen
      </Link>
      <Link className="do-button do-button-secondary" href="/">
        Zu den Ergebnissen
      </Link>
    </div>
  ) : (
    <div className="hw-cta">
      <Link className="do-button do-button-primary" href="/starten?weg=neu">
        Kostenfrei starten
      </Link>
      <Link className="do-button do-button-secondary" href="/starten?weg=profil">
        Meine Zahlen sind schon hier
      </Link>
    </div>
  );
}
