import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../server/database";
import { createMember, issueClaim } from "../server/operator";
import {
  answerInfoRequest,
  bindConfirmedRequest,
  decideRequest,
  noteConfirmedAccount,
  requestClaimSignedIn,
  requestForActor,
  reviewQueue,
  startRequest,
} from "../server/onboarding";

// Fiktive Konten; keine echten Kontaktdaten.
const admin = { userId: "admin", email: "admin@example.invalid", admin: true };
const alice = { userId: "alice", email: "alice@example.invalid", admin: false };
const bob = { userId: "bob", email: "bob@example.invalid", admin: false };
const mo = { userId: "mo", email: "mo@example.invalid", admin: false, moderator: true };
let pg: PGlite, db: Database;

before(async () => {
  process.env.OPERATOR_ADMIN_IDS = "admin";
  delete process.env.RESEND_API_KEY;
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as any, (fn) => pg.transaction((tx) => fn(new Database(tx as any))));
});
beforeEach(async () => {
  await pg.exec(
    `TRUNCATE participants,profiles,account_private,onboarding_requests,onboarding_events,claim_tokens,
      team_inbox,notifications,notification_prefs,rate_limits,sync_outbox,team_roles CASCADE`,
  );
});
after(async () => {
  await pg.close();
});

async function profile(name: string, opts: { owner?: string; searchable?: boolean; kind?: string } = {}) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO participants(id,name,owner,searchable,kind,claimed_at) VALUES($1,$2,$3,$4,$5,$6)",
    [id, name, opts.owner ?? null, opts.searchable ?? true, opts.kind ?? "person", opts.owner ? new Date() : null],
  );
  return id;
}
const details = (participantId: string, extra: Record<string, unknown> = {}) => ({
  participantId,
  fullName: "Alice Beispiel",
  phone: "+49 170 1234567",
  ...extra,
});
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query(sql, params))[0].n);

test("a signed-in account asks for a takeover without a second email; nothing is released", async () => {
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  assert.equal(r.status, "pending");
  assert.equal(r.repeated, false);
  const [row] = await db.query("SELECT owner,status,email FROM onboarding_requests WHERE id=$1", [r.id]);
  assert.deepEqual({ ...row }, { owner: "alice", status: "pending", email: alice.email });
  // Keine automatische Freigabe.
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [p]))[0].owner, null);
  // Telefonnummer ist ergänzt, das Team sieht einen prüfbereiten Eintrag.
  assert.equal((await db.query("SELECT phone FROM account_private WHERE owner='alice'"))[0].phone, "+491701234567");
  const [inbox] = await db.query("SELECT state FROM team_inbox");
  assert.equal(inbox.state, "review_ready");
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE kind='team:claim'"), 2);
  assert.equal((await requestForActor(db, alice))?.status, "pending");
});

test("repeated or simultaneous clicks keep one request and one team alert", async () => {
  const p = await profile("Alice B.");
  const results = await Promise.all([
    requestClaimSignedIn(db, alice, details(p)),
    requestClaimSignedIn(db, alice, details(p)),
    requestClaimSignedIn(db, alice, details(p, { hint: "Im Chat als Ali" })),
  ]);
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  assert.equal(await count("SELECT count(*) AS n FROM onboarding_requests"), 1);
  assert.equal(await count("SELECT count(*) AS n FROM team_inbox"), 1);
  assert.equal(await count("SELECT count(*) AS n FROM notifications"), 2);
});

test("one account never gets a second profile or a second takeover", async () => {
  const p = await profile("Alice B.");
  const q = await profile("Jemand anders");
  await requestClaimSignedIn(db, alice, details(p));
  await assert.rejects(requestClaimSignedIn(db, alice, details(q)), /bereits eine Übernahmeanfrage/);
  await assert.rejects(
    createMember(db, alice, { name: "Alice", company: "", role: "", publicConsent: false }),
    /zweites Profil/,
  );
  await profile("Bob", { owner: "bob" });
  await assert.rejects(requestClaimSignedIn(db, bob, details(p)), /bereits ein eigenes Profil/);
});

