import type { Metadata } from "next";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";

export const metadata: Metadata = {
  title: "Datenschutz · Deal Operator",
  description:
    "Welche Daten Deal Operator verarbeitet, auf welcher Grundlage und wer sie sieht.",
  alternates: { canonical: "/datenschutz" },
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
            lief, nächster Schritt) ist unter „Mein Tag“ für angemeldete
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
          <p>
            Sobald der Betreiber sie freischaltet, kannst du zu einem Tag freiwillig die
            Gesprächszeit laut deinem CRM und einen Screenshot (Anwahlen und Gesprächszeit)
            speichern. Das Bild wird im Browser verkleinert und ohne Metadaten gespeichert.
            Sehen können es nur du und das Team, es erscheint weder in der Rangliste noch im
            Austausch. Decke Namen und Nummern deiner Kontakte vor dem Hochladen ab. Du kannst
            den Screenshot jederzeit entfernen; nach 62 Tagen wird er automatisch gelöscht, die
            Gesprächszeit bleibt. Daraus ergibt sich dein Monatsstand unter Fortschritt.
          </p>
        </section>

        <section>
          <h2>7. Cookies</h2>
          <p>
            Ohne deine Einwilligung werden nur technisch erforderliche Cookies
            gesetzt: die Sitzung nach der Anmeldung und eine Anzeigeeinstellung
            der Oberfläche. Deine Entscheidung im Cookie-Banner wird sechs
            Monate im Browser gespeichert (<code>hk_consent</code>).
          </p>
        </section>

        <section>
          <h2>8. Meta-Pixel und Google Ads (nur mit Einwilligung)</h2>
          <p>
            Wenn du im Cookie-Banner „Alle akzeptieren“ wählst, binden wir das
            Meta-Pixel (Meta Platforms Ireland Ltd., Merrion Road, Dublin 4,
            Irland) und den Google-Tag für Google Ads (Google Ireland Ltd.,
            Gordon House, Barrow Street, Dublin 4, Irland) ein. Beide setzen
            Cookies (unter anderem <code>_fbp</code>, <code>_fbc</code>,{" "}
            <code>_gcl_au</code>) und übermitteln deine IP-Adresse, Browserdaten,
            die aufgerufenen Seiten und Ereignisse wie den Abschluss der
            Anmeldung oder den Klick auf unsere Telefonnummer. Meta und Google
            nutzen diese Daten, um die Wirkung unserer Anzeigen zu messen und
            Anzeigen auf deine Interessen abzustimmen; dabei können Daten in die
            USA übermittelt werden. Beide Anbieter sind nach dem EU-US Data
            Privacy Framework zertifiziert.
          </p>
          <p>
            Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO,
            § 25 Abs. 1 TDDDG). Ohne Einwilligung werden diese Dienste nicht
            geladen und keine Cookies gesetzt. Du kannst die Einwilligung
            jederzeit mit Wirkung für die Zukunft über „Cookie-Einstellungen“ im
            Fußbereich widerrufen. Weitere Informationen:{" "}
            <a href="https://www.facebook.com/privacy/policy/" rel="noopener noreferrer" target="_blank">
              Datenschutzrichtlinie von Meta
            </a>
            ,{" "}
            <a href="https://policies.google.com/privacy" rel="noopener noreferrer" target="_blank">
              Datenschutzerklärung von Google
            </a>
            .
          </p>
        </section>

        <section>
          <h2>9. Gemeinsame Calls</h2>
          <p>Gemeinsame Calls und Roleplays verlinken auf Google Meet. Beim Öffnen des Call-Links verlassen Sie die Website. Für die Verarbeitung im Call gilt die Datenschutzerklärung des jeweiligen Anbieters. Die Website überträgt keine E-Mail-Adresse oder Telefonnummer über den Call-Link.</p>
          <p>Eine bestehende Discord-Anbindung wird ausschließlich intern durch das Team verwaltet. Für Call-Partner, Zusagen und gemeinsame Calls ist kein Discord-Konto erforderlich.</p>
        </section>

        <section>
          <h2>10. Speicherdauer</h2>
          <p>
            Konto- und Zahlendaten bleiben gespeichert, solange das Konto
            besteht. Auf Wunsch werden Konto und zugehörige Daten gelöscht,
            soweit keine gesetzliche Aufbewahrungspflicht entgegensteht.
          </p>
        </section>

        <section>
          <h2>11. Deine Rechte</h2>
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
