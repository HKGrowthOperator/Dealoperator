import type { Metadata, Viewport } from "next";
import { ORGANIZATION_ID, SITE_URL } from "@/lib/site";
import "./globals.css";
import "./operator-brand.css";
import "./operator-glass.css";
import "./ranking.css";
import "./ui.css";

const TITLE = "Deal Operator – Kostenfreie Sales-Community fürs gemeinsame Callen";
const DESCRIPTION =
  "Deal Operator ist die kostenfreie Sales-Community von HK Growth fürs gemeinsame Callen: Kaltakquise-Zahlen und Learnings an jedem Calling-Tag festhalten, Rangliste und Fortschritt sehen, dranbleiben. Mit Discord-Runde.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Deal Operator",
  title: TITLE,
  description: DESCRIPTION,
  icons: { icon: "/favicon.svg" },
  openGraph: {
    type: "website",
    locale: "de_DE",
    siteName: "Deal Operator",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Deal Operator" }],
  },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION, images: ["/icon-512.png"] },
};

// Auf Android verkleinert die Bildschirmtastatur die Seite, statt Knöpfe und
// Fehlermeldungen in Formularen zu verdecken.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

// Eine Organisation für alle Seiten der Gruppe: hk-growthoperator.de,
// DealUno, Webstudio und diese Seite verweisen auf dieselbe @id, damit Google
// Deal Operator als Angebot von HK Growth erkennt und nicht als fremde Firma.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: "HK Growth UG (haftungsbeschränkt)",
      alternateName: ["HK Growth Operator", "HK Growth"],
      url: "https://hk-growthoperator.de/",
      logo: "https://hk-growthoperator.de/assets/brand/hk-growth-operator-logo-tight.png",
      sameAs: ["https://www.instagram.com/hkgrowthoperator/"],
    },
    {
      "@type": "Brand",
      "@id": `${SITE_URL}/#brand`,
      name: "Deal Operator",
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/icon-512.png`,
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: "Deal Operator",
      alternateName: "Deal Operator Sales-Community",
      url: `${SITE_URL}/`,
      image: `${SITE_URL}/icon-512.png`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      inLanguage: "de-DE",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: DESCRIPTION,
      featureList: [
        "Tagesabschluss mit Anwahlen, Settings, Closings und Deals",
        "Öffentliche Rangliste und Monatsverlauf",
        "Serie und Leistungslevel fürs Dranbleiben",
        "Reflexionen und Learnings je Calling-Tag",
        "Call-Partner und Sessions",
        "Discord-Runde für Antworten und Austausch",
      ],
      keywords:
        "Sales-Community, Kaltakquise, Cold Calling, Calling, Vertrieb, Opener, Setter, Closer, Rangliste, Dranbleiben, Discord",
      audience: { "@type": "BusinessAudience", audienceType: "Menschen im Vertrieb, die callen: Opener, Setter, Closer" },
      provider: { "@id": ORGANIZATION_ID },
      publisher: { "@id": ORGANIZATION_ID },
      brand: { "@id": `${SITE_URL}/#brand` },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: "Deal Operator",
      alternateName: "Deal Operator von HK Growth",
      inLanguage: "de-DE",
      publisher: { "@id": ORGANIZATION_ID },
      about: { "@id": `${SITE_URL}/#app` },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        />
        {children}
      </body>
    </html>
  );
}
