/**
 * Externe Adresse der Website für robots.txt, Sitemap, Canonicals und
 * strukturierte Daten. Fallback ist die produktive Domain, damit diese
 * Angaben auch ohne gesetztes APP_URL (etwa im Docker-Build) stimmen.
 */
export const SITE_URL = (
  process.env.APP_URL || "https://dealoperator.hk-growthoperator.de"
).replace(/\/+$/, "");

/** Die eine HK-Growth-Organisation, auf die alle Seiten der Gruppe zeigen. */
export const ORGANIZATION_ID = "https://hk-growthoperator.de/#organization";
