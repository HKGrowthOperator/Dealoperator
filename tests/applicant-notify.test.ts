import { test, before, beforeEach, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import { answerInfoRequest, decideRequest, requestClaimSignedIn, startRequest } from "../server/onboarding";
import { dispatch, subscribe } from "../server/notify";
import { recheck } from "../server/scheduler";

// Fiktive Konten; keine echten Kontaktdaten, kein echter Versand.
const admin = { userId: "admin", email: "admin@example.invalid", admin: true };
const alice = { userId: "alice", email: "alice@example.invalid", admin: false };
const bob = { userId: "bob", email: "bob@example.invalid", admin: false };
let pg: PGlite, db: Database;

before(async () => {
  process.env.OPERATOR_ADMIN_IDS = "admin";
  delete process.env.RESEND_API_KEY;
  delete process.env.NOTIFY_FROM;
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as unknown as Executor, (fn) =>
    pg.transaction((tx) => fn(new Database(tx as unknown as Executor))),
  );
});
beforeEach(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.NOTIFY_FROM;
  await pg.exec(
    `TRUNCATE participants,profiles,account_private,onboarding_requests,onboarding_events,claim_tokens,
      team_inbox,notifications,notification_prefs,push_subscriptions,rate_limits,sync_outbox,team_roles CASCADE`,
  );
});
after(async () => {
  await pg.close();
});

async function profile(name: string) {
  const id = randomUUID();
  await db.query("INSERT INTO participants(id,name) VALUES($1,$2)", [id, name]);
  return id;
}
const details = (participantId: string, fullName = "Alice Beispiel") => ({
  participantId,
  fullName,
  phone: "+49 170 1234567",
});
const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const keys = { p256dh: `B${"a".repeat(86)}`, auth: "b".repeat(22) };
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query(sql, params))[0].n);
const forApplicant = (who: string) =>
  db.query(
    `SELECT kind,channel,title,body,url,status,detail FROM notifications
      WHERE recipient=$1 AND kind LIKE 'applicant:%' ORDER BY id`,
    [who],
  );
// Die Nachricht des Teams darf alles enthalten; sie gehört nie in Push oder E-Mail.
const TEAM_MESSAGE = "Ruf mich an unter +49 171 5550000 oder schreib an team@example.invalid";
const CONTACT = /@|\+49|0170|0171|1234567|5550000|Ruf mich an|example\.invalid/;
const noContactData = (rows: Record<string, unknown>[]) => {
  for (const n of rows) assert.doesNotMatch(`${n.title} ${n.body} ${n.url}`, CONTACT);
};

/** Resend-Aufrufe abfangen; nichts verlässt den Test. */
function fakeResend(t: TestContext, status = 200) {
  process.env.RESEND_API_KEY = "re_test_only";
  process.env.NOTIFY_FROM = "Deal Operator <team@example.invalid>";
  const calls: { to: string[]; subject: string; text: string }[] = [];
  const state = { status };
  t.mock.method(globalThis, "fetch", async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "mail-1" }), { status: state.status });
  });
  return { calls, state };
}
type PushSend = NonNullable<Parameters<typeof dispatch>[3]>;
const acceptingPush = (payloads: Record<string, string>[] = []) =>
  (async (_sub: unknown, payload: string) => {
    payloads.push(JSON.parse(payload));
    return { statusCode: 201 };
  }) as unknown as PushSend;

test("approval: exactly one push and one e-mail for the applicant, fixed texts, no contact data", async () => {
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  const done = await decideRequest(db, admin, { id: r.id, decision: "approve", applicantMessage: TEAM_MESSAGE });
  assert.equal(done.status, "approved");
  const rows = await forApplicant("alice");
  assert.deepEqual(
    rows.map((n) => [n.kind, n.channel, n.title, n.url]),
    [
      ["applicant:approve", "push", "Dein Profil ist freigegeben", "/tagesabschluss"],
      ["applicant:approve", "email", "Dein Profil ist freigegeben", "/tagesabschluss"],
    ],
  );
  assert.equal(rows[0].body, "„Alice B.“ gehört jetzt zu deinem Konto. Trag deinen Tag ein.");
  assert.match(rows[1].body, /^„Alice B.“ gehört jetzt zu deinem Konto bei Deal Operator\./);
  for (const n of rows) assert.doesNotMatch(`${n.title} ${n.body}`, /—|--/);
  noContactData(rows);
  // Ohne Gerät und ohne Mail-Versand verspricht die Verwaltung nichts.
  assert.deepEqual(done.notified, []);
});