test("taken and joint profiles are refused; an invitation only unlocks the choice", async () => {
  const taken = await profile("Carol", { owner: "carol" });
  await assert.rejects(requestClaimSignedIn(db, alice, details(taken)), /bereits einem Konto zugeordnet/);
  const joint = await profile("Alice & Kim", { kind: "joint" });
  await assert.rejects(requestClaimSignedIn(db, alice, details(joint)), /gemeinsam gemeldete/);
  const hidden = await profile("Versteckt", { searchable: false });
  await assert.rejects(requestClaimSignedIn(db, alice, details(hidden)), /persönliche Einladung/);
  const { token } = await issueClaim(db, admin, hidden);
  await assert.rejects(
    requestClaimSignedIn(db, alice, details(hidden, { invite: "falsch" })),
    /persönliche Einladung/,
  );
  const r = await requestClaimSignedIn(db, alice, details(hidden, { invite: token }));
  assert.equal(r.status, "pending");
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [hidden]))[0].owner, null);
});

test("two accounts ask for the same profile: the team assigns exactly one", async () => {
  const p = await profile("Alice B.");
  const a = await requestClaimSignedIn(db, alice, details(p));
  const b = await requestClaimSignedIn(db, bob, details(p, { fullName: "Bob Beispiel" }));
  await decideRequest(db, admin, { id: a.id, decision: "approve" });
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [p]))[0].owner, "alice");
  assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [b.id]))[0].status, "superseded");
  await assert.rejects(decideRequest(db, admin, { id: b.id, decision: "approve" }), /abschließend entschieden/);
  // Nach der Freigabe lässt sich das Profil nicht erneut anfragen.
  await assert.rejects(requestClaimSignedIn(db, bob, details(p)), /bereits einem Konto zugeordnet/);
});

test("an unconfirmed request from another browser becomes the signed-in request", async () => {
  const p = await profile("Alice B.");
  const q = await profile("Anderes Profil");
  const base = { kind: "claim", email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567" };
  const first = await startRequest(db, { ...base, participantId: p });
  const other = await startRequest(db, { ...base, participantId: q });
  const r = await requestClaimSignedIn(db, alice, details(p));
  assert.equal(r.id, first.id);
  assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [other.id]))[0].status, "superseded");
  // Ein später geöffneter Link hängt keine zweite Übernahme an.
  assert.equal(await bindConfirmedRequest(db, alice, other.id), null);
  const late = await startRequest(db, { ...base, participantId: q });
  assert.equal(await bindConfirmedRequest(db, alice, late.id), null);
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM onboarding_requests WHERE owner='alice' AND status IN ('pending','info_needed')",
    ),
    1,
  );
});

test("a question from the team can be answered and goes back into review", async () => {
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  await assert.rejects(answerInfoRequest(db, alice, { message: "Hallo Team" }), /keine offene Rückfrage/);
  await decideRequest(db, admin, { id: r.id, decision: "info", applicantMessage: "Unter welchem Namen callst du?" });
  assert.equal((await requestForActor(db, alice))?.status, "info_needed");
  await answerInfoRequest(db, alice, { message: "Als Ali im Gruppenchat" });
  const mine = await requestForActor(db, alice);
  assert.equal(mine?.status, "pending");
  assert.equal(mine?.lastAnswer, "Als Ali im Gruppenchat");
  const queue = await reviewQueue(db, admin);
  assert.equal(queue.find((q) => q.id === r.id)?.applicant_answer, "Als Ali im Gruppenchat");
  // Die Antwort steht in der Inbox, löst aber keinen Team-Push aus.
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE kind='team:answer'"), 0);
  assert.equal(await count("SELECT count(*) AS n FROM notifications"), 2);
  // Die Freigabe bleibt beim Team.
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [p]))[0].owner, null);
});

test("after a rejection the account can ask for another profile or start its own", async () => {
  const p = await profile("Alice B.");
  const q = await profile("Alice Beispiel");
  const r = await requestClaimSignedIn(db, alice, details(p));
  await decideRequest(db, admin, { id: r.id, decision: "reject", applicantMessage: "Das Profil gehört jemand anderem." });
  const next = await requestClaimSignedIn(db, alice, details(q));
  assert.notEqual(next.id, r.id);
  await decideRequest(db, admin, { id: next.id, decision: "reject" });
  const own = await createMember(db, alice, { name: "Alice", company: "", role: "", publicConsent: false });
  assert.ok(own.id);
});

