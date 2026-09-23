import type { Metadata } from "next";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";

export const metadata: Metadata = {
  title: "Datenschutz — Deal Operator",
  description:
    "Welche Daten Deal Operator verarbeitet, auf welcher Grundlage und wer sie sieht.",
};

/**
 * Aufbau und Umfang wie auf hk-growthoperator.de/datenschutz. Die Inhalte sind
 * bewusst NICHT übernommen: die Hauptseite beschreibt Netlify, Netlify Forms,
 * Prozess-Check und ROI-Rechner. Deal Operator läuft auf einem anderen Stack.
 * Eine abgeschriebene Erklärung wäre schlicht falsch, deshalb beschreibt diese
 * Seite die tatsächliche Verarbeitung dieser Anwendung.
 */
export default function Page() {
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="legal-layout">
        <span className="section-kicker">DATENSCHUTZ</span>
        <h1>Datenschutz</h1>
        <p className="legal-lead">
          Deal Operator ist ohne Analytics, ohne Marketing-Tracking und ohne
          externe Schriftanbieter gebaut. Schriften werden von diesem Server
          ausgeliefert.
        </p>

        <section>
          <h2>1. Verantwortlicher</h2>
          <p>
            HK Growth UG (haftungsbeschränkt)
            <br />
            Weststraße 2
            <br />
            51709 Marienheide
            <br />
            Deutschland
            <br />
            E-Mail:{" "}
            <a href="mailto:info@hk-growthoperator.de">
              info@hk-growthoperator.de
            </a>
            <br />
            Telefon: <a href="tel:+491754547011">0175 4547011</a>
          </p>
        </section>

        <section>
          <h2>2. Bereitstellung der Website</h2>
          <p>
            Die Website läuft auf einem Server bei der Hetzner Online GmbH,
            Industriestr. 25, 91710 Gunzenhausen, Deutschland. Beim Abruf fallen
            technisch erforderliche Verbindungs- und Protokolldaten an,
            insbesondere IP-Adresse, Zeitpunkt der Anfrage, aufgerufene
            Ressource sowie Browser- und Geräteinformationen.
          </p>
          <p>
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte
            Interesse liegt im sicheren und zuverlässigen Betrieb.
          </p>
        </section>

        <section>
          <h2>3. Anmeldung und Konto</h2>
          <p>
            Anmeldung und Konten laufen über Supabase (Supabase Inc.). Die
            Datenbank dieses Projekts liegt in der Region Europa (Frankfurt).
            Verarbeitet werden E-Mail-Adresse, Zeitpunkt der Bestätigung und
            technische Sitzungsdaten. Es gibt kein Passwort: die Anmeldung
            erfolgt über einen einmaligen Link per E-Mail.
          </p>
          <p>
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO für die Nutzung des
            persönlichen Bereichs. Soweit Supabase Daten im Auftrag verarbeitet,
            geschieht das auf Grundlage eines Auftragsverarbeitungsvertrags.
          </p>
        </section>

        <section>
          <h2>4. Versand der Anmelde-E-Mails</h2>
          <p>
            Der Versand der Bestätigungs- und Anmeldemails erfolgt über Resend
            (Resend, Inc.). Übermittelt werden die E-Mail-Adresse und der Inhalt
            der jeweiligen Nachricht. Ein Link-Tracking findet nicht statt.
          </p>
          <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>
        </section>

        <section>
          <h2>5. Profilübernahme</h2>
          <p>
            Wer ein vorbereitetes Profil übernehmen möchte, gibt Vor- und
            Nachnamen, E-Mail-Adresse, Telefonnummer und optional eine
            Zuordnungshilfe an. Diese Angaben dienen ausschließlich dazu, die
            Person eindeutig zuzuordnen, bevor ein bestehender Zahlenstand
            freigegeben wird. Sie sind nur für die antragstellende Person selbst
            und für die Verwaltung sichtbar.
          </p>
          <p>
            Die Telefonnummer wird ausschließlich angegeben und{" "}
            <strong>nicht per SMS verifiziert</strong>. Rechtsgrundlage ist Art.
            6 Abs. 1 lit. b DSGVO, ergänzend Art. 6 Abs. 1 lit. f DSGVO: das
            berechtigte Interesse liegt darin, fremde Übernahmen zu verhindern.
          </p>
        </section>

        <section>
          <h2>6. Gemeldete Zahlen, Reflexionen und öffentliches Ranking</h2>
          <p>
            Im persönlichen Bereich lassen sich Tageszahlen, persönliche Ziele und
            Reflexionen festhalten. E-Mail-Adressen, Telefonnummern, Notizen und
            Entwürfe sind privat, Unterstützungswünsche sieht nur das Team. Nichts
            davon erscheint im öffentlichen Ranking.
          </p>
          <p>
            Ein eingereichter Tagesabschluss (Anzeigename, Tag, Energie, was gut
            lief, nächster Schritt) ist unter „Reflexionen“ für angemeldete
            Nutzer sichtbar, die ihre E-Mail bestätigt, ein eigenes Profil
            angelegt und eine Telefonnummer hinterlegt haben. Die Zahlen des
            Tages stehen dort nur bei gewählter öffentlicher Anzeige. Darauf weist
            das Formular vor dem Einreichen hin.
          </p>
          <p>
            Öffentlich sichtbar sind nur bei gewählter öffentlicher Anzeige:
            Anzeigename, Firma und Rolle, die freigegebenen Kennzahlen mit
            Meldedatum sowie in der Übersicht der Serien die Calling- und
            Reflexions-Serie und die Zahl aktiver und abgeschlossener Tage. Die
            Veröffentlichung wird getrennt gewählt und lässt sich jederzeit
            widerrufen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. a DSGVO.
          </p>
        </section>

        <section>
          <h2>7. Cookies</h2>
          <p>
            Es werden nur technisch erforderliche Cookies gesetzt: die Sitzung
            nach der Anmeldung und eine Anzeigeeinstellung der Oberfläche.
            Analyse- oder Werbe-Cookies gibt es nicht.
          </p>
        </section>

        <section>
          <h2>8. Discord</h2>
          <p>
            Die Website verlinkt auf einen Discord-Server. Discord ist ein
            eigenständiger Dienst der Discord Netherlands B.V. Mit dem Aufruf
            des Links gilt deren Datenschutzerklärung.
          </p>
          <p>
            Sobald der Betreiber sie eingerichtet hat, gibt es zwei freiwillige
            Zusatzfunktionen: Du kannst dein Discord-Konto verknüpfen
            (gespeichert werden Discord-ID und Discord-Name), und du kannst
            einen eingereichten Tagesabschluss zusätzlich im Discord-Channel
            teilen (Anzeigename, Tag, Energie, was gut lief, nächster Schritt,
            Zahlen nur bei öffentlicher Anzeige, Unterstützungswünsche nie).
            Dort liest jede Person mit, die auf dem Server ist. Ohne diese
            ausdrückliche Wahl werden{" "}
            <strong>keine</strong> Daten an Discord übertragen.
          </p>
        </section>

        <section>
          <h2>9. Speicherdauer</h2>
          <p>
            Konto- und Zahlendaten bleiben gespeichert, solange das Konto
            besteht. Auf Wunsch werden Konto und zugehörige Daten gelöscht,
            soweit keine gesetzliche Aufbewahrungspflicht entgegensteht.
          </p>
        </section>

        <section>
          <h2>10. Deine Rechte</h2>
          <p>
            Es bestehen die Rechte auf Auskunft (Art. 15), Berichtigung (Art.
            16), Löschung (Art. 17), Einschränkung (Art. 18),
            Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21 DSGVO). Eine
            erteilte Einwilligung kann jederzeit mit Wirkung für die Zukunft
            widerrufen werden. Dafür genügt eine Nachricht an{" "}
            <a href="mailto:info@hk-growthoperator.de">
              info@hk-growthoperator.de
            </a>
            .
          </p>
          <p>
            Außerdem besteht ein Beschwerderecht bei einer
            Datenschutz-Aufsichtsbehörde.
          </p>
        </section>
      </main>
      <OperatorFooter />
    </div>
  );
}
