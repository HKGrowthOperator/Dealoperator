import Link from "next/link";
import type { Metadata } from "next";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import { SITE_URL, ORGANIZATION_ID } from "@/lib/site";

export const metadata: Metadata = {
  title: "Für wen ist Deal Operator? Sales-Community für Caller",
  description:
    "Kostenfreie Sales-Community fürs gemeinsame Callen: Calling-Routine mit Tagesabschluss, Serie und Rangliste. Für Opener, Setter, Closer und Selbstständige.",
  alternates: { canonical: "/fuer-wen" },
};

const FAQ: [string, string][] = [
  [
    "Was kostet Deal Operator?",
    "Nichts. Deal Operator ist kostenfrei, ohne Testphase und ohne Paket dahinter. HK Growth aus Marienheide bei Köln betreibt die Community, weil wir selbst callen und aus der gleichen Vertriebsarbeit die Sales-App DealUno entwickelt haben.",
  ],
  [
    "Ist Deal Operator eine Kaltakquise-Challenge?",
    "Eine dauerhafte: Jeder rechtzeitige Tagesabschluss an einem Calling-Tag verlängert deine Serie, deine Zahlen zählen in der Rangliste und in der gemeinsamen Summe, und mit genug aktiven Calling-Tagen wirst du Aktiver Caller. Es gibt keinen Endtermin, nur den nächsten Calling-Tag.",
  ],
  [
    "Muss ich jeden Tag callen?",
    "Nein. Es gibt feste Calling-Tage; an anderen Tagen ist ein Abschluss freiwillig. Auch ein Tag mit null Anwahlen zählt für die Serie, wenn du ihn rechtzeitig abschließt. Pausen, die du vorher einträgst, unterbrechen die Serie nicht.",
  ],
  [
    "Wer sieht meine Zahlen?",
    "Die Rangliste zeigt deine Platzierung und Kennzahlen den anderen Mitgliedern, deine Reflexionen bleiben in deinem Bereich und für die Runde, mit der du sie teilst. Was genau wer sieht, steht unter „So funktioniert’s“.",
  ],
  [
    "Was ist der Unterschied zu DealUno?",
    "Deal Operator ist die Community und die Routine: Zahlen festhalten, dranbleiben, austauschen. DealUno ist die Sales-App und das CRM für Teams: Lead Radar, Anrufsession mit Power Dialer, Vertriebsprozess. Viele nutzen beides, nötig ist es nicht.",
  ],
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${SITE_URL}/fuer-wen#webpage`,
      url: `${SITE_URL}/fuer-wen`,
      name: "Für wen ist Deal Operator?",
      inLanguage: "de-DE",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#app` },
      publisher: { "@id": ORGANIZATION_ID },
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/fuer-wen#faq`,
      mainEntity: FAQ.map(([question, answer]) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
  ],
};

/**
 * Öffentliche Seite für die Suche nach „Sales Community“, „Cold Calling
 * Community“, „Kaltakquise Challenge“ und „Setter Closer Community“. Erklärt,
 * für wen Deal Operator gedacht ist, und führt zu /starten. Zahlen zu
 * Calling-Tagen und Schwellen stehen bewusst nicht hier, sondern unter
 * /so-funktionierts, wo sie aus den echten Einstellungen kommen.
 */