test("a later confirmed link never hides the running takeover on the status page", async () => {
  const p = await profile("Alice B.");
  const q = await profile("Jemand Q.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  await decideRequest(db, admin, { id: r.id, decision: "info", applicantMessage: "Welche Firma?" });
  const other = await startRequest(db, {
    kind: "claim", participantId: q, email: alice.email, fullName: "Fremde Person", phone: "+49 171 9999999",
  });
  assert.equal(await bindConfirmedRequest(db, alice, other.id), null);
  const mine = await requestForActor(db, alice);
  assert.equal(mine?.status, "info_needed");
  assert.equal(mine?.participantName, "Alice B.");
  // Die abgelöste Zeile hängt nicht am Konto.
  assert.equal((await db.query("SELECT owner FROM onboarding_requests WHERE id=$1", [other.id]))[0].owner, null);
  await answerInfoRequest(db, alice, { message: "Beispiel GmbH" });
});

test("an old unconfirmed request turned into a takeover counts as the newest", async () => {
  const p = await profile("Alice B.");
  const q = await profile("Alice Q.");
  const base = { kind: "claim", email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567" };
  await startRequest(db, { ...base, participantId: p });
  const forQ = await startRequest(db, { ...base, participantId: q });
  // Q wird bestätigt und abgelehnt, danach fragt Alice angemeldet P an.
  await db.query("UPDATE onboarding_requests SET status='superseded' WHERE participant=$1 AND id<>$2", [p, forQ.id]);
  const bound = await bindConfirmedRequest(db, alice, forQ.id);
  assert.ok(bound);
  await decideRequest(db, admin, { id: forQ.id, decision: "reject" });
  await requestClaimSignedIn(db, alice, details(p));
  const mine = await requestForActor(db, alice);
  assert.equal(mine?.status, "pending");
  assert.equal(mine?.participantName, "Alice B.");
});

test("the public start cannot rewrite a request the team is already checking", async () => {
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  await startRequest(db, {
    kind: "claim", participantId: p, email: alice.email, fullName: "Mallory Fremd", phone: "+49 171 9999999",
  });
  const [row] = await db.query("SELECT full_name,phone FROM onboarding_requests WHERE id=$1", [r.id]);
  assert.deepEqual({ ...row }, { full_name: "Alice Beispiel", phone: "+491701234567" });
});

test("nobody in the team decides about their own takeover, and a question needs a text", async () => {
  const p = await profile("Fremde Person");
  await db.query("INSERT INTO team_roles(owner,role,granted_by) VALUES('mo','moderator','admin')");
  const r = await requestClaimSignedIn(db, mo, details(p, { fullName: "Mo Beispiel" }));
  await assert.rejects(decideRequest(db, mo, { id: r.id, decision: "approve" }), /jemand anderes/);
  await assert.rejects(decideRequest(db, admin, { id: r.id, decision: "info" }), /Rückfrage/);
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [p]))[0].owner, null);
});

test("a takeover via registration alerts the team even after an earlier sign-in alert", async () => {
  const p = await profile("Alice B.");
  await noteConfirmedAccount(db, alice);
  const started = await startRequest(db, {
    kind: "claim", participantId: p, email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567",
  });
  // noteConfirmedAccount hat das Konto schon gemeldet; die Übernahme kommt trotzdem an.
  await db.query("DELETE FROM onboarding_requests WHERE id<>$1", [started.id]);
  const bound = await bindConfirmedRequest(db, alice, started.id);
  assert.equal(bound?.kind, "claim");
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE kind='team:claim'"), 2);
});

test("signing in from a takeover binds only a request for the same profile and tells the team quietly", async () => {
  const p = await profile("Alice B.");
  const q = await profile("Alice Q.");
  const base = { kind: "claim", email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567" };
  const forP = await startRequest(db, { ...base, participantId: p });
  // Anmeldung mit Ziel Q: die P-Anfrage bleibt unbestätigt liegen.
  assert.equal(await bindConfirmedRequest(db, alice, forP.id, q), null);
  assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [forP.id]))[0].status, "awaiting_email");
  // Anmeldung mit Ziel P: genau diese Anfrage wird zur Übernahme.
  const bound = await bindConfirmedRequest(db, alice, forP.id, p);
  assert.equal(bound?.participant, p);
  // Ohne passende Anfrage sieht das Team das Konto, aber ohne Push und E-Mail.
  await noteConfirmedAccount(db, bob, true);
  assert.equal(await count("SELECT count(*) AS n FROM team_inbox WHERE dedupe_key='account:bob'"), 1);
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE ref='account:bob'"), 0);
});

