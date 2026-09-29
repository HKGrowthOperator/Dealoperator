import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { Database, type Executor } from "../server/database";
import { bindConfirmedRequest, startRequest } from "../server/onboarding";
import {
  CODE_ATTEMPTS,
  confirmAccountIn,
  ownMailReady,
  peekLink,
  redeemCode,
  redeemLink,
  resetOwnMailCache,
  sendEmailCode,
  setPasswordIn,
  type SendMail,
} from "../server/email-code";
import { AppError } from "../server/operator";

// Fiktive Konten und ein nachgebautes Schema auth; keine echten Daten, keine echten Mails.
let pg: PGlite, db: Database;
const PASSWORD = "Anker-Falke-4711";
const ENV = {
  RESEND_API_KEY: "test",
  NOTIFY_FROM: "Deal Operator <team@example.invalid>",
  APP_URL: "https://operator.example.invalid",
} as unknown as NodeJS.ProcessEnv;

const AUTH_STUB = `
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE SCHEMA auth;
CREATE TABLE auth.users(
  id uuid PRIMARY KEY,
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}',
  is_sso_user boolean NOT NULL DEFAULT false,
  is_anonymous boolean NOT NULL DEFAULT false,
  deleted_at timestamptz
);
CREATE TABLE auth.identities(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL,
  identity_data jsonb NOT NULL,
  updated_at timestamptz
);`;
const file = (name: string) => readFile(new URL(`../database/${name}`, import.meta.url), "utf8");

