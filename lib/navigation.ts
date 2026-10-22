const destinations = new Set([
  "/",
  "/mitglieder",
  "/mitglieder/einrichten",
  "/mitglieder/angebote",
  "/mitglieder/mein-profil",
  "/calls",
  "/heute",
  "/zahlen",
  "/reflexion",
  "/partner",
  "/crew",
  "/sessions",
  "/wissen",
  "/profil",
  "/so-funktionierts",
  "/community",
  "/profil-uebernehmen",
  "/verwaltung",
  "/ranking",
  "/tagesabschluss",
  "/reflexionen",
  "/passwort",
  "/status",
]);
/**
 * Ziel nach der Anmeldung. Ohne ausdrückliches Ziel geht es zur gemeinsamen
 * Startseite; ein ausdrückliches Ziel (Tagesabschluss, Reflexionen, ein
 * geschützter Bereich) bleibt erhalten.
 */
export const DEFAULT_NEXT = "/";
export function safeNext(value: string | null) {
  if (!value || !/^\/(?!\/)[a-zA-Z0-9/_?=&-]*$/.test(value))
    return DEFAULT_NEXT;
  const url = new URL(value, "https://operator.invalid");
  return destinations.has(url.pathname) ||
    /^\/mitglieder\/[a-zA-Z0-9_-]+$/.test(url.pathname)
    ? value
    : DEFAULT_NEXT;
}