test("not found: the team assigns the profile; without a choice nothing is released", async () => {
  const p = await profile("Alice B.");
  const r = await startRequest(db, {
    kind: "claim", email: alice.email, fullName: "Alice Beispiel", phone: "0170 1234567", phoneCountry: "DE",
    hint: "Gesucht nach „Alice“",
  });
  assert.equal(r.participant, null);
  const bound = await bindConfirmedRequest(db, alice, r.id);
  assert.equal(bound?.kind, "claim");
  const [row] = await db.query("SELECT status,participant,phone FROM onboarding_requests WHERE id=$1", [r.id]);
  assert.deepEqual({ ...row }, { status: "pending", participant: null, phone: "+491701234567" });
  const [event] = await db.query("SELECT title FROM team_inbox WHERE ref=$1", [r.id]);
  assert.match(String(event.title), /Zuordnung gesucht/);
  // Ohne Profil kann das Team nicht freigeben; ein eigenes Profil entsteht auch nicht.
  await assert.rejects(decideRequest(db, admin, { id: r.id, decision: "approve" }), /passende Profil/);
  await assert.rejects(createMember(db, alice, { name: "Alice", company: "", role: "", publicConsent: false }), /gerade geprüft/);
  // Gemeinsame und vergebene Profile lassen sich auch so nicht zuordnen.
  const joint = await profile("Team X", { kind: "joint" });
  await assert.rejects(decideRequest(db, admin, { id: r.id, decision: "approve", participantId: joint }));
  const other = await profile("Bob B.", { owner: "bob" });
  await assert.rejects(decideRequest(db, admin, { id: r.id, decision: "approve", participantId: other }), /anderen Konto/);
  const ok = await decideRequest(db, admin, { id: r.id, decision: "approve", participantId: p });
  assert.equal(ok.status, "approved");
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [p]))[0].owner, "alice");
  assert.equal((await requestForActor(db, alice))?.status, "approved");
});

test("a signed-in account can ask the team for assignment once; a second path is refused", async () => {
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, { fullName: "Alice Beispiel", phone: "+49 170 1234567", hint: "Gruppe Nord" });
  const again = await requestClaimSignedIn(db, alice, { fullName: "Alice Beispiel", phone: "+49 170 1234567", hint: "Gruppe Nord, Tel." });
  assert.equal(again.id, r.id);
  assert.equal(again.repeated, true);
  await assert.rejects(requestClaimSignedIn(db, alice, details(p)), /bereits eine Übernahmeanfrage/);
  assert.equal(await count("SELECT count(*) AS n FROM onboarding_requests"), 1);
  assert.equal(await count("SELECT count(*) AS n FROM team_inbox WHERE ref=$1", [r.id]), 1);
});

