import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Öffentlich: Startseite, Für wen, So funktioniert’s, Einstieg, Rechtliches. Der
// persönliche Bereich führt ohne Anmeldung ohnehin zur Anmeldung und bleibt
// aus dem Index.
const PRIVATE = [
  "/api/",
  "/auth/",
  "/verwaltung",
  "/tagesabschluss",
  "/heute",
  "/zahlen",
  "/reflexion",
  "/reflexionen",
  "/partner",
  "/sessions",
  "/wissen",
  "/profil",
  "/profil-uebernehmen",
  "/start",
  "/status",
  "/bestaetigen",
  "/passwort",
];

// KI-Suchen und Assistenten bekommen dieselben Regeln ausdrücklich genannt, damit
// kein Zweifel bleibt, dass sie die öffentlichen Seiten lesen und zitieren dürfen.
// Jede Gruppe wiederholt die Sperrliste, weil Crawler nur die spezifischste Gruppe lesen.
const AI_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "Google-Extended",
  "Googlebot",
  "Bingbot",
  "Applebot",
  "Applebot-Extended",
  "DuckAssistBot",
  "Amazonbot",
  "meta-externalagent",
  "CCBot",
  "YouBot",
  "MistralAI-User",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: AI_BOTS, allow: "/", disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
