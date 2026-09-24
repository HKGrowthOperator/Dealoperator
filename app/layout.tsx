import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./operator-brand.css";
import "./operator-glass.css";
import "./ranking.css";
import "./ui.css";
export const metadata: Metadata = {
  title: "Deal Operator: Gemeinsam dranbleiben.",
  description:
    "Deal Operator ist ein Werkzeug fürs gemeinsame Callen: jeden Calling-Tag Zahlen und Learnings festhalten, Fortschritt sehen und dranbleiben.",
  icons: { icon: "/favicon.svg" },
};
// Auf Android verkleinert die Bildschirmtastatur die Seite, statt Knöpfe und
// Fehlermeldungen in Formularen zu verdecken.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        {children}
      </body>
    </html>
  );
}