test("question and rejection: one push and one e-mail each, pointing to the status page", async () => {
  const p = await profile("Alice B.");
  const q = await profile("Alice Q.");
  const first = await requestClaimSignedIn(db, alice, details(p));
  await decideRequest(db, admin, { id: first.id, decision: "info", applicantMessage: TEAM_MESSAGE });
  await decideRequest(db, admin, { id: first.id, decision: "reject", applicantMessage: TEAM_MESSAGE });
  const rows = await forApplicant("alice");
  assert.deepEqual(
    rows.map((n) => [n.kind, n.channel, n.title, n.body, n.url]).filter((n) => n[1] === "push"),
    [
      ["applicant:info", "push", "Rückfrage vom Team", "Das Team hat eine Frage zu deiner Profilübernahme.", "/status"],
      ["applicant:reject", "push", "Profilübernahme nicht freigegeben", "Hier siehst du, wie es weitergeht.", "/status"],
    ],
  );
  assert.deepEqual(
    rows.filter((n) => n.channel === "email").map((n) => [n.kind, n.title, n.url]),
    [
      ["applicant:info", "Rückfrage zu deiner Profilübernahme", "/status"],
      ["applicant:reject", "Profilübernahme nicht freigegeben", "/status"],
    ],
  );
  noContactData(rows);
  // Eine neue Anfrage nach der Ablehnung bekommt ihre eigenen Hinweise.
  const second = await requestClaimSignedIn(db, alice, details(q));
  await decideRequest(db, admin, { id: second.id, decision: "reject", applicantMessage: "Passt leider nicht." });
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE recipient='alice' AND kind='applicant:reject'"), 4);
});

test("double clicks and repeated decisions never send twice; a new round of questions does", async () => {
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  const ask = (text: string) => decideRequest(db, admin, { id: r.id, decision: "info", applicantMessage: text });
  const infos = () => count("SELECT count(*) AS n FROM notifications WHERE recipient='alice' AND kind='applicant:info'");
  await Promise.all([ask("Unter welchem Namen callst du?"), ask("Unter welchem Namen callst du?")]);
  // Die Frage nachgeschärft, bevor die Person antwortet: kein zweiter Hinweis.
  const sharpened = await ask("Unter welchem Namen und in welcher Gruppe callst du?");
  assert.deepEqual(sharpened.notified, []);
  assert.equal(await infos(), 2);
  // Nach der Antwort ist eine neue Rückfrage ein neuer Anlass.
  await answerInfoRequest(db, alice, { message: "Als Ali, Gruppe Nord" });
  await ask("Seit wann bist du dabei?");
  assert.equal(await infos(), 4);
  await answerInfoRequest(db, alice, { message: "Seit August" });

  const results = await Promise.allSettled([
    decideRequest(db, admin, { id: r.id, decision: "approve" }),
    decideRequest(db, admin, { id: r.id, decision: "approve" }),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  await assert.rejects(decideRequest(db, admin, { id: r.id, decision: "approve" }), /abschließend/);
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE recipient='alice' AND kind='applicant:approve'"), 2);
});

test("the decision stands when the notification cannot be created", async (t) => {
  const quiet = t.mock.method(console, "error", () => undefined);
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  await pg.exec("ALTER TABLE notifications RENAME TO notifications_off");
  try {
    const done = await decideRequest(db, admin, { id: r.id, decision: "approve" });
    assert.equal(done.status, "approved");
    assert.deepEqual(done.notified, []);
  } finally {
    await pg.exec("ALTER TABLE notifications_off RENAME TO notifications");
  }
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [p]))[0].owner, "alice");
  assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [r.id]))[0].status, "approved");
  assert.equal(quiet.mock.callCount(), 1);
  // Im Protokoll steht nur die Fehlermeldung, keine Adresse und kein Name.
  noContactData([{ title: "", body: quiet.mock.calls[0].arguments.join(" "), url: "" }]);
});

test("a failing mail provider changes nothing about the decision and nothing counts as sent", async (t) => {
  const resend = fakeResend(t, 500);
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  await subscribe(db, alice, { endpoint: endpoint(1), keys }, "iPhone");
  const done = await decideRequest(db, admin, { id: r.id, decision: "reject", applicantMessage: TEAM_MESSAGE });
  assert.deepEqual(done.notified, ["push", "email"]);

  const payloads: Record<string, string>[] = [];
  await dispatch(db, recheck, new Date(), acceptingPush(payloads));
  assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [r.id]))[0].status, "rejected");
  let [push, mail] = await forApplicant("alice");
  assert.equal(push.status, "sent");
  assert.equal(mail.status, "pending");
  assert.match(mail.detail, /Resend antwortet mit 500/);
  // Das Gerät bekam nur die festen Worte.
  assert.deepEqual(payloads.map((x) => [x.title, x.body, x.url]), [
    ["Profilübernahme nicht freigegeben", "Hier siehst du, wie es weitergeht.", "/status"],
  ]);
  // Die Mail ging an die bestätigte Adresse der Anfrage, ohne die Nachricht des Teams.
  assert.equal(resend.calls.length, 1);
  assert.deepEqual(resend.calls[0].to, [alice.email]);
  assert.doesNotMatch(resend.calls[0].text, /Ruf mich an|5550000/);
  assert.match(resend.calls[0].text, /\/status$/);

  // Resend nimmt beim nächsten Versuch an: erst jetzt gilt die Mail als gesendet.
  resend.state.status = 200;
  await db.query("UPDATE notifications SET next_attempt_at=now()");
  await dispatch(db, recheck, new Date(), acceptingPush());
  [push, mail] = await forApplicant("alice");
  assert.equal(mail.status, "sent");
  assert.equal(resend.calls.length, 2);
});

