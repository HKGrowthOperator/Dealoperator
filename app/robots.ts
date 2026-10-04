import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Öffentlich: Startseite, So funktioniert’s, Einstieg, Rechtliches. Der
// persönliche Bereich führt ohne Anmeldung ohnehin zur Anmeldung und bleibt
// aus dem Index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
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
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
