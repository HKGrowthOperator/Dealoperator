/** Entry and operational endpoints are deliberately separate from member data. */
export function isPublicEntry(path: string) {
  return (
    new Set([
      "/anmelden",
      "/starten",
      "/beitreten",
      "/start",
      "/status",
      "/passwort",
      "/bestaetigen",
      "/profil-uebernehmen",
      "/auth/callback",
      "/impressum",
      "/datenschutz",
      "/api/auth",
      "/api/onboarding",
      "/api/operator",
      "/api/push",

      "/api/health",
      "/api/ready",
      "/api/cron/tick",
      "/api/discord/interactions",
      "/robots.txt",
      "/sitemap.xml",
      "/manifest.webmanifest",
      "/sw.js",
      "/favicon.svg",
      "/icon-192.png",
      "/icon-512.png",
      "/apple-icon.png",
      "/apple-touch-icon.png",
      "/operator-mark-source.png",
    ]).has(path) ||
    path.startsWith("/fonts/") ||
    path.startsWith("/_next/static/")
  );
}
