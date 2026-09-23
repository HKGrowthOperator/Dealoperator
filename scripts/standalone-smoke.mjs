import { cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
await cp("public", ".next/standalone/public", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
const env = {
  ...process.env,
  PORT: "5175",
  HOSTNAME: "127.0.0.1",
  NODE_ENV: "production",
};
for (const name of [
  "APP_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "DATABASE_SSL_CA",
  "DATABASE_SSL",
  "OPERATOR_ADMIN_IDS",
  "CRON_SECRET",
  "DISCORD_PUBLIC_KEY",
])
  delete env[name];
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  env,
  stdio: "pipe",
});
let log = "";
child.stdout.on("data", (x) => (log += x));
child.stderr.on("data", (x) => (log += x));
const base = "http://127.0.0.1:5175";
try {
  let alive = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null)
      throw Error("Standalone process exited before becoming ready.");
    try {
      alive = (await fetch(base + "/api/health")).ok;
    } catch {}
    if (alive) break;
    await delay(250);
  }
  assert.ok(alive, "Standalone process did not become ready");
  for (const path of [
    "/",
    "/ranking",
    "/beitreten",
    "/anmelden",
    "/verwaltung",
    "/heute?modus=demo",
    "/crew?modus=demo",
    "/reflexion?modus=demo",
    "/sessions?modus=demo",
    "/wissen?modus=demo",
    "/profil?modus=demo",
    "/community?modus=demo",
    "/fonts/manrope-400.ttf",
    "/operator-mark-source.png",
    "/favicon.svg",
    "/manifest.webmanifest",
    "/sw.js",
    "/icon-192.png",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
  }
  // Mitgliederbereiche führen zur Anmeldung, nicht durch die Profilauswahl.
  for (const path of [
    "/heute",
    "/zahlen?modus=eigen",
    "/start",
    "/status",
    "/tagesabschluss",
  ]) {
    const response = await fetch(base + path, { redirect: "manual" });
    assert.equal(response.status, 307, path);
    assert.ok(
      response.headers.get("location")?.includes("/anmelden"),
      `${path} -> ${response.headers.get("location")}`,
    );
  }
  // Die frühere Direktübernahme führt in den geprüften Ablauf.
  const retired = await fetch(base + "/profil-uebernehmen?profil=abc", {
    redirect: "manual",
  });
  assert.equal(retired.status, 307);
  assert.ok(retired.headers.get("location")?.includes("/beitreten?profil=abc"));
  // Öffentliche Profilsuche ohne Konfiguration: ehrlich leer statt Fehler.
  const search = await (await fetch(base + "/api/onboarding?q=test")).json();
  assert.equal(search.ready, false);
  assert.deepEqual(search.profiles, []);
  for (const path of [
    "/api/operator",
    "/api/community",
    "/api/closing",
    "/api/push",
    "/api/reflections",
    "/api/admin",
    "/api/discord/connect",
  ])
    assert.equal((await fetch(base + path)).status, 401, path);
  // Service Worker nur vom eigenen Ursprung, ohne Cache.
  const sw = await fetch(base + "/sw.js");
  assert.equal(sw.headers.get("service-worker-allowed"), "/");
  assert.match(sw.headers.get("cache-control") || "", /no-cache/);
  // Ohne gesetzte Geheimnisse gibt es Cron- und Discord-Eingänge nicht.
  assert.equal(
    (await fetch(base + "/api/cron/tick", { method: "POST" })).status,
    404,
  );
  assert.equal(
    (
      await fetch(base + "/api/discord/interactions", {
        method: "POST",
        body: "{}",
      })
    ).status,
    404,
  );
  // Öffentlich: Event-Tage und Dranbleiben-Rangliste ehrlich leer ohne Datenbank.
  assert.deepEqual((await (await fetch(base + "/api/events")).json()).events, []);
  assert.deepEqual(
    (await (await fetch(base + "/api/ranking/dranbleiben")).json()).rows,
    [],
  );
  assert.equal(
    (await fetch(base + "/api/onboarding?status=eigen")).status,
    401,
  );
  const ready = await fetch(base + "/api/ready");
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).ready, false);
  // Ohne Datenbank trägt die freigegebene Momentaufnahme die öffentliche
  // Ansicht: echte gemeldete Zahlen, klar gekennzeichnet, ohne private Felder.
  // Fester Tag der Momentaufnahme, damit der Test nicht vom Datum abhängt.
  const ranking = await (
    await fetch(base + "/api/ranking?from=2026-09-22&to=2026-09-22")
  ).json();
  assert.equal(ranking.ready, true);
  assert.equal(ranking.snapshot, true);
  assert.match(ranking.label, /Gemeldeter Stand/);
  assert.equal(ranking.rows.length, 23);
  const totals = (key) =>
    ranking.rows
      .map((r) => r.counts[key])
      .filter((v) => v !== null)
      .reduce((a, b) => a + b, 0);
  assert.equal(totals("attempts"), 1416);
  assert.equal(totals("settingsBooked"), 34);
  assert.equal(totals("closingsBooked"), 2);
  assert.equal(totals("legacyMeetings"), 4);
  assert.ok(ranking.rows.every((r) => r.counts.dealsWon === null));
  assert.ok(ranking.rows.every((r) => r.claimed === false));
  for (const field of ["email", "phone", "import_key", "source_url", "note"])
    assert.ok(
      !JSON.stringify(ranking.rows).includes(field),
      `Rangliste darf ${field} nicht ausliefern`,
    );
  const html = await (await fetch(base + "/")).text();
  assert.ok(
    !/kostenlos|dealuno|Beispieldaten|fiktiv|whatsapp|partnerregister/i.test(html),
    "Unexpected public copy",
  );
  assert.match(html, /Zusammen callen/);
  assert.match(html, /Gemeinsam dranbleiben/);
  // /reflexionen ohne Anmeldung: Erklärung statt fremder Reflexionen.
  const feedPage = await fetch(base + "/reflexionen", { redirect: "manual" });
  assert.ok([200, 307].includes(feedPage.status), "/reflexionen");
  console.log(
    "Standalone smoke passed: routes, assets, login gates, private API protection and honest readiness. No external services were contacted.",
  );
} catch (error) {
  console.error(log);
  throw error;
} finally {
  child.kill("SIGTERM");
}
