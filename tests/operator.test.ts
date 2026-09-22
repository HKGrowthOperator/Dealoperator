import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database, placeholders } from "../server/database";
import {
  commitImport,
  issueClaim,
  ownState,
  previewImport,
  publicRanking,
  saveCheckin,
  updateAccount,
} from "../server/operator";
import { loadOwnRecords } from "../server/records";
import {
  bindConfirmedRequest,
  decideRequest,
  profileForSelection,
  reviewQueue,
  searchProfiles,
  startRequest,
} from "../server/onboarding";
import {
  aggregate,
  berlinDate,
  emptyCounts,
  parseImport,
  progress,
  ranked,
  type ImportRow,
} from "../lib/kpis";
import { handleWorkflow, loadWorkflows } from "../app/api/community/workflows";
const admin = { userId: "admin", email: "admin@example.invalid", admin: true };
const alice = { userId: "alice", email: "alice@example.invalid", admin: false };
const bob = { userId: "bob", email: "bob@example.invalid", admin: false };
let pg: PGlite, db: Database;
before(async () => {
  pg = new PGlite();
  await pg.exec(
    await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"),
  );
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as any, (fn) =>
    pg.transaction((tx) => fn(new Database(tx as any))),
  );
});
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE participants,profiles,records,requests,account_private,rate_limits,posts,buddies,relationships,preferences,entitlements,sessions,onboarding_requests,onboarding_events CASCADE",
  );
});
after(async () => {
  await pg.close();
});
const counts = () => ({
  ...emptyCounts(),
  attempts: 100,
  decisionMakerConversations: 20,
  settingsBooked: 5,
  settingsHeld: 3,
  closingsBooked: 3,
  closingsHeld: 2,
  dealsWon: 1,
});
const row = (extra: Partial<ImportRow> = {}): ImportRow => ({
  participantKey: "alice-import",
  name: "Alice Beispiel",
  company: "Beispiel GmbH",
  role: "Sales",
  email: alice.email,
  date: berlinDate(),
  counts: counts(),
  publicConsent: true,
  ...extra,
});
async function imported(rows = [row()]) {
  const expected = await previewImport(db, rows);
  await commitImport(db, admin, { rows, expected, key: randomUUID() });
  return (await db.query("SELECT id FROM participants ORDER BY import_key"))[0]
    .id as string;
}
/** Vollständiger neuer Ablauf: Anfrage, E-Mail-Bestätigung, Teamfreigabe. */
async function request(
  participantId: string,
  actor: typeof alice,
  extra: Record<string, unknown> = {},
) {
  await startRequest(db, {
    kind: "claim",
    participantId,
    fullName: "Test Person",
    email: actor.email,
    phone: "+4917012345678",
    hint: "",
    ...extra,
  });
  const bound = await bindConfirmedRequest(db, actor);
  return bound!.id;
}
async function takeOver(participantId: string, actor: typeof alice) {
  // startRequest legt für dieselbe Person und dasselbe Profil bewusst keine
  // zweite offene Anfrage an, deshalb hier nur anfragen, wenn noch keine läuft.
  const [open] = await db.query(
    `SELECT id FROM onboarding_requests
     WHERE owner=$1 AND participant=$2 AND status IN ('pending','info_needed')`,
    [actor.userId, participantId],
  );
  const id = open ? (open.id as string) : await request(participantId, actor);
  return decideRequest(db, admin, {
    id,
    decision: "approve",
    internalNote: "Abgeglichen",
    applicantMessage: "",
  });
}
function checkin(extra: any = {}) {
  return {
    date: berlinDate(),
    counts: counts(),
    reflection: {
      win: "Privates Learning",
      next: "Nächster Call",
      help: "Private Frage",
      energy: 7,
    },
    expectedRevision: 1,
    idempotencyKey: randomUUID(),
    ...extra,
  };
}