test("switching between new and team assignment keeps one unconfirmed request", async () => {
  const base = { email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567" };
  const a = await startRequest(db, { kind: "new", ...base });
  const b = await startRequest(db, { kind: "claim", ...base, hint: "Doch schon Zahlen" });
  assert.equal(a.id, b.id);
  const [row] = await db.query("SELECT kind,hint FROM onboarding_requests WHERE id=$1", [a.id]);
  assert.deepEqual({ ...row }, { kind: "claim", hint: "Doch schon Zahlen" });
});

test("the form checks the full name and marks the field; German numbers work with a leading 0", async () => {
  const { errorResponse } = await import("../server/http");
  const p = await profile("Alice B.");
  const read = async (e: unknown) => (await errorResponse(e).json()) as { error: string; field?: string };
  const nick = await startRequest(db, { kind: "claim", participantId: p, email: alice.email, fullName: "Alice", phone: "0170 1234567", phoneCountry: "DE" })
    .then(() => null, (e) => e);
  assert.deepEqual(await read(nick), { error: "Bitte gib Vor- und Nachnamen an.", field: "fullName" });
  const badPhone = await startRequest(db, { kind: "new", email: alice.email, fullName: "Alice Beispiel", phone: "12", phoneCountry: "DE" })
    .then(() => null, (e) => e);
  assert.equal((await read(badPhone)).field, "phone");
  const badMail = await startRequest(db, { kind: "new", email: "alice@", fullName: "Alice Beispiel", phone: "0170 1234567" })
    .then(() => null, (e) => e);
  assert.equal((await read(badMail)).field, "email");
  const ok = await startRequest(db, { kind: "new", email: alice.email, fullName: "Alice Beispiel", phone: "0170 1234567", phoneCountry: "DE" });
  assert.equal((await db.query("SELECT phone FROM onboarding_requests WHERE id=$1", [ok.id]))[0].phone, "+491701234567");
});

test("only the browser that sent last sees its entries again, and only a real send counts as sent", async () => {
  const { browserSecret, markMailSent, pendingForBrowser } = await import("../server/onboarding");
  const p = await profile("Alice B.");
  const mine = browserSecret();
  const r = await startRequest(db, { kind: "claim", participantId: p, email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567" }, mine.proof);
  const cookie = `${r.id}.${mine.secret}`;
  const shown = await pendingForBrowser(db, cookie);
  assert.equal(shown?.email, alice.email);
  assert.equal(shown?.profile?.id, p);
  // Noch keine Übergabe an Supabase: kein „Mail geschickt“.
  assert.equal(shown?.mailSent, false);
  await markMailSent(db, r.id, alice.email);
  assert.equal((await pendingForBrowser(db, cookie))?.mailSent, true);
  // Nur die ID ohne Geheimnis, falsches Geheimnis, Unsinn: nichts.
  assert.equal(await pendingForBrowser(db, r.id), null);
  assert.equal(await pendingForBrowser(db, `${r.id}.falsch`), null);
  assert.equal(await pendingForBrowser(db, "kein-gueltiger-wert"), null);
  assert.equal(await pendingForBrowser(db, undefined), null);
  // Jemand anderes sendet danach für dieselbe Adresse: der erste Browser sieht
  // die neuen Angaben nicht, und nach einem neuen Absenden gilt „nicht versendet“.
  const other = browserSecret();
  await startRequest(db, { kind: "claim", participantId: p, email: alice.email, fullName: "Mallory Fremd", phone: "+49 171 9999999" }, other.proof);
  assert.equal(await pendingForBrowser(db, cookie), null);
  const theirs = await pendingForBrowser(db, `${r.id}.${other.secret}`);
  assert.equal(theirs?.fullName, "Mallory Fremd");
  assert.equal(theirs?.mailSent, false);
  await bindConfirmedRequest(db, alice, r.id);
  assert.equal(await pendingForBrowser(db, `${r.id}.${other.secret}`), null);
});

test("a person without an account cannot read what the real owner of an address enters later", async () => {
  const { browserSecret, pendingForBrowser } = await import("../server/onboarding");
  const attacker = browserSecret();
  const a = await startRequest(db, { kind: "new", email: alice.email, fullName: "Irgend Wer", phone: "+49 171 9999999" }, attacker.proof);
  const victim = browserSecret();
  const v = await startRequest(db, { kind: "new", email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567", }, victim.proof);
  assert.equal(a.id, v.id);
  assert.equal(await pendingForBrowser(db, `${a.id}.${attacker.secret}`), null);
  assert.equal((await pendingForBrowser(db, `${v.id}.${victim.secret}`))?.fullName, "Alice Beispiel");
});

test("a taken profile shows up as taken for the browser that asked for it", async () => {
  const { browserSecret, pendingForBrowser } = await import("../server/onboarding");
  const p = await profile("Alice B.");
  const bobRequest = await requestClaimSignedIn(db, bob, details(p, { fullName: "Bob Beispiel" }));
  const mine = browserSecret();
  const r = await startRequest(db, { kind: "claim", participantId: p, email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567" }, mine.proof);
  await decideRequest(db, admin, { id: bobRequest.id, decision: "approve" });
  const shown = await pendingForBrowser(db, `${r.id}.${mine.secret}`);
  assert.equal(shown?.profileTaken, true);
  assert.equal(shown?.takenName, "Alice B.");
  assert.equal(shown?.profile, null);
});

test("switching from a chosen profile to team assignment never blocks the team's approval", async () => {
  const p = await profile("Alice B.");
  const base = { email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567" };
  const first = await startRequest(db, { kind: "claim", participantId: p, ...base });
  const assign = await startRequest(db, { kind: "claim", ...base, hint: "Doch lieber das Team" });
  assert.notEqual(first.id, assign.id);
  await bindConfirmedRequest(db, alice, assign.id);
  // Die andere, unbestätigte Anfrage ist erledigt.
  assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [first.id]))[0].status, "superseded");
  const ok = await decideRequest(db, admin, { id: assign.id, decision: "approve", participantId: p });
  assert.equal(ok.status, "approved");
  // Auch wenn eine ältere offene Anfrage derselben Adresse übrig wäre: kein Konflikt.
  const q = await profile("Bob B.");
  await startRequest(db, { kind: "claim", participantId: q, email: bob.email, fullName: "Bob Beispiel", phone: "+49 171 7654321" });
  const bobAssign = await requestClaimSignedIn(db, bob, { fullName: "Bob Beispiel", phone: "+49 171 7654321" });
  const done = await decideRequest(db, admin, { id: bobAssign.id, decision: "approve", participantId: q });
  assert.equal(done.status, "approved");
});

test("sending again for an invitation-only profile does not need the code a second time", async () => {
  const p = await profile("Verborgen B.", { searchable: false });
  const { token } = await issueClaim(db, admin, p);
  const base = { kind: "claim", participantId: p, email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567" };
  await assert.rejects(startRequest(db, base), /persönliche Einladung/);
  const first = await startRequest(db, { ...base, invite: token });
  const again = await startRequest(db, base);
  assert.equal(again.id, first.id);
  // Ohne vorherige Anfrage bleibt die Einladung nötig.
  await assert.rejects(startRequest(db, { ...base, email: bob.email }), /persönliche Einladung/);
});

test("sign-in errors become clear messages with a real waiting time", async () => {
  const { codeFailure, linkFailureReason, sendFailure } = await import("../server/email-auth");
  const wait = sendFailure({ status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 42 seconds." });
  assert.equal(wait.status, 429);
  assert.equal(wait.retryAfter, 42);
  assert.match(wait.message, /42 Sekunden/);
  // Stündliches Kontingent ohne genannte Restzeit: keine erfundene Zahl.
  const quota = sendFailure({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" });
  assert.equal(quota.retryAfter, undefined);
  assert.doesNotMatch(quota.message, /\d/);
  assert.equal(codeFailure({ status: 429, code: "over_request_rate_limit" }).retryAfter, undefined);
  assert.equal(sendFailure({ status: 400, code: "email_address_invalid" }).status, 400);
  assert.equal(sendFailure({ status: 500 }).status, 503);
  assert.match(codeFailure({ status: 403, code: "otp_expired" }).message, /passt nicht oder gilt nicht mehr/);
  assert.equal(codeFailure({ status: 429, code: "over_request_rate_limit" }).status, 429);
  assert.equal(codeFailure({ status: 502 }).status, 503);
  assert.equal(linkFailureReason({ status: 403, code: "otp_expired" }), "abgelaufen");
  assert.equal(linkFailureReason({ status: 404, code: "flow_state_not_found" }), "verwendet");
  assert.equal(linkFailureReason({ status: 503 }), "technik");
  assert.equal(linkFailureReason({ status: 400, code: "validation_failed" }), "link");
});

test("the waiting browser learns about a confirmation on another device, nobody else does", async () => {
  const { browserSecret, browserRequestState, noteLinkOpened } = await import("../server/onboarding");
  const mine = browserSecret();
  const r = await startRequest(db, { kind: "new", email: alice.email, fullName: "Alice Beispiel", phone: "0170 1234567", phoneCountry: "DE" }, mine.proof);
  const cookie = `${r.id}.${mine.secret}`;
  assert.equal(await browserRequestState(db, cookie), "waiting");
  // Ohne oder mit falschem Geheimnis: nichts zu erfahren.
  assert.equal(await browserRequestState(db, undefined), "none");
  assert.equal(await browserRequestState(db, r.id), "none");
  assert.equal(await browserRequestState(db, `${r.id}.${browserSecret().secret}`), "none");
  // Link auf dem Handy geöffnet (Supabase hat bestätigt, dort ohne Sitzung).
  await noteLinkOpened(db, r.id);
  await noteLinkOpened(db, r.id);
  assert.equal(await count("SELECT count(*) AS n FROM onboarding_events WHERE request=$1 AND action='link_opened'", [r.id]), 1);
  assert.equal(await browserRequestState(db, cookie), "confirmed");
  // Unsinn oder unbekannte IDs werden still ignoriert.
  await noteLinkOpened(db, "kein-gueltiger-wert");
  await noteLinkOpened(db, randomUUID());
  await noteLinkOpened(db, null);
  // Neues Absenden: der alte Link zählt nicht mehr als Bestätigung.
  const again = await startRequest(db, { kind: "new", email: alice.email, fullName: "Alice Beispiel", phone: "0170 1234567", phoneCountry: "DE" }, mine.proof);
  assert.equal(again.id, r.id);
  assert.equal(await browserRequestState(db, cookie), "waiting");
  // Bestätigt und an das Konto gebunden: „confirmed“, auch ohne Link-Hinweis.
  await bindConfirmedRequest(db, alice, r.id);
  assert.equal(await browserRequestState(db, cookie), "confirmed");
  // Nach der Bindung legt ein Link-Hinweis nichts mehr an.
  await noteLinkOpened(db, r.id);
  assert.equal(await count("SELECT count(*) AS n FROM onboarding_events WHERE request=$1 AND action='link_opened'", [r.id]), 1);
});

test("team pushes: named, linked to the entry, exactly once, only for registration and takeover", async () => {
  const pushes = () =>
    db.query("SELECT kind,title,body,url FROM notifications WHERE channel='push' ORDER BY id");
  // Neue Registrierung: bestätigt, dann Neuladen, erneuter Link, späteres Anmelden.
  const reg = await startRequest(db, { kind: "new", email: bob.email, fullName: "Bob Beispiel", phone: "0170 7654321", phoneCountry: "DE" });
  await bindConfirmedRequest(db, bob, reg.id);
  await bindConfirmedRequest(db, bob, reg.id);
  await noteConfirmedAccount(db, bob);
  const [inbox] = await db.query("SELECT id FROM team_inbox WHERE dedupe_key=$1", [`registration:${reg.id}`]);
  assert.deepEqual((await pushes()).map((n) => ({ ...n })), [
    {
      kind: "team:new",
      title: "Neue Registrierung",
      body: "Bob Beispiel hat sich bei Deal Operator registriert.",
      url: `/verwaltung?bereich=inbox&eintrag=${inbox.id}`,
    },
  ]);
  // Profilübernahme über die Registrierung.
  const p = await profile("Alice B.");
  const claim = await startRequest(db, { kind: "claim", participantId: p, email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567" });
  await bindConfirmedRequest(db, alice, claim.id);
  await bindConfirmedRequest(db, alice, claim.id);
  const last = (await pushes()).at(-1)!;
  assert.deepEqual({ ...last }, {
    kind: "team:claim",
    title: "Profilübernahme prüfen",
    body: "Alice Beispiel möchte das Profil Alice B. übernehmen.",
    url: `/verwaltung?bereich=uebernahmen&anfrage=${claim.id}`,
  });
  // Rückfrage und Antwort: kein weiterer Push.
  await decideRequest(db, admin, { id: claim.id, decision: "info", applicantMessage: "Unter welchem Namen callst du?" });
  await answerInfoRequest(db, alice, { message: "Als Ali" });
  const all = await pushes();
  assert.equal(all.length, 2);
  // Nie Kontaktdaten im Push, auch nicht in der E-Mail-Absicherung.
  const every = await db.query("SELECT title,body FROM notifications");
  for (const n of every) assert.doesNotMatch(`${n.title} ${n.body}`, /@|\+49|0170|1234567/);
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE channel='email'"), 2);
});

test("a signed-in takeover pushes once with the requested profile; assignment requests say the profile is open", async () => {
  const p = await profile("Alice B.");
  const r = await requestClaimSignedIn(db, alice, details(p));
  await requestClaimSignedIn(db, alice, details(p));
  const [push] = await db.query("SELECT title,body,url FROM notifications WHERE channel='push'");
  assert.equal(push.title, "Profilübernahme prüfen");
  assert.equal(push.body, "Alice Beispiel möchte das Profil Alice B. übernehmen.");
  assert.equal(push.url, `/verwaltung?bereich=uebernahmen&anfrage=${r.id}`);
  const open = await requestClaimSignedIn(db, bob, { fullName: "Bob Beispiel", phone: "+49 171 1234567", hint: "Gruppe Nord" });
  const [other] = await db.query("SELECT body,url FROM notifications WHERE channel='push' AND ref=$1", [`registration:${open.id}`]);
  assert.match(other.body, /^Bob Beispiel möchte ein bestehendes Profil übernehmen\./);
  assert.equal(other.url, `/verwaltung?bereich=uebernahmen&anfrage=${open.id}`);
});
