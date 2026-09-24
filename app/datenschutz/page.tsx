import type { Metadata } from "next";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";

export const metadata: Metadata = {
  title: "Datenschutz · Deal Operator",
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
            technische Sitzungsdaten. Das Passwort legst du selbst fest; es
            wird nur als sicherer Hashwert beim Anmeldedienst (Supabase)
            gespeichert, nie im Klartext und nicht bei uns. Die Anmeldung
            erfolgt mit E-Mail und Passwort; eine Mail mit einmaligem Link
            gibt es nur zur Bestätigung der Adresse und wenn das Passwort
            vergessen wurde.
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
          <h2>6. Gemeldete Zahlen, Reflexionen und öffentliche Rangliste</h2>
          <p>
            Im persönlichen Bereich lassen sich Tageszahlen, persönliche Ziele und
            Reflexionen festhalten. E-Mail-Adressen, Telefonnummern, Notizen und
            Entwürfe sind privat, Unterstützungswünsche sieht nur das Team. Nichts
            davon erscheint in der öffentlichen Rangliste.
          </p>
          <p>
            Ein eingereichter Tagesabschluss (Anzeigename, Tag, Energie, was gut
            lief, nächster Schritt) ist unter „Reflexionen“ für angemeldete
            Nutzer sichtbar, die ihre E-Mail bestätigt, ein eigenes Profil
            angelegt und eine Telefonnummer hinterlegt haben, mit den Zahlen des
            Tages. Darauf weist das Formular vor dem ersten Einreichen hin.
          </p>
          <p>
            Die Teilnahme besteht darin, die eigenen Tageszahlen in die
            gemeinsame Rangliste einzubringen. Mit dem Anlegen oder Übernehmen
            eines Profils stehen deshalb Anzeigename, Firma und Rolle, die
            gemeldeten Kennzahlen mit Meldedatum sowie in der
            Dranbleiben-Übersicht die Serie und die Zahl aktiver und
            abgeschlossener Tage in der öffentlichen Rangliste; darauf weist
            das Profilformular hin. Eine Anzeige nur für dich gibt es nicht.
            Wer nicht mehr in der Rangliste stehen möchte, wendet sich an das
            Team; das Profil wird dann entfernt. Rechtsgrundlage ist Art. 6
            Abs. 1 lit. b DSGVO (Teilnahme an der Rangliste).
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
            Sobald der Betreiber sie eingerichtet hat, gilt: Für jede Session
            legt die Website im Discord einen Raum und ein Event an (Titel,
            Format, Zeit, Dauer, Plätze und der Anzeigename der Person, die
            sie anbietet). Freiwillig kannst du dein Discord-Konto verknüpfen
            (gespeichert werden Discord-ID und Discord-Name); dann bekommst
            du im Discord die Ränge „Aktiver Caller“ und, im Team,
            „Moderator“. Zeigst du zusätzlich dein Call-Profil bei den
            Call-Partnern, sehen angemeldete Mitglieder dort einen Link zu
            deinem Discord-Profil und, falls du ihn im Call-Profil einträgst,
            deinen Discord-Namen, um dich anzuschreiben. Admins und
            Moderatoren sehen alle Call-Profile, auch nicht gezeigte, um
            Call-Partner und Sessions zu vermitteln. Tagesabschlüsse,
            Reflexionen, Zahlen und Kontaktdaten werden <strong>nicht</strong>{" "}
            an Discord übertragen.
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