test("ranking uses competition ties and does not treat missing as zero", () => {
  const r = (id: string, n: number | null) => ({
    id,
    name: id,
    company: "",
    role: "",
    claimed: false,
    counts: { ...emptyCounts(), attempts: n },
    source: "",
    updatedAt: "",
  });
  assert.deepEqual(
    ranked([r("a", null), r("b", 0), r("c", 10), r("d", 10)], "attempts").map(
      (x) => [x.id, x.rank],
    ),
    [
      ["c", 1],
      ["d", 1],
      ["b", 3],
      ["a", null],
    ],
  );
});
test("four independent pilot rank thresholds and corrections", () => {
  const p = progress(counts());
  assert.deepEqual(
    p.map((x) => x.tier),
    ["Bronze", "Bronze", "Bronze", "Bronze"],
  );
  assert.equal(progress({ ...counts(), settingsBooked: 4 })[1].tier, null);
  for (const t of p) {
    for (const threshold of t.thresholds) {
      assert.ok(
        progress({ ...emptyCounts(), [t.metric]: threshold }).find(
          (x) => x.id === t.id,
        )?.tier,
      );
    }
  }
  assert.equal(aggregate([emptyCounts()]).attempts, null);
});
test("CSV preserves unknowns, zero, quotes, and legacy values", () => {
  const parsed = parseImport(
    `participantKey;name;date;attempts;dealsWon;legacyMeetings;publicConsent\nx1;"Alex; Beispiel";${berlinDate()};10;0;2;false`,
  );
  assert.equal(parsed[0].name, "Alex; Beispiel");
  assert.equal(parsed[0].counts.settingsBooked, null);
  assert.equal(parsed[0].counts.dealsWon, 0);
  assert.equal(parsed[0].counts.legacyMeetings, 2);
  assert.equal(parsed[0].publicConsent, false);
});
test("CSV rejects duplicate days, negatives, invalid dates and ambiguous consent", () => {
  for (const text of [
    `participantKey;name;date;attempts\nx1;Alex;${berlinDate()};-1`,
    `participantKey;name;date\nx1;Alex;2026-02-30`,
    `participantKey;name;date;publicConsent\nx1;Alex;${berlinDate()};ja`,
    JSON.stringify([row(), row()]),
  ])
    assert.throws(() => parseImport(text));
});
test("binding cannot replace question marks inside SQL literals", () => {
  assert.equal(
    placeholders("SELECT '?' AS literal, 'can''t?' AS text WHERE id=?"),
    "SELECT '?' AS literal, 'can''t?' AS text WHERE id=$1",
  );
});
test("import preview and import commit keep contact data off public API", async () => {
  const id = await imported();
  const rows = await publicRanking(db, berlinDate(), berlinDate());
  assert.equal(rows[0].id, id);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "claimed",
    "company",
    "counts",
    "id",
    "name",
    "role",
    "source",
    "updatedAt",
  ]);
  assert.ok(!JSON.stringify(rows).includes(alice.email));
  assert.equal(rows[0].claimed, false);
});
test("private imported participant stays out of public ranking", async () => {
  await imported([row({ publicConsent: false })]);
  assert.deepEqual(await publicRanking(db, berlinDate(), berlinDate()), []);
});
test("non-admin cannot import or create claim invitations", async () => {
  await assert.rejects(
    commitImport(db, alice, { rows: [row()] }),
    /Verwaltung/,
  );
  const id = await imported();
  await assert.rejects(issueClaim(db, alice, id), /Verwaltung/);
});
test("a confirmed email alone never hands over a prepared profile", async () => {
  const id = await imported();
  // Passende E-Mail, bestätigte Sitzung — und trotzdem kein Zugriff, solange
  // das Team nicht freigegeben hat.
  await request(id, alice);
  const waiting = await ownState(db, alice);
  assert.equal(waiting.participant, null);
  assert.equal(waiting.records.length, 0);
  assert.equal(waiting.request.status, "pending");
  assert.equal(
    (await db.query("SELECT owner FROM participants WHERE id=$1", [id]))[0]
      .owner,
    null,
  );
  await takeOver(id, alice);
  const state = await ownState(db, alice);
  assert.equal(state.participant.id, id);
  assert.equal(state.records[0].counts.attempts, 100);
  assert.equal(state.progress[0].tier, "Bronze");
  assert.equal((await ownState(db, bob)).records.length, 0);
  assert.equal(
    (await loadOwnRecords(db, alice.userId)).results.map((r) =>
      JSON.parse(r.data),
    )[0].counts.settingsBooked,
    5,
  );
});
test("only the team can decide, and members cannot decide for themselves", async () => {
  const id = await imported();
  const requestId = await request(id, alice);
  await assert.rejects(
    decideRequest(db, alice, { id: requestId, decision: "approve" }),
    /Verwaltung/,
  );
  await assert.rejects(reviewQueue(db, alice), /Verwaltung/);
  assert.equal(
    (await db.query("SELECT owner FROM participants WHERE id=$1", [id]))[0]
      .owner,
    null,
  );
});
test("two competing requests stay visible and exactly one wins the profile", async () => {
  const id = await imported();
  const first = await request(id, alice);
  const second = await request(id, bob);
  const queue = await reviewQueue(db, admin);
  assert.equal(queue.filter((r: any) => r.participant === id).length, 2);
  assert.equal(Number(queue[0].competing), 1);
  await decideRequest(db, admin, { id: first, decision: "approve" });
  // Die zweite Anfrage verliert jeden Zugriff, ohne dass jemand sie anfassen muss.
  await assert.rejects(
    decideRequest(db, admin, { id: second, decision: "approve" }),
    /bereits abschließend entschieden/,
  );
  const rows = await db.query(
    "SELECT id,status FROM onboarding_requests ORDER BY created_at",
  );
  assert.deepEqual(
    rows.map((r: any) => r.status).sort(),
    ["approved", "superseded"],
  );
  assert.equal((await ownState(db, alice)).participant.id, id);
  assert.equal((await ownState(db, bob)).participant, null);
});
test("an approved profile is protected against later requests and stale links", async () => {
  const id = await imported();
  await takeOver(id, alice);
  // Direktlink oder veraltete Ansicht: die Auswahl selbst wird abgewiesen.
  await assert.rejects(
    startRequest(db, {
      kind: "claim",
      participantId: id,
      fullName: "Fremde Person",
      email: bob.email,
      phone: "+4917012345678",
      hint: "",
    }),
    /bereits einem Konto zugeordnet/,
  );
  assert.equal((await searchProfiles(db, "Alice")).length, 0);
});
test("an invitation only unlocks selection and still needs the team", async () => {
  const id = await imported([row({ email: "" })]);
  await db.query("UPDATE participants SET searchable=false WHERE id=$1", [id]);
  assert.equal((await searchProfiles(db, "Alice")).length, 0);
  // Ohne Einladung ist ein nicht auffindbares Profil nicht wählbar.
  await assert.rejects(
    startRequest(db, {
      kind: "claim",
      participantId: id,
      fullName: "Bob Caller",
      email: bob.email,
      phone: "+4917012345678",
      hint: "",
    }),
    /persönliche Einladung/,
  );
  const invite = await issueClaim(db, admin, id);
  const stored = await db.query("SELECT * FROM claim_tokens");
  assert.notEqual(stored[0].hash, invite.token);
  await startRequest(db, {
    kind: "claim",
    participantId: id,
    invite: invite.token,
    fullName: "Bob Caller",
    email: bob.email,
    phone: "+4917012345678",
    hint: "",
  });
  // Die Einladung allein überträgt nichts.
  await bindConfirmedRequest(db, bob);
  assert.equal((await ownState(db, bob)).participant, null);
  const [open] = await db.query(
    "SELECT id FROM onboarding_requests WHERE owner=$1",
    [bob.userId],
  );
  await decideRequest(db, admin, { id: open.id, decision: "approve" });
  assert.equal((await ownState(db, bob)).records[0].counts.attempts, 100);
  // Nach der Freigabe ist der Code verbraucht.
  assert.equal(
    (await db.query("SELECT used_at FROM claim_tokens WHERE participant=$1", [id]))[0]
      .used_at !== null,
    true,
  );
});
test("approval refuses when the account already owns a profile", async () => {
  const id = await imported();
  const requestId = await request(id, alice);
  await db.query("INSERT INTO participants(id,name,owner) VALUES($1,$2,$3)", [
    "other",
    "Existing",
    alice.userId,
  ]);
  await assert.rejects(
    decideRequest(db, admin, { id: requestId, decision: "approve" }),
    /bereits ein Profil/,
  );
  assert.equal(
    (await db.query("SELECT owner FROM participants WHERE id=$1", [id]))[0]
      .owner,
    null,
  );
});
test("rejection and a follow-up question keep the numbers untouched", async () => {
  const id = await imported();
  const requestId = await request(id, alice);
  await decideRequest(db, admin, {
    id: requestId,
    decision: "info",
    internalNote: "Nummer passt nicht zum WhatsApp-Kontakt",
    applicantMessage: "Bitte nenne uns deinen Namen im Gruppenchat.",
  });
  let [r] = await db.query("SELECT * FROM onboarding_requests WHERE id=$1", [
    requestId,
  ]);
  assert.equal(r.status, "info_needed");
  await decideRequest(db, admin, {
    id: requestId,
    decision: "reject",
    internalNote: "Keine Rückmeldung",
    applicantMessage: "Wir konnten die Zuordnung nicht bestätigen.",
  });
  [r] = await db.query("SELECT * FROM onboarding_requests WHERE id=$1", [
    requestId,
  ]);
  assert.equal(r.status, "rejected");
  assert.equal(r.decided_by, admin.userId);
  assert.ok(r.decided_at);
  assert.equal((await ownState(db, alice)).participant, null);
  assert.equal(
    (await db.query("SELECT owner FROM participants WHERE id=$1", [id]))[0]
      .owner,
    null,
  );
  // Jede Entscheidung ist mit Bearbeiter und Zeitpunkt protokolliert.
  const events = await db.query(
    "SELECT action,actor FROM onboarding_events WHERE request=$1 ORDER BY id",
    [requestId],
  );
  assert.deepEqual(
    events.map((e: any) => e.action),
    ["submitted", "email_confirmed", "info_requested", "rejected"],
  );
});
test("the public search never exposes contact data or claimed profiles", async () => {
  const id = await imported();
  const [found] = await searchProfiles(db, "Alice");
  assert.deepEqual(Object.keys(found).sort(), [
    "company",
    "id",
    "name",
    "role",
  ]);
  assert.equal(found.id, id);
  // Zu kurze Eingaben liefern nichts, damit die Liste nicht abgegrast wird.
  assert.deepEqual(await searchProfiles(db, "A"), []);
});
test("corrected checkin replaces totals, changes only relevant rank and queues sync", async () => {
  const id = await imported();
  await takeOver(id, alice);
  const r = await saveCheckin(
    db,
    alice,
    checkin({ counts: { ...counts(), settingsBooked: 4 } }),
  );
  assert.equal(r.revision, 2);
  const s = await ownState(db, alice);
  assert.equal(s.records.length, 1);
  assert.equal(s.progress[0].tier, "Bronze");
  assert.equal(s.progress[1].tier, null);
  assert.equal(s.records[0].counts.settingsBooked, 4);
  assert.equal((await db.query("SELECT * FROM sync_outbox")).length, 1);
  assert.ok(
    !JSON.stringify(
      await publicRanking(db, berlinDate(), berlinDate()),
    ).includes("Privates Learning"),
  );
});
test("request retry is idempotent, conflicting reuse and stale revisions fail", async () => {
  const id = await imported();
  await takeOver(id, alice);
  const v = checkin({ counts: { ...counts(), attempts: 500 } });
  const first = await saveCheckin(db, alice, v);
  assert.deepEqual(await saveCheckin(db, alice, v), first);
  await assert.rejects(
    saveCheckin(db, alice, { ...v, counts: { ...counts(), attempts: 999 } }),
    /anderen Werten/,
  );
  await assert.rejects(
    saveCheckin(db, alice, checkin()),
    /inzwischen geändert/,
  );
  assert.equal((await ownState(db, alice)).progress[0].value, 500);
});
test("checkin supports previous-day sourced appointments and rejects future dates", async () => {
  const id = await imported();
  await takeOver(id, alice);
  await saveCheckin(
    db,
    alice,
    checkin({
      counts: {
        ...emptyCounts(),
        attempts: 0,
        decisionMakerConversations: 0,
        settingsBooked: 8,
      },
    }),
  );
  assert.equal((await ownState(db, alice)).records[0].counts.settingsBooked, 8);
  await assert.rejects(saveCheckin(db, alice, checkin({ date: "2099-01-01" })));
});
test("stale import preview rolls back whole import including newly introduced participants", async () => {
  const id = await imported();
  const rows = [
    row({ participantKey: "new-person", name: "New Person" }),
    row(),
  ];
  const expected = await previewImport(db, rows);
  await takeOver(id, alice);
  await saveCheckin(
    db,
    alice,
    checkin({ counts: { ...counts(), attempts: 200 } }),
  );
  await assert.rejects(
    commitImport(db, admin, { rows, expected, key: randomUUID() }),
    /Datenstand/,
  );
  assert.equal((await db.query("SELECT id FROM participants")).length, 1);
});
test("withdrawal hides public data and a subsequent owner import cannot override member consent", async () => {
  const id = await imported();
  await takeOver(id, alice);
  await updateAccount(db, alice, {
    name: "Alice",
    company: "Firma",
    role: "Sales",
    publicConsent: false,
    phone: "+49 000 123",
    contactOptIn: false,
  });
  await imported();
  assert.equal((await publicRanking(db, berlinDate(), berlinDate())).length, 0);
  assert.equal((await ownState(db, alice)).contact.phone, "+49 000 123");
});
test("schema refuses access from an unprivileged browser database role", async () => {
  await pg.exec("CREATE ROLE browser_test");
  try {
    await pg.exec("SET ROLE browser_test");
    await assert.rejects(
      db.query("SELECT * FROM operator.participants"),
      /permission denied/,
    );
  } finally {
    await pg.exec("RESET ROLE; DROP ROLE browser_test");
  }
});
test("existing free discussion workflows run on PostgreSQL and enforce ownership", async () => {
  await db.query("INSERT INTO profiles(id,data) VALUES($1,$2)", [
    alice.userId,
    JSON.stringify({ name: "Alice" }),
  ]);
  const r = await handleWorkflow(db, alice.userId, {
    action: "post",
    value: {
      title: "Ein echtes Learning",
      body: "Der kürzere Einstieg hat heute funktioniert.",
      category: "Learning",
    },
  });
  assert.equal(r?.status, 200);
  const state = await loadWorkflows(db, bob.userId);
  assert.equal(state.posts.length, 1);
  const denied = await handleWorkflow(db, bob.userId, {
    action: "archivePost",
    value: state.posts[0].id,
  });
  assert.equal(denied?.status, 403);
  assert.equal(state.registerEnabled, false);
});
test("private buddy messages and partner register remain restricted", async () => {
  const denied = await handleWorkflow(db, bob.userId, {
    action: "buddyMessage",
    value: { thread: "foreign-thread", body: "test" },
  });
  assert.equal(denied?.status, 403);
  const gated = await handleWorkflow(db, bob.userId, {
    action: "relationship",
    value: {},
  });
  assert.equal(gated?.status, 403);
});

