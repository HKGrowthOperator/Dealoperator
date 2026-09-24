import { test } from "node:test";
import assert from "node:assert/strict";
import { configurationIssues, connectionOptions } from "../server/config";
import { safeNext } from "../lib/navigation";
import { normalisePhone, splitPhone } from "../lib/phone";
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
  // The same precedence lets host/port/user reroute the connection past the
  // checks above, so a loopback-looking URL could reach a remote host with
  // DATABASE_SSL=disable, or slip back onto the transaction pooler.
  assert.throws(
    () =>
      connectionOptions({
        DATABASE_URL:
          "postgresql://app:example@localhost:5432/postgres?host=remote.example.invalid",
        DATABASE_SSL: "disable",
      }),
    /host-Parameter/,
  );
  assert.throws(
    () =>
      connectionOptions({
        DATABASE_URL:
          "postgresql://app:example@db.example.invalid:5432/postgres?port=6543",
      }),
    /port-Parameter/,
  );
  assert.throws(
    () =>
      connectionOptions({
        DATABASE_URL:
          "postgresql://app:example@db.example.invalid:5432/postgres?user=postgres",
      }),
    /user-Parameter/,
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
    "/starten",
    "/start",
    "/%2f%2fevil.invalid",
    "/\\evil.invalid",
  ])
    assert.equal(safeNext(input), "/");
  assert.equal(
    safeNext("/profil-uebernehmen?profil=abc-123"),
    "/profil-uebernehmen?profil=abc-123",
  );
  assert.equal(safeNext("/zahlen?modus=eigen"), "/zahlen?modus=eigen");
  // Ohne Ziel zur gemeinsamen Startseite, ausdrückliche Ziele bleiben.
  assert.equal(safeNext(null), "/");
  assert.equal(safeNext("/tagesabschluss?tag=2026-09-22"), "/tagesabschluss?tag=2026-09-22");
  assert.equal(safeNext("/reflexionen"), "/reflexionen");
});

test("phone numbers are normalised to E.164 and require a country code", () => {
  // Übliche Schreibweisen führen zum selben gespeicherten Wert.
  for (const input of [
    "+49 170 1234567",
    "+49 (0)170 1234567".replace("(0)", ""),
    "0049 170 1234567",
    "+49-170-1234567",
    "+49/170/1234567",
  ]) {
    const result = normalisePhone(input);
    assert.equal(result.ok, true, input);
    assert.equal((result as { value: string }).value, "+491701234567", input);
  }
  // Ohne Ländervorwahl ist die Nummer mehrdeutig und wird abgelehnt.
  for (const input of ["0170 1234567", "1701234567"]) {
    const result = normalisePhone(input);
    assert.equal(result.ok, false, input);
    assert.match((result as { reason: string }).reason, /Ländervorwahl/);
  }
  // Offensichtlich unbrauchbare Eingaben.
  assert.equal(normalisePhone("").ok, false);
  assert.equal(normalisePhone("+49").ok, false);
  assert.equal(normalisePhone("+4917012345678901234").ok, false);
  assert.equal(normalisePhone("+49 170 abc").ok, false);
  assert.equal(normalisePhone("+0170123456").ok, false);
});

test("with a selected country the national spelling works, including the leading 0", () => {
  for (const [input, country, expected] of [
    ["0170 1234567", "DE", "+491701234567"],
    ["170 1234567", "DE", "+491701234567"],
    ["0170/123 45 67", "DE", "+491701234567"],
    ["+49 (0)170 1234567", "DE", "+491701234567"],
    ["0049 170 1234567", "AT", "+491701234567"],
    ["0664 1234567", "AT", "+436641234567"],
    ["079 123 45 67", "CH", "+41791234567"],
    ["06 1234 5678", "NL", "+31612345678"],
    ["02 1234 5678", "IT", "+390212345678"],
    ["612 345 678", "ES", "+34612345678"],
    ["(212) 555-0123", "US", "+12125550123"],
  ] as const) {
    const result = normalisePhone(input, country);
    assert.equal(result.ok, true, `${input} ${country}`);
    assert.equal((result as { value: string }).value, expected, `${input} ${country}`);
  }
  assert.equal(normalisePhone("0170", "DE").ok, false);
  assert.equal(normalisePhone("0170 12x4567", "DE").ok, false);
  assert.equal(normalisePhone("0170 1234567", "XX").ok, false);
  // Zurück ins Formular: Land und nationale Schreibweise.
  assert.deepEqual(splitPhone("+491701234567"), { country: "DE", national: "01701234567" });
  assert.deepEqual(splitPhone("+4231234567"), { country: "LI", national: "1234567" });
  assert.deepEqual(splitPhone("+390212345678"), { country: "IT", national: "0212345678" });
  assert.deepEqual(splitPhone(""), { country: "DE", national: "" });
});
