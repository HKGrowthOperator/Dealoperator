import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import {
  MEMBER_DIRECTORY_KEY,
  preparedMemberForEmail,
} from "../server/member-directory";
import { adminContacts, createMember, publicRanking } from "../server/operator";
import {
  bindConfirmedRequest,
  requestClaimSignedIn,
  searchProfiles,
  startRequest,
  suggestProfiles,
} from "../server/onboarding";

const alice = { userId: "alice", email: "alice@example.invalid", admin: false };
const bob = { userId: "bob", email: "bob@example.invalid", admin: false };
const admin = { userId: "admin", email: "admin@example.invalid", admin: true };
let pg: PGlite, db: Database;
before(async () => {
  pg = new PGlite();
  await pg.exec(
    await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"),
  );
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as unknown as Executor, (fn) =>
    pg.transaction((tx) => fn(new Database(tx as unknown as Executor))),
  );
});
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE participants,profiles,account_private,onboarding_requests,onboarding_events,app_settings,notifications,team_inbox,notification_prefs,rate_limits CASCADE",
  );
});
after(async () => {
  await pg.close();
});
async function prepared(
  id = "prepared-alice",
  email = alice.email,
  owner: string | null = null,
) {
  await db.query(
    "INSERT INTO participants(id,name,email,searchable,owner) VALUES($1,'Alice Beispiel',$2,false,$3)",
    [id, email, owner],
  );
  await db.query(
    `INSERT INTO app_settings(key,value) VALUES($1,jsonb_build_object($2::text,$3::jsonb))
     ON CONFLICT(key) DO UPDATE SET value=app_settings.value || excluded.value`,
    [
      MEMBER_DIRECTORY_KEY,
      `slack-${id}`,
      JSON.stringify({
        participantId: id,
        email,
        phone: "+491709999999",
        name: "Alice Beispiel",
      }),
    ],
  );
  return id;
}
const form = {
  name: "Eigener Anzeigename",
  company: "",
  role: "Sales",
  phone: "+4917012345678",
};
const registration = () =>
  startRequest(db, {
    kind: "new",
    fullName: "Alice Beispiel",
    email: alice.email,
    phone: form.phone,
  });

test("prepared members stay out of public search/ranking and notify nobody", async () => {
  await prepared();
  assert.deepEqual(await searchProfiles(db, "Alice"), []);
  assert.deepEqual(await publicRanking(db, "2026-10-01", "2026-10-31"), []);
  assert.equal(
    Number((await db.query("SELECT count(*) AS n FROM notifications"))[0].n),
    0,
  );
  const [contact] = await adminContacts(db, admin);
  assert.equal(contact.imported_phone, "+491709999999");
  assert.equal(contact.phone, null);
  await assert.rejects(adminContacts(db, alice), /Nur für die Verwaltung/);
});
test("first confirmed registration reuses the internal ID; repeating cannot create another profile", async () => {
  const id = await prepared();
  const r = await registration();
  assert.equal(
    (await db.query("SELECT owner FROM participants WHERE id=$1", [id]))[0]
      .owner,
    null,
  );
  await bindConfirmedRequest(db, alice, r.id);
  assert.equal((await createMember(db, alice, form)).id, id);
  assert.equal((await createMember(db, alice, form)).id, id);
  const [p] = await db.query(
    "SELECT name,owner,searchable FROM participants WHERE id=$1",
    [id],
  );
  assert.equal(p.name, "Alice Beispiel");
  assert.equal(p.owner, alice.userId);
  assert.equal(p.searchable, false);
  assert.equal(
    Number((await db.query("SELECT count(*) AS n FROM participants"))[0].n),
    1,
  );
  assert.equal(
    (
      await db.query("SELECT phone FROM account_private WHERE owner=$1", [
        alice.userId,
      ])
    )[0].phone,
    form.phone,
  );
});
test("historical numbers turn registration into a team-reviewed takeover and stay on the same profile", async () => {
  const id = await prepared();
  await db.query(
    "INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,'2026-10-07','{\"attempts\":25}','import','import')",
    [id],
  );
  const r = await registration();
  await bindConfirmedRequest(db, alice, r.id);
  const [request] = await db.query(
    "SELECT kind,participant,status FROM onboarding_requests WHERE id=$1",
    [r.id],
  );
  assert.deepEqual(request, {
    kind: "claim",
    participant: id,
    status: "pending",
  });
  await assert.rejects(createMember(db, alice, form), /übernahme/i);
  assert.equal(
    (
      await db.query("SELECT counts FROM checkins WHERE participant=$1", [id])
    )[0].counts.attempts,
    25,
  );
  assert.equal(
    (await db.query("SELECT owner FROM participants WHERE id=$1", [id]))[0]
      .owner,
    null,
  );
});
test("only the confirmed matching address can select a hidden directory profile", async () => {
  const id = await prepared();
  const mine = await suggestProfiles(db, alice);
  assert.equal(mine.profiles[0].id, id);
  assert.deepEqual(Object.keys(mine.profiles[0]).sort(), [
    "company",
    "id",
    "name",
    "role",
  ]);
  assert.deepEqual((await suggestProfiles(db, bob)).profiles, []);
  const details = {
    participantId: id,
    fullName: "Alice Beispiel",
    phone: form.phone,
  };
  await assert.rejects(requestClaimSignedIn(db, bob, details), /Einladung/);
  const r = await requestClaimSignedIn(db, alice, details);
  assert.equal(r.status, "pending");
});
test("one email mapped to two people never silently creates or assigns a third profile", async () => {
  await prepared("one");
  await prepared("two");
  assert.deepEqual(await preparedMemberForEmail(db, alice.email), {
    ambiguous: true,
  });
  await assert.rejects(
    createMember(db, alice, form),
    /mehrere vorbereitete Profile/,
  );
  const r = await registration();
  await assert.rejects(
    bindConfirmedRequest(db, alice, r.id),
    /mehrere vorbereitete Profile/,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM participants WHERE owner IS NOT NULL",
        )
      )[0].n,
    ),
    0,
  );
});
test("duplicate source entries pointing to the same profile are an unambiguous match", async () => {
  const id = await prepared();
  await db.query(
    "UPDATE app_settings SET value=value || jsonb_build_object('second',jsonb_build_object('participantId',$2::text,'email',$3::text)) WHERE key=$1",
    [MEMBER_DIRECTORY_KEY, id, alice.email],
  );
  const found = await preparedMemberForEmail(db, " ALICE@EXAMPLE.INVALID ");
  assert.ok(found && !("ambiguous" in found));
  assert.equal(found.id, id);
});
test("a directory match never replaces an existing owner", async () => {
  const id = await prepared("taken", alice.email, bob.userId);
  await assert.rejects(createMember(db, alice, form), /bereits ein Profil/);
  assert.equal(
    (await db.query("SELECT owner FROM participants WHERE id=$1", [id]))[0]
      .owner,
    bob.userId,
  );
});
test("an imported participant email alone is not a trusted directory match", async () => {
  await db.query(
    "INSERT INTO participants(id,name,email) VALUES('other','Andere Person',$1)",
    [alice.email],
  );
  assert.equal(await preparedMemberForEmail(db, alice.email), null);
});
test("malformed directory settings do not expose or assign a profile", async () => {
  await db.query("INSERT INTO app_settings(key,value) VALUES($1,'[]')", [
    MEMBER_DIRECTORY_KEY,
  ]);
  assert.equal(await preparedMemberForEmail(db, alice.email), null);
});