test("same daily content with a new request key does not increase revisions or sync work", async () => {
  const id = await imported();
  await takeOver(id, alice);
  const first = await saveCheckin(db, alice, checkin());
  const queue = (
    await db.query("SELECT revision FROM sync_outbox WHERE participant=$1", [
      id,
    ])
  )[0].revision;
  const second = await saveCheckin(
    db,
    alice,
    checkin({ expectedRevision: first.revision }),
  );
  assert.equal(second.revision, first.revision);
  assert.equal(
    (
      await db.query("SELECT revision FROM sync_outbox WHERE participant=$1", [
        id,
      ])
    )[0].revision,
    queue,
  );
});
test("new member creates a private profile and existing legacy records remain readable", async () => {
  await db.query("INSERT INTO profiles(id,data) VALUES($1,$2)", [
    bob.userId,
    JSON.stringify({ name: "Bob" }),
  ]);
  await db.query("INSERT INTO records(owner,date,data) VALUES($1,$2,$3)", [
    bob.userId,
    "2026-01-01",
    JSON.stringify({
      date: "2026-01-01",
      attempts: 42,
      conversations: 7,
      meetings: 2,
    }),
  ]);
  await saveCheckin(db, bob, checkin({ expectedRevision: 0 }));
  const state = await ownState(db, bob);
  assert.equal(state.participant.public_consent, false);
  assert.equal((await loadOwnRecords(db, bob.userId)).results.length, 2);
  assert.equal(
    (
      await db.query("SELECT email FROM account_private WHERE owner=$1", [
        bob.userId,
      ])
    )[0].email,
    bob.email,
  );
});
test("failed outbox write rolls back checkin, audit and idempotency receipt together", async () => {
  const id = await imported();
  await takeOver(id, alice);
  const before = await db.query("SELECT counts,revision FROM checkins");
  await db.query(
    "ALTER TABLE sync_outbox ADD CONSTRAINT forced_test_failure CHECK(revision<100) NOT VALID",
  );
  await db.query("UPDATE sync_outbox SET revision=99");
  const value = checkin({ counts: { ...counts(), attempts: 555 } });
  await assert.rejects(saveCheckin(db, alice, value));
  assert.deepEqual(
    await db.query("SELECT counts,revision FROM checkins"),
    before,
  );
  assert.equal(
    (
      await db.query("SELECT key FROM requests WHERE actor=$1 AND key=$2", [
        alice.userId,
        value.idempotencyKey,
      ])
    ).length,
    0,
  );
  await db.query("ALTER TABLE sync_outbox DROP CONSTRAINT forced_test_failure");
});

