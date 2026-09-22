import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database, placeholders } from "../server/database";
import {
  claim,
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
    "TRUNCATE participants,profiles,records,requests,account_private,rate_limits,posts,buddies,relationships,preferences,entitlements,sessions CASCADE",
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
test("same name cannot claim a profile; confirmed matching email can", async () => {
  const id = await imported();
  await assert.rejects(claim(db, bob, { participantId: id }), /Zuordnung/);
  await claim(db, alice, { participantId: id });
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
test("claim code is stored hashed, can only be used once and preserves history", async () => {
  const id = await imported([row({ email: "" })]);
  const invite = await issueClaim(db, admin, id);
  const stored = await db.query("SELECT * FROM claim_tokens");
  assert.notEqual(stored[0].hash, invite.token);
  await claim(db, bob, { participantId: id, token: invite.token });
  assert.equal((await ownState(db, bob)).records[0].counts.attempts, 100);
  await assert.rejects(
    claim(db, alice, { participantId: id, token: invite.token }),
    /nicht verfügbar/,
  );
});
test("expired, wrong and replaced claim codes fail", async () => {
  const id = await imported([row({ email: "" })]);
  const first = await issueClaim(db, admin, id);
  const second = await issueClaim(db, admin, id);
  await assert.rejects(
    claim(db, bob, { participantId: id, token: first.token }),
    /Zuordnung/,
  );
  await assert.rejects(
    claim(db, bob, { participantId: id, token: "invalid" }),
    /Zuordnung/,
  );
  await db.query(
    "UPDATE claim_tokens SET expires_at=now()-interval '1 second'",
  );
  await assert.rejects(
    claim(db, bob, { participantId: id, token: second.token }),
    /Zuordnung/,
  );
});
test("claim never replaces another existing account profile", async () => {
  const id = await imported();
  await db.query("INSERT INTO participants(id,name,owner) VALUES($1,$2,$3)", [
    "other",
    "Existing",
    alice.userId,
  ]);
  await assert.rejects(
    claim(db, alice, { participantId: id }),
    /bereits ein Profil/,
  );
  assert.equal(
    (await db.query("SELECT owner FROM participants WHERE id=$1", [id]))[0]
      .owner,
    null,
  );
});
test("corrected checkin replaces totals, changes only relevant rank and queues sync", async () => {
  const id = await imported();
  await claim(db, alice, { participantId: id });
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
  await claim(db, alice, { participantId: id });
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
  await claim(db, alice, { participantId: id });
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
  await claim(db, alice, { participantId: id });
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
  await claim(db, alice, { participantId: id });
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
  await claim(db, alice, { participantId: id });
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
  await claim(db, alice, { participantId: id });
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
  await claim(db, alice, { participantId: id });
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
test("onboarding directs matching imports to claims and never silently drops prior numbers", async () => {
  const { createMember } = await import("../server/operator");
  const id = await imported();
  await assert.rejects(
    createMember(db, alice, {
      name: "Alice",
      company: "",
      role: "",
      publicConsent: true,
    }),
    /bereits Zahlen/,
  );
  assert.equal(
    (await db.query("SELECT owner FROM participants WHERE id=$1", [id]))[0]
      .owner,
    null,
  );
  await claim(db, alice, { participantId: id });
  const result = await createMember(db, alice, {
    name: "Ignored retry",
    company: "",
    role: "",
    publicConsent: false,
  });
  assert.equal(result.id, id);
  assert.equal((await ownState(db, alice)).records[0].counts.attempts, 100);
  assert.equal((await ownState(db, alice)).participant.name, "Alice Beispiel");
});
test("a new profile starts a distinct history only after an explicit choice", async () => {
  const { createMember } = await import("../server/operator");
  const id = await imported();
  const result = await createMember(db, alice, {
    name: "Alice neu",
    company: "",
    role: "",
    publicConsent: false,
    confirmNew: true,
  });
  assert.notEqual(result.id, id);
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
