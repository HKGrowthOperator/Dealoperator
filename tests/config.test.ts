import { test } from "node:test";
import assert from "node:assert/strict";
import { configurationIssues, connectionOptions } from "../server/config";
import { safeNext } from "../lib/navigation";
import { readiness } from "../server/readiness";

test("production database connection cannot weaken TLS via URL options", () => {
  const result = connectionOptions({
    DATABASE_URL:
      "postgresql://app:example@db.example.invalid:5432/postgres?sslmode=no-verify",
  });
  assert.equal(
    (result.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized,
    true,
  );
  assert.ok(!result.connectionString?.includes("sslmode"));
  assert.throws(
    () =>
      connectionOptions({
        DATABASE_URL: "postgresql://app:example@db.example.invalid/postgres",
        DATABASE_SSL: "disable",
      }),
    /lokale Datenbank/,
  );
});
test("session-dependent queries reject transaction pooler and allow local test TLS override", () => {
  assert.throws(
    () =>
      connectionOptions({
        DATABASE_URL:
          "postgresql://app:example@db.example.invalid:6543/postgres",
      }),
    /Session-Pooler/,
  );
  assert.equal(
    connectionOptions({
      DATABASE_URL: "postgresql://app:example@127.0.0.1:5432/postgres",
      DATABASE_SSL: "disable",
    }).ssl,
    false,
  );
});
test("configuration diagnostics do not expose supplied credentials", () => {
  const issues = configurationIssues({
    APP_URL: "https://password-should-not-appear:secret@app.invalid/extra",
    SUPABASE_URL: "bad-value",
    SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden",
    DATABASE_URL: "secret-value",
  });
  assert.ok(issues.length >= 3);
  assert.ok(!JSON.stringify(issues).includes("password-should-not-appear"));
  assert.ok(!JSON.stringify(issues).includes("sb_secret_forbidden"));
});
test("unconfigured readiness fails closed without attempting a connection", async () => {
  const result = await readiness(() => {
    throw Error("Must not connect");
  }, {});
  assert.deepEqual(result, {
    ready: false,
    configuration: false,
    database: false,
  });
});
test("post-login targets prevent external redirects and authentication loops", () => {
  for (const input of [
    "//evil.invalid",
    "https://evil.invalid",
    "/auth/callback",
    "/beitreten",
    "/start",
    "/%2f%2fevil.invalid",
    "/\\evil.invalid",
  ])
    assert.equal(safeNext(input), "/heute?modus=eigen");
  assert.equal(
    safeNext("/profil-uebernehmen?profil=abc-123"),
    "/profil-uebernehmen?profil=abc-123",
  );
  assert.equal(safeNext("/zahlen?modus=eigen"), "/zahlen?modus=eigen");
});