test("private contact inventory is restricted to admins", async () => {
  const { adminContacts } = await import("../server/operator");
  const id = await imported();
  await takeOver(id, alice);
  await updateAccount(db, alice, {
    name: "Alice",
    company: "Firma",
    role: "Sales",
    publicConsent: true,
    phone: "Private phone",
    contactOptIn: false,
  });
  await assert.rejects(adminContacts(db, bob), /Verwaltung/);
  const contacts = await adminContacts(db, admin);
  assert.equal(contacts[0].verified_email, alice.email);
  assert.equal(contacts[0].phone, "Private phone");
  assert.ok(
    !JSON.stringify(
      await publicRanking(db, berlinDate(), berlinDate()),
    ).includes("Private phone"),
  );
});
test("session capacity, ownership and cancellation are guarded inside a transaction", async () => {
  const { toggleAttendance, editSession } = await import("../server/sessions");
  const value = {
    title: "Test Session",
    capacity: 2,
    startsAt: "2099-01-01T10:00:00Z",
  };
  await db.query("INSERT INTO sessions(id,owner,data) VALUES($1,$2,$3)", [
    "session",
    admin.userId,
    JSON.stringify(value),
  ]);
  await toggleAttendance(db, alice.userId, "session");
  await toggleAttendance(db, bob.userId, "session");
  await assert.rejects(toggleAttendance(db, "third", "session"), /voll/);
  await assert.rejects(
    editSession(db, bob.userId, "session", { ...value, capacity: 10 }),
    /eigene/,
  );
  await assert.rejects(
    editSession(db, admin.userId, "session", { ...value, capacity: 1 }),
    /kleiner/,
  );
  await toggleAttendance(db, bob.userId, "session");
  assert.equal((await db.query("SELECT * FROM rsvps")).length, 1);
  await editSession(db, admin.userId, "session", { ...value, cancelled: true });
  await assert.rejects(toggleAttendance(db, bob.userId, "session"), /abgesagt/);
});