export default function Page() {
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main id="inhalt" className="do-page hw">
        <header className="hw-head">
          <h1>Für wen ist Deal Operator?</h1>
          <p>
            Für alle, die im Vertrieb telefonieren und wissen, dass Dranbleiben das eigentliche
            Problem ist. Deal Operator ist die kostenfreie Sales-Community fürs gemeinsame Callen:
            eine Cold-Calling-Routine mit Tagesabschluss, Serie, Rangliste und einer gemeinsamen Übungsrunde,
            die Fragen beantwortet, bevor der nächste Anruf ansteht.
          </p>
          <nav className="hw-jump" aria-label="Auf dieser Seite">
            <a href="#rollen">Rollen</a>
            <a href="#routine">Routine</a>
            <a href="#challenge">Challenge</a>
            <a href="#fragen">Fragen</a>
          </nav>
        </header>

        <section className="hw-section" id="rollen" aria-labelledby="hw-roles">
          <h2 id="hw-roles">Vier Gruppen, ein Calling-Tag</h2>
          <div className="hw-systems">
            <article>
              <div className="hw-key">
                <strong>Opener</strong>
                <span>Anwahlen zählen</span>
              </div>
              <div>
                <h3>Opener und Caller</h3>
                <p>
                  Du machst die erste Anwahl und hörst das erste Nein. Hier siehst du deine
                  Anwahlen gegen die der anderen, lernst aus ihren Reflexionen und hast jeden
                  Calling-Tag einen Grund, den Hörer zu heben.
                </p>
              </div>
            </article>
            <article>
              <div className="hw-key">
                <strong>Setter</strong>
                <span>Settings zählen</span>
              </div>
              <div>
                <h3>Setter</h3>
                <p>
                  Du qualifizierst und setzt Termine. Settings sind deine Kennzahl, Level gibt es
                  dafür getrennt. In Sessions und Roleplays übst du Einwände mit Leuten, die das
                  Gleiche machen.
                </p>
              </div>
            </article>
            <article>
              <div className="hw-key">
                <strong>Closer</strong>
                <span>Closings und Deals</span>
              </div>
              <div>
                <h3>Closer</h3>
                <p>
                  Du schließt ab. Closings und der erste Deal zählen für dein Level; was beim
                  Abschluss funktioniert hat, hältst du in zwei Sätzen fest, damit es die anderen
                  lesen.
                </p>
              </div>
            </article>
            <article>
              <div className="hw-key">
                <strong>Selbstständig</strong>
                <span>alle drei Rollen</span>
              </div>
              <div>
                <h3>Selbstständige, Gründer, kleine Teams</h3>
                <p>
                  Du machst Akquise neben allem anderen und hast niemanden, der dich fragt, ob du
                  heute gecallt hast. Die Community übernimmt das: Serie, Rangliste und Call-Partner
                  ersetzen das Vertriebsteam, das du nicht hast.
                </p>
              </div>
            </article>
          </div>
        </section>

        <section className="hw-section" id="routine" aria-labelledby="hw-routine">
          <h2 id="hw-routine">Die Cold-Calling-Routine</h2>
          <ol className="hw-steps">
            <li>
              <div className="hw-step-text">
                <h3>Callen wie gewohnt</h3>
                <p>
                  Deal Operator ersetzt kein Telefon und kein CRM. Du callst mit deinen Werkzeugen,
                  an den Calling-Tagen der Community oder an jedem anderen Tag.
                </p>
              </div>
            </li>
            <li>
              <div className="hw-step-text">
                <h3>Tagesabschluss in zwei Minuten</h3>
                <p>
                  Anwahlen, Settings, Closings eintragen, Energie wählen, zwei Fragen beantworten:
                  Was lief gut? Was machst du beim nächsten Calling-Tag besser?
                </p>
              </div>
            </li>
            <li>
              <div className="hw-step-text">
                <h3>Dranbleiben, weil andere es sehen</h3>
                <p>
                  Deine Zahlen zählen in der gemeinsamen Summe und in der Rangliste. Unter Mein Tag
                  liest du, was bei anderen funktioniert hat. Mit einem Call-Partner übst du, was noch nicht klappt.
                </p>
              </div>
            </li>
          </ol>
          <p className="hw-cta">
            <Link className="do-button do-button-primary" href="/starten">
              Kostenfrei mitmachen
            </Link>
            <Link className="do-button do-button-secondary" href="/so-funktionierts">
              So funktioniert’s im Detail
            </Link>
          </p>
        </section>

        <section className="hw-section" id="challenge" aria-labelledby="hw-challenge">
          <h2 id="hw-challenge">Die Challenge, die nicht endet</h2>
          <div className="hw-systems">
            <article>
              <div className="hw-key">
                <strong>Serie</strong>
                <span>Tag für Tag</span>
              </div>
              <div>
                <h3>Serie</h3>
                <p>
                  Jeder rechtzeitige Tagesabschluss an einem Calling-Tag verlängert deine Serie,
                  auch mit null Anwahlen. Eingetragene Pausen unterbrechen sie nicht.
                </p>
              </div>
            </article>
            <article>
              <div className="hw-key">
                <strong>Rangliste</strong>
                <span>fair gezählt</span>
              </div>
              <div>
                <h3>Rangliste</h3>
                <p>
                  Gleichstand ist gleicher Platz. Die Rangliste zeigt, wer dranbleibt, nicht nur, wer
                  die größte Liste hat.
                </p>
              </div>
            </article>
            <article>
              <div className="hw-key">
                <strong>Level</strong>
                <span>je Kennzahl</span>
              </div>
              <div>
                <h3>Leistungslevel und Aktiver Caller</h3>
                <p>
                  Level gibt es getrennt für Anwahlen, Settings, Closings und Deals. Wer genug
                  Calling-Tage am Stück aktiv ist, wird Aktiver Caller. Calls und Roleplay stehen unabhängig davon allen offen.
                </p>
              </div>
            </article>
          </div>
        </section>

        <section className="hw-section" id="fragen" aria-labelledby="hw-faq">
          <h2 id="hw-faq">Häufige Fragen</h2>
          <div className="hw-details">
            {FAQ.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
          <p className="hw-cta">
            <Link className="do-button do-button-primary" href="/starten">
              Kostenfrei mitmachen
            </Link>
            <a className="do-button do-button-secondary" href="https://dealuno.hk-growthoperator.de/">
              DealUno für Teams ansehen
            </a>
          </p>
        </section>
      </main>
      <OperatorFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
      />
    </div>
  );
}
