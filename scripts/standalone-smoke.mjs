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
for (const k of [
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
  delete env[k];
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  env,
  stdio: "pipe",
});
let log = "";
child.stdout.on("data", (v) => (log += v));
child.stderr.on("data", (v) => (log += v));
const base = "http://127.0.0.1:5175";
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) throw Error("Standalone exited.");
    try {
      ready = (await fetch(base + "/api/health")).ok;
    } catch {}
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, "Standalone becomes healthy");
  for (const p of [
    "/",
    "/ranking",
    "/api/ranking",
    "/api/ranking/month",
    "/api/ranking/dranbleiben",
    "/api/events",
    "/starten",
    "/anmelden",
    "/impressum",
    "/datenschutz",
    "/fonts/manrope-400.ttf",
    "/operator-mark-source.png",
    "/favicon.svg",
    "/manifest.webmanifest",
    "/sw.js",
    "/icon-192.png",
  ])
    assert.equal((await fetch(base + p)).status, 200, p);
  // Missing configuration fails closed, including old demo/snapshot and image-extension paths.
  for (const p of [
    "/mitglieder",
    "/mitglieder/einrichten",
    "/mitglieder/angebote",
    "/mitglieder/mein-profil",
    "/mitglieder/unknown",
    "/calls",
    "/partner?modus=demo",
    "/sessions?modus=eigen",
    "/reflexionen",
    "/tagesabschluss",
    "/so-funktionierts",
    "/fuer-wen",
    "/llms.txt",
    "/llms-full.txt",
    "/api/community",
    "/api/reflections",
    "/api/members",
    "/api/members/avatar?id=unknown",
    "/api/members/avatar.png",
    "/_next/image?url=%2Fapi%2Fmembers%2Favatar%3Fid%3Dunknown&w=128&q=75",
  ]) {
    const r = await fetch(base + p, { redirect: "manual" });
    assert.equal(r.status, 503, p);
    assert.match(r.headers.get("cache-control") || "", /no-store/, p);
    const body = await r.json();
    assert.ok(
      !("rows" in body) && !("members" in body) && !("events" in body),
      p,
    );
  }
  for (const p of [
    "/api/operator",
    "/api/push",
    "/api/onboarding?status=eigen",
  ])
    assert.equal((await fetch(base + p)).status, 401, p);
  for (const p of ["/start", "/status"]) {
    const r = await fetch(base + p, { redirect: "manual" });
    assert.equal(r.status, 307, p);
    assert.ok(r.headers.get("location")?.includes("/anmelden"));
  }
  const claim = await fetch(
    base + "/profil-uebernehmen?profil=abc&einladung=xyz",
    { redirect: "manual" },
  );
  assert.equal(claim.status, 307);
  assert.ok(claim.headers.get("location")?.includes("/starten"));
  const sw = await fetch(base + "/sw.js");
  assert.equal(sw.headers.get("service-worker-allowed"), "/");
  assert.match(sw.headers.get("cache-control") || "", /no-cache/);
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
  const health = await fetch(base + "/api/ready");
  assert.equal(health.status, 503);
  assert.equal((await health.json()).ready, false);
  const login = await (await fetch(base + "/starten")).text();
  assert.match(login, /Vor- und Nachname/);
  assert.ok(
    !/Sales.Community|Nummer bleibt privat|E-Mail und Nummer sind nur/.test(
      login,
    ),
  );
  assert.match(
    await (await fetch(base + "/robots.txt")).text(),
    /Disallow: \//,
  );
  console.log(
    "Standalone smoke passed: entry, assets, approval boundaries, public figures, private member/offers/photo APIs, no extension bypass. No external service contacted.",
  );
} catch (e) {
  console.error(log);
  throw e;
} finally {
  child.kill("SIGTERM");
}