test("without Resend or a device nothing is marked as sent, each with a reason", async () => {
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  await decideRequest(db, admin, { id: r.id, decision: "approve" });
  await dispatch(db, recheck, new Date(), acceptingPush());
  const [push, mail] = await forApplicant("alice");
  assert.deepEqual([push.status, push.detail], ["skipped", "Kein Gerät mit Push-Zustimmung hinterlegt."]);
  assert.equal(mail.status, "skipped");
  assert.match(mail.detail, /RESEND_API_KEY fehlt/);
});

test("the e-mail only goes to the confirmed login address of the account", async (t) => {
  const resend = fakeResend(t);
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  // Die bestätigte Anmeldeadresse ist inzwischen eine andere als die der Anfrage.
  await db.query("UPDATE account_private SET email='alice.neu@example.invalid' WHERE owner='alice'");
  const done = await decideRequest(db, admin, { id: r.id, decision: "approve" });
  assert.deepEqual(done.notified, []);
  const [, mail] = await forApplicant("alice");
  assert.equal(mail.status, "skipped");
  assert.match(mail.detail, /Keine bestätigte Adresse/);
  await dispatch(db, recheck, new Date(), acceptingPush());
  assert.equal(resend.calls.length, 0);

  // Dasselbe, wenn sich die Adresse erst nach der Entscheidung ändert.
  const q = await profile("Bob B.");
  const s = await requestClaimSignedIn(db, bob, details(q, "Bob Beispiel"));
  await decideRequest(db, admin, { id: s.id, decision: "info", applicantMessage: "Welche Firma?" });
  await db.query("UPDATE account_private SET email='bob.neu@example.invalid' WHERE owner='bob'");
  await dispatch(db, recheck, new Date(), acceptingPush());
  const [, bobMail] = await forApplicant("bob");
  assert.equal(bobMail.status, "skipped");
  assert.match(bobMail.detail, /Keine bestätigte Adresse/);
  assert.equal(resend.calls.length, 0);
});

test("a question answered before delivery is not announced anymore", async () => {
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  await subscribe(db, alice, { endpoint: endpoint(2), keys }, "iPhone");
  await decideRequest(db, admin, { id: r.id, decision: "info", applicantMessage: "Welche Firma?" });
  await answerInfoRequest(db, alice, { message: "Beispiel GmbH" });
  const payloads: Record<string, string>[] = [];
  await dispatch(db, recheck, new Date(), acceptingPush(payloads));
  assert.equal(payloads.length, 0);
  for (const n of await forApplicant("alice")) {
    assert.equal(n.status, "skipped");
    assert.match(n.detail, /inzwischen beantwortet/);
  }
});

test("whoever lost the profile to another account hears about it; unconfirmed requests do not", async () => {
  const p = await profile("Alice B.");
  const a = await requestClaimSignedIn(db, alice, details(p));
  const b = await requestClaimSignedIn(db, bob, details(p, "Bob Beispiel"));
  // Unbestätigt, ohne Konto: niemand, dem man schreiben könnte.
  const unconfirmed = await startRequest(db, {
    kind: "claim", participantId: p, email: "carol@example.invalid", fullName: "Carol Beispiel", phone: "+49 172 7654321",
  });
  await decideRequest(db, admin, { id: a.id, decision: "approve" });
  assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [b.id]))[0].status, "superseded");
  const rows = await forApplicant("bob");
  assert.deepEqual(
    rows.map((n) => [n.kind, n.channel, n.title, n.url]),
    [
      ["applicant:superseded", "push", "Profil schon zugeordnet", "/status"],
      ["applicant:superseded", "email", "Profil schon zugeordnet", "/status"],
    ],
  );
  noContactData(rows);
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE ref=$1", [unconfirmed.id]), 0);
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE recipient='alice' AND kind='applicant:approve'"), 2);
  // Die Freigabe an Alice hat kein „vergeben“ an Alice ausgelöst.
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE recipient='alice' AND kind='applicant:superseded'"), 0);
});