test("onboarding creates a private member who can immediately save and retain own numbers", async () => {
  const { createMember } = await import("../server/operator");
  const result = await createMember(db, bob, {
    name: "Bob Caller",
    company: "Studio",
    role: "Setter",
    publicConsent: false,
  });
  await saveCheckin(db, bob, checkin({ expectedRevision: 0 }));
  const state = await ownState(db, bob);
  assert.equal(state.participant.id, result.id);
  assert.equal(state.participant.name, "Bob Caller");
  assert.equal(state.records[0].counts.attempts, 100);
  assert.equal(state.email, bob.email);
  assert.equal((await publicRanking(db, berlinDate(), berlinDate())).length, 0);
  assert.equal((await ownState(db, alice)).records.length, 0);
});
test("an open takeover request blocks a second empty profile", async () => {
  const { createMember } = await import("../server/operator");
  const id = await imported();
  await request(id, alice);
  // Während die Prüfung läuft, entsteht kein zweites Profil mit leeren Zahlen.
  await assert.rejects(
    createMember(db, alice, {
      name: "Alice",
      company: "",
      role: "",
      publicConsent: true,
    }),
    /wird gerade geprüft/,
  );
  await assert.rejects(saveCheckin(db, alice, checkin()), /wird gerade geprüft/);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM participants"))[0].n,
    1,
  );
});
test("a rejected applicant can still start a separate new profile", async () => {
  const { createMember } = await import("../server/operator");
  const id = await imported();
  const requestId = await request(id, alice);
  await decideRequest(db, admin, { id: requestId, decision: "reject" });
  const result = await createMember(db, alice, {
    name: "Alice neu",
    company: "",
    role: "",
    publicConsent: false,
  });
  assert.notEqual(result.id, id);
  // Die vorbereiteten Zahlen bleiben unangetastet beim alten Profil.
  assert.equal((await ownState(db, alice)).records.length, 0);
  assert.equal(
    (await db.query("SELECT counts FROM checkins WHERE participant=$1", [id]))
      .length,
    1,
  );
});
test("profile details stay consistent between ranking and member workspace", async () => {
  const { createMember } = await import("../server/operator");
  await createMember(db, bob, {
    name: "Bob",
    company: "",
    role: "",
    publicConsent: false,
  });
  await updateAccount(db, bob, {
    name: "Bob Caller",
    company: "Studio",
    role: "Closer",
    publicConsent: true,
    phone: "",
    contactOptIn: false,
  });
  const profile = JSON.parse(
    (await db.query("SELECT data FROM profiles WHERE id=$1", [bob.userId]))[0]
      .data,
  );
  assert.equal(profile.name, "Bob Caller");
  assert.equal(profile.role, "Closer");
  assert.equal((await ownState(db, bob)).participant.name, profile.name);
});
test("restricted runtime role can serve the app without owning tables or changing schema", async () => {
  const { inspectDatabase } = await import("../server/readiness");
  await pg.exec(
    await readFile(
      new URL("../database/runtime-role.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.exec("SET ROLE operator_app");
  try {
    assert.equal(await inspectDatabase(db), true);
    await db.query("INSERT INTO profiles(id,data) VALUES($1,$2)", [
      "role-test",
      "{}",
    ]);
    await assert.rejects(
      db.query("ALTER TABLE profiles ADD COLUMN unauthorized text"),
    );
  } finally {
    await pg.exec("RESET ROLE");
  }
});

test("repeated submissions never create a second request or a second profile", async () => {
  const id = await imported();
  const send = () =>
    startRequest(db, {
      kind: "claim",
      participantId: id,
      fullName: "Alice Beispiel",
      email: alice.email,
      phone: "+4917012345678",
      hint: "",
    });
  // Wiederholte Klicks oder ein erneut angeforderter Link aktualisieren
  // dieselbe Anfrage, statt eine zweite offene anzulegen.
  for (let i = 0; i < 3; i++) await send();
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM onboarding_requests"))[0].n,
    1,
  );
  await bindConfirmedRequest(db, alice);
  // Auch nach der Bestätigung entsteht nichts Zweites: die laufende Anfrage
  // wird weiter aktualisiert, nicht dupliziert.
  const again = await send();
  assert.equal(again.resubmitted, true);
  const rows = await db.query("SELECT status FROM onboarding_requests");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM participants"))[0].n,
    1,
  );
  // Die Missbrauchsgrenze bleibt bestehen: nach fünf Anforderungen ist Schluss.
  await send();
  await assert.rejects(send(), /Zu viele Versuche/);
});

test("a new member's released numbers reach the public ranking and replace the day", async () => {
  const { createMember } = await import("../server/operator");
  await createMember(db, bob, {
    name: "Bob Caller",
    company: "Studio",
    role: "Closer",
    publicConsent: true,
  });
  await saveCheckin(db, bob, checkin({ expectedRevision: 0 }));
  const today = berlinDate();
  let ranking = await publicRanking(db, today, today);
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].counts.attempts, 100);

  // Korrektur ersetzt den Tagesstand, sie addiert nicht.
  await saveCheckin(
    db,
    bob,
    checkin({
      expectedRevision: 1,
      counts: { ...counts(), attempts: 140 },
    }),
  );
  ranking = await publicRanking(db, today, today);
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].counts.attempts, 140);

  // Gruppensumme und Rangliste stammen aus derselben Zeilenmenge.
  const totals = aggregate(ranking.map((r) => r.counts));
  assert.equal(totals.attempts, ranking[0].counts.attempts);

  // Außerhalb des Zeitraums erscheint nichts.
  assert.equal((await publicRanking(db, "2026-01-01", "2026-01-02")).length, 0);
});

