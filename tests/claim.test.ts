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
  assert.equal(await count("SELECT count(*) AS n FROM notifications WHERE kind='team:answer'"), 2);
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
    kind: "claim", participantId: q, email: alice.email, fullName: "Fremd", phone: "+49 171 9999999",
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
