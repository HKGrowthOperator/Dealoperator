import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Nur Seiten, die ohne Anmeldung vollständig lesbar sind. /ranking zeigt
// dieselben Ergebnisse wie die Startseite und verweist per Canonical dorthin.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-10-04");
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/so-funktionierts`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/fuer-wen`, lastModified: new Date("2026-10-06"), changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/starten`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/anmelden`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/impressum`, lastModified, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/datenschutz`, lastModified, changeFrequency: "yearly", priority: 0.2 },
  ];
}