test("a private profile never becomes public on its own", async () => {
  const { createMember } = await import("../server/operator");
  await createMember(db, bob, {
    name: "Bob Privat",
    company: "",
    role: "",
    publicConsent: false,
  });
  await saveCheckin(db, bob, checkin({ expectedRevision: 0 }));
  const today = berlinDate();
  assert.equal((await publicRanking(db, today, today)).length, 0);
  // Die eigenen Zahlen sind trotzdem für das eigene Konto da.
  assert.equal((await ownState(db, bob)).records[0].counts.attempts, 100);
  // Erst die ausdrückliche Freigabe veröffentlicht.
  await updateAccount(db, bob, {
    name: "Bob Privat",
    company: "",
    role: "",
    publicConsent: true,
    phone: "",
    contactOptIn: false,
  });
  assert.equal((await publicRanking(db, today, today)).length, 1);
});

test("the selection step exposes the team marker but never contact data", async () => {
  const id = await imported([row({ role: "Team · A und B", email: "" })]);
  const profile = await profileForSelection(db, id);
  assert.deepEqual(Object.keys(profile).sort(), [
    "company",
    "id",
    "name",
    "role",
  ]);
  // Das Teamprofil bleibt bei der Übernahme als solches erkennbar.
  assert.match(String(profile.role), /^Team/);
});
