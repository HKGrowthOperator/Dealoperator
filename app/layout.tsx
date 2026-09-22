import type { Metadata } from "next";
import "./globals.css";
import "./operator-brand.css";
import "./operator-glass.css";
import "./ranking.css";
import PageMotion from "./features/page-motion";
export const metadata: Metadata = {
  title: "Deal Operator — Gemeinsam dranbleiben.",
  description:
    "Deal Operator – deine kostenfreie Sales-Community. Zahlen reflektieren, Call-Buddys finden und gemeinsam besser werden.",
  icons: { icon: "/favicon.svg" },
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
        <PageMotion />
      </body>
    </html>
  );
}