before(async () => {
  pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec(AUTH_STUB);
  await pg.exec(await file("schema.sql"));
  await pg.exec(await file("migrations/0006_team_access.sql"));
  await pg.exec(await file("migrations/0007_email_codes.sql"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as unknown as Executor, (fn) => pg.transaction((tx) => fn(new Database(tx as unknown as Executor))));
});
beforeEach(async () => {
  resetOwnMailCache();
  await pg.exec(
    `TRUNCATE participants,profiles,account_private,onboarding_requests,onboarding_events,email_codes,
      team_inbox,notifications,notification_prefs,rate_limits,sync_outbox CASCADE;
     TRUNCATE auth.identities, auth.users CASCADE;`,
  );
});
after(async () => pg.close());

async function account(email: string, opts: { confirmed?: boolean; hash?: string } = {}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at) VALUES($1,$2,$3,$4)`,
    [id, email, opts.hash ?? "$2a$10$platzhalter", opts.confirmed ? new Date("2026-09-01T10:00:00Z") : null],
  );
  await db.query(
    `INSERT INTO auth.identities(user_id,provider,identity_data) VALUES($1::uuid,'email',jsonb_build_object('email',$2::text,'email_verified',false))`,
    [id, email],
  );
  return id;
}
const user = async (id: string) => (await db.query("SELECT * FROM auth.users WHERE id=$1", [id]))[0];

/** Fängt die Mails ab: Code und Link stehen nur hier, nie in der Datenbank. */
function outbox(fail = false) {
  const sent: { to: string; subject: string; text: string; code: string; key: string }[] = [];
  const send: SendMail = async (m) => {
    if (fail) return { status: "skipped", reason: "kaputt" };
    const code = /\n(\d{3}) (\d{3})\n/.exec(m.text)!;
    const key = /\/bestaetigen#([^\s]+)/.exec(m.text)![1];
    sent.push({ to: m.to, subject: m.subject, text: m.text, code: code[1] + code[2], key });
    return { status: "sent", id: `re_${sent.length}` };
  };
  return { sent, send };
}
const confirm = (tx: Database, c: { email: string; request: string | null }) =>
  confirmAccountIn(tx, c.email).then((a) => ({ ...a, email: c.email, request: c.request }));

test("bereit nur mit Resend-Konfiguration und beiden Migrationen", async () => {
  assert.equal(await ownMailReady(db, {} as NodeJS.ProcessEnv), false);
  assert.equal(await ownMailReady(db, ENV), true);
  resetOwnMailCache();
  assert.equal(await ownMailReady(db, { ...ENV, NOTIFY_FROM: "" }), false);
});

test("Mail enthält Code und Link auf der eigenen Domain; gespeichert sind nur Hashes", async () => {
  const mail = outbox();
  await sendEmailCode(db, { email: "Lena@Example.invalid", purpose: "confirm" }, mail.send, ENV);
  assert.equal(mail.sent.length, 1);
  const [m] = mail.sent;
  assert.equal(m.to, "lena@example.invalid");
  assert.match(m.subject, /Bestätigungscode/);
  assert.match(m.text, /https:\/\/operator\.example\.invalid\/bestaetigen#/);
  assert.doesNotMatch(m.text, /supabase/i);
  const [row] = await db.query("SELECT * FROM email_codes");
  assert.equal(row.mail_id, "re_1");
  const stored = JSON.stringify(row);
  assert.ok(!stored.includes(m.code), "Code steht nicht in der Datenbank");
  assert.ok(!stored.includes(m.key.split(".")[1]), "Link-Geheimnis steht nicht in der Datenbank");
});

test("Code bestätigt die Adresse genau einmal; falsche Codes zählen, eine neue Mail ersetzt die alte", async () => {
  const id = await account("lena@example.invalid");
  const mail = outbox();
  await sendEmailCode(db, { email: "lena@example.invalid", purpose: "confirm" }, mail.send, ENV);
  await sendEmailCode(db, { email: "lena@example.invalid", purpose: "confirm" }, mail.send, ENV);
  const [old, fresh] = mail.sent;
  if (old.code !== fresh.code) {
    const r = await redeemCode(db, { email: "lena@example.invalid", purpose: "confirm", code: old.code }, confirm);
    assert.equal(r.status, "wrong", "Code aus der älteren Mail gilt nicht mehr");
  }
  const wrong = await redeemCode(db, { email: "lena@example.invalid", purpose: "confirm", code: "000000" === fresh.code ? "111111" : "000000" }, confirm);
  assert.equal(wrong.status, "wrong");
  assert.equal((await user(id)).email_confirmed_at, null);

  const ok = await redeemCode(db, { email: "LENA@example.invalid", purpose: "confirm", code: `${fresh.code.slice(0, 3)} ${fresh.code.slice(3)}` }, confirm);
  assert.equal(ok.status, "ok");
  assert.ok((await user(id)).email_confirmed_at);
  const again = await redeemCode(db, { email: "lena@example.invalid", purpose: "confirm", code: fresh.code }, confirm);
  assert.equal(again.status, "none", "einmal verwendet");
});

test("nach 5 falschen Versuchen ist der Code gesperrt, auch der richtige", async () => {
  await account("lena@example.invalid");
  const mail = outbox();
  await sendEmailCode(db, { email: "lena@example.invalid", purpose: "confirm" }, mail.send, ENV);
  const right = mail.sent[0].code;
  const wrongCode = right === "123456" ? "654321" : "123456";
  for (let i = 0; i < CODE_ATTEMPTS; i++)
    assert.equal((await redeemCode(db, { email: "lena@example.invalid", purpose: "confirm", code: wrongCode }, confirm)).status, "wrong");
  await assert.rejects(
    redeemCode(db, { email: "lena@example.invalid", purpose: "confirm", code: right }, confirm),
    (e: AppError) => e.status === 429,
  );
});

test("abgelaufener Code gilt nicht; scheitert die Aktion, bleibt der Code gültig", async () => {
  const mail = outbox();
  await sendEmailCode(db, { email: "neu@example.invalid", purpose: "confirm" }, mail.send, ENV);
  // Kein Konto: Aktion scheitert, Code bleibt offen.
  await assert.rejects(
    redeemCode(db, { email: "neu@example.invalid", purpose: "confirm", code: mail.sent[0].code }, confirm),
    (e: AppError) => e.status === 404,
  );
  const [open] = await db.query("SELECT used_at FROM email_codes");
  assert.equal(open.used_at, null);
  await account("neu@example.invalid");
  await db.query("UPDATE email_codes SET expires_at=now()-interval '1 minute'");
  assert.equal((await redeemCode(db, { email: "neu@example.invalid", purpose: "confirm", code: mail.sent[0].code }, confirm)).status, "none");
});

test("nimmt Resend die Mail nicht an, gilt auch der Code nicht und es gibt eine klare Meldung", async () => {
  const mail = outbox(true);
  await assert.rejects(
    sendEmailCode(db, { email: "lena@example.invalid", purpose: "confirm" }, mail.send, ENV),
    (e: AppError) => e.status === 503 && /nicht verschickt/.test(e.message),
  );
  const [row] = await db.query("SELECT used_at FROM email_codes");
  assert.ok(row.used_at);
});

test("Link: nachsehen ohne Einlösen, einlösen bestätigt und bindet die Registrierung", async () => {
  const userId = await account("lena@example.invalid");
  const r = await startRequest(db, { kind: "new", fullName: "Lena Beispiel", email: "lena@example.invalid", phone: "+49 170 1234567" });
  const mail = outbox();
  await sendEmailCode(db, { email: "lena@example.invalid", purpose: "confirm", request: r.id }, mail.send, ENV);
  const key = mail.sent[0].key;
  assert.deepEqual({ ...(await peekLink(db, key)), id: "" }, { id: "", email: "lena@example.invalid", purpose: "confirm" });
  await assert.rejects(peekLink(db, `${key.split(".")[0]}.${"x".repeat(32)}`), (e: AppError) => e.status === 410);
  await assert.rejects(peekLink(db, "kaputt"), (e: AppError) => e.status === 400);
  await assert.rejects(redeemLink(db, key, "reset", confirm), (e: AppError) => e.status === 410);

  const done = await redeemLink(db, key, "confirm", confirm);
  assert.equal(done.request, r.id);
  assert.ok((await user(userId)).email_confirmed_at);
  const bound = await bindConfirmedRequest(db, { userId: done.userId, email: done.email, admin: false }, done.request!);
  assert.equal(bound?.kind, "new");
  const [req] = await db.query("SELECT status,owner FROM onboarding_requests WHERE id=$1", [r.id]);
  assert.deepEqual({ ...req }, { status: "approved", owner: userId });
  const [ev] = await db.query("SELECT action FROM onboarding_events WHERE request=$1 AND action='email_confirmed'", [r.id]);
  assert.ok(ev, "als echte Bestätigung durch das Postfach festgehalten");
  await assert.rejects(redeemLink(db, key, "confirm", confirm), (e: AppError) => e.status === 410);
});

test("neues Passwort: bcrypt wie Supabase, Adresse bestätigt, andere Konten unberührt", async () => {
  const id = await account("lena@example.invalid");
  const other = await account("tom@example.invalid", { confirmed: true });
  const before = await user(other);
  const mail = outbox();
  await sendEmailCode(db, { email: "lena@example.invalid", purpose: "reset" }, mail.send, ENV);
  assert.match(mail.sent[0].subject, /neues Passwort/);
  // Ein Bestätigungscode setzt kein Passwort und umgekehrt.
  assert.equal((await redeemCode(db, { email: "lena@example.invalid", purpose: "confirm", code: mail.sent[0].code }, confirm)).status, "none");
  const r = await redeemCode(db, { email: "lena@example.invalid", purpose: "reset", code: mail.sent[0].code }, (tx, c) =>
    setPasswordIn(tx, c.email, PASSWORD),
  );
  assert.equal(r.status, "ok");
  const after = await user(id);
  assert.match(after.encrypted_password, /^\$2a\$10\$.{53}$/);
  const [check] = await db.query("SELECT extensions.crypt($1,$2)=$2 AS ok", [PASSWORD, after.encrypted_password]);
  assert.equal(check.ok, true);
  assert.ok(after.email_confirmed_at);
  assert.equal(after.raw_user_meta_data.has_password, true);
  assert.deepEqual(await user(other), before);
  await assert.rejects(
    db.query("SELECT * FROM operator.account_set_password('lena@example.invalid','kurz')"),
    /password_length/,
  );
  const [missing] = await db.query("SELECT * FROM operator.account_set_password('niemand@example.invalid',$1)", [PASSWORD]);
  assert.deepEqual({ ...missing }, { status: "missing", user_id: null });
});

test("Link für ein neues Passwort wird erst beim Festlegen eingelöst", async () => {
  await account("lena@example.invalid", { confirmed: true });
  const mail = outbox();
  await sendEmailCode(db, { email: "lena@example.invalid", purpose: "reset" }, mail.send, ENV);
  const key = mail.sent[0].key;
  assert.equal((await peekLink(db, key)).purpose, "reset");
  assert.equal((await peekLink(db, key)).purpose, "reset", "Nachsehen löst nicht ein");
  await redeemLink(db, key, "reset", (tx, c) => setPasswordIn(tx, c.email, PASSWORD));
  await assert.rejects(peekLink(db, key), (e: AppError) => e.status === 410);
});
