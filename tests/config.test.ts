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
test("connection string cannot switch off TLS or reroute the search path", () => {
  // node-postgres lets a connection-string parameter win over the sibling
  // configuration, so ?ssl=0 would reach the driver as ssl:false and ?options=
  // would replace the operator search_path. Both must be refused outright.
  for (const query of ["ssl=0", "ssl=false", "ssl=true"])
    assert.throws(
      () =>
        connectionOptions({
          DATABASE_URL: `postgresql://app:example@db.example.invalid:5432/postgres?${query}`,
        }),
      /ssl-Parameter/,
      query,
    );
  assert.throws(
    () =>
      connectionOptions({
        DATABASE_URL:
          "postgresql://app:example@db.example.invalid:5432/postgres?options=-c%20search_path%3Dpublic",
      }),
    /options-Parameter/,
  );
  // A refused connection string is reported as a configuration issue rather
  // than surfacing later as a missing-table error.
  assert.ok(
    configurationIssues({
      APP_URL: "https://example.invalid",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      DATABASE_URL:
        "postgresql://app:example@db.example.invalid:5432/postgres?ssl=0",
    }).some((issue) => /ssl-Parameter/.test(issue)),
  );
  // The documented shape keeps verified TLS and the operator search path.
  const healthy = connectionOptions({
    DATABASE_URL: "postgresql://app:example@db.example.invalid:5432/postgres",
  });
  assert.equal(
    (healthy.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized,
    true,
  );
  assert.match(String(healthy.options), /search_path=operator,pg_catalog/);
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
