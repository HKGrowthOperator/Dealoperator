import type { Metadata } from "next";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";

export const metadata: Metadata = {
  title: "Impressum — Deal Operator",
  description: "Anbieterkennzeichnung nach § 5 DDG.",
};

/**
 * Aufbau und Umfang bewusst wie auf hk-growthoperator.de/impressum. Die
 * Angaben zur Gesellschaft sind von dort übernommen; die Registerangabe ist
 * dort ebenfalls noch offen und bleibt es hier, statt sie zu erfinden.
 */
export default function Page() {
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="legal-layout">
        <span className="section-kicker">ANBIETERKENNZEICHNUNG</span>
        <h1>Impressum</h1>
        <p className="legal-lead">Angaben gemäß § 5 DDG.</p>

        <section>
          <h2>Anbieter</h2>
          <p>
            HK Growth UG (haftungsbeschränkt)
            <br />
            Weststraße 2
            <br />
            51709 Marienheide
            <br />
            Deutschland
          </p>
        </section>

        <section>
          <h2>Kontakt</h2>
          <p>
            Telefon: <a href="tel:+491754547011">0175 4547011</a>
            <br />
            E-Mail:{" "}
            <a href="mailto:info@hk-growthoperator.de">
              info@hk-growthoperator.de
            </a>
          </p>
        </section>

        <section>
          <h2>Vertretung und Register</h2>
          <p>
            Vertretungsberechtigte Geschäftsführer:
            <br />
            Luis Kummer
            <br />
            Nick Hinze
          </p>
          <p>
            Registergericht / Handelsregisternummer:{" "}
            <span className="legal-todo">
              [REGISTERGERICHT + HRB EINSETZEN]
            </span>
          </p>
          <p>
            Eine Umsatzsteuer-Identifikationsnummer wird hier ergänzt, sobald
            eine solche Nummer für die Gesellschaft tatsächlich erteilt und für
            die Anbieterkennzeichnung anzugeben ist.
          </p>
        </section>

        <section>
          <h2>Angebot</h2>
          <p>
            Deal Operator ist eine kostenfreie Community für aktive Caller.
            Angaben auf dieser Website beschreiben gemeldete Aktivität und
            ersetzen keine individuelle Rechts-, Steuer- oder
            Datenschutzberatung.
          </p>
        </section>

        <p className="legal-foot">
          Rechtsgrundlage der Anbieterkennzeichnung: § 5 Digitale-Dienste-Gesetz
          (DDG).
        </p>
      </main>
      <OperatorFooter />
    </div>
  );
}
