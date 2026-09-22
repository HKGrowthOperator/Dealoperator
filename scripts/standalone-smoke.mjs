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
    "/profil-uebernehmen",
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
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
  }
  for (const path of ["/heute", "/zahlen?modus=eigen", "/start"]) {
    const response = await fetch(base + path, { redirect: "manual" });
    assert.equal(response.status, 307, path);
    assert.ok(response.headers.get("location")?.includes("/beitreten"));
  }
  for (const path of ["/api/operator", "/api/community"])
    assert.equal((await fetch(base + path)).status, 401, path);
  const ready = await fetch(base + "/api/ready");
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).ready, false);
  const ranking = await (await fetch(base + "/api/ranking")).json();
  assert.equal(ranking.ready, false);
  assert.deepEqual(ranking.rows, []);
  const html = await (await fetch(base + "/")).text();
  assert.ok(!/kostenlos|dealuno/i.test(html), "Unexpected public copy");
  console.log(
    "Standalone smoke passed: routes, assets, login gates, private API protection and honest readiness. No external services were contacted.",
  );
} catch (error) {
  console.error(log);
  throw error;
} finally {
  child.kill("SIGTERM");
}
