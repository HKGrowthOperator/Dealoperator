import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import {
  directory,
  saveMemberProfile,
  ownMemberProfile,
  saveAvatar,
  memberAvatar,
  validateAvatar,
  networkReady,
  changeMemberOffer,
  listMemberOffers,
  saveNetworkDraft,
} from "../server/members";
import { memberAccess, requireMember } from "../server/member-access";
import {
  emptyMemberProfile,
  matchesMember,
  memberProfileSchema,
  type DirectoryMember,
} from "../lib/members";
import { safeNext } from "../lib/navigation";
import { isPublicEntry } from "../lib/member-access";
import {
  startRequest,
  bindConfirmedRequest,
  decideRequest,
  searchProfiles,
} from "../server/onboarding";
let pg: PGlite, db: Database;
const a = { userId: "a", email: "a@example.invalid", admin: false },
  b = { userId: "b", email: "b@example.invalid", admin: false },
  admin = { userId: "admin", email: "admin@example.invalid", admin: true };
before(async () => {
  delete process.env.RESEND_API_KEY;
  process.env.OPERATOR_ADMIN_IDS = "admin";
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
    "TRUNCATE participants,profiles,account_private,onboarding_requests,onboarding_events,team_inbox,notifications,notification_prefs,rate_limits,sync_outbox,team_roles CASCADE",
  );
});
after(() => pg.close());
async function member(owner: string, name: string) {
  await db.query(
    "INSERT INTO participants(id,owner,name,kind) VALUES($1,$2,$3,'person')",
    ["p-" + owner, owner, name],
  );
  await db.query("INSERT INTO profiles(id,data) VALUES($1,$2)", [
    owner,
    JSON.stringify({
      name,
      role: "Setter",
      niche: "B2B",
      time: "Flexibel",
      bio: "",
      goal: 100,
      days: [1, 2],
      listed: true,
      network: {
        ...emptyMemberProfile,
        listed: true,
        headline: "Beratung für B2B",
        services: ["Beratung"],
        industries: ["B2B"],
        about: "Ich helfe Unternehmen bei der Umsetzung ihrer Projekte.",
        contactEmail: owner + "@example.invalid",
      },
    }),
  ]);
}
const profile = {
  ...emptyMemberProfile,
  about: "Ich unterstütze Betriebe bei der Gewinnung passender Mitarbeiter.",
  listed: true,
  headline: "Recruiting für Handwerker",
  services: ["Recruiting"],
  industries: ["Handwerk"],
  contactPhone: "+49 170 1234567",
  contactEmail: "kontakt@example.invalid",
};
test("verified email is not admission; no member directory or photos for pending applicants", async () => {
  assert.equal((await memberAccess(db, a)).allowed, false);
  await assert.rejects(directory(db, a), /noch nicht freigegeben/);
  await assert.rejects(memberAvatar(db, a, "p-b"), /noch nicht freigegeben/);
  await assert.rejects(requireMember(db, null), /Bitte melde dich/);
});
test("new requests remain pending after email confirmation; only team approval creates access", async () => {
  const r = await startRequest(db, {
    kind: "new",
    fullName: "Anna Beispiel",
    email: a.email,
    phone: "+49 170 1234567",
  });
  await bindConfirmedRequest(db, a, r.id);
  assert.equal(
    (
      await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [
        r.id,
      ])
    )[0].status,
    "pending",
  );
  assert.equal((await memberAccess(db, a)).allowed, false);
  await assert.rejects(
    decideRequest(db, a, { id: r.id, decision: "approve" }),
    /Nur das Team/,
  );
  await decideRequest(db, admin, { id: r.id, decision: "approve" });
  assert.equal((await memberAccess(db, a)).allowed, true);
  assert.equal(
    (
      await db.query("SELECT count(*) AS n FROM participants WHERE owner=$1", [
        a.userId,
      ])
    )[0].n,
    1,
  );
  await assert.rejects(
    decideRequest(db, admin, { id: r.id, decision: "approve" }),
    /bereits/,
  );
});
test("directory publishes only member-written contact fields, never imported or signup contacts", async () => {
  await member("a", "Anna Beispiel");
  await member("b", "Ben Beispiel");
  await db.query(
    "INSERT INTO account_private(owner,email,phone) VALUES($1,$2,$3)",
    ["b", "secret@example.invalid", "+49171111111"],
  );
  await saveMemberProfile(db, b, {
    ...profile,
    contactPhone: "",
    contactEmail: "public@example.invalid",
  });
  const rows = (await directory(db, a)).filter((m) => m.id === "p-b");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Ben Beispiel");
  assert.equal(rows[0].contactPhone, "");
  assert.equal(rows[0].contactEmail, "public@example.invalid");
  assert.ok(!JSON.stringify(rows).includes("secret@example"));
  assert.ok(!("owner" in rows[0]));
});
test("profile update preserves the stable identity, calling preferences and photo; no second account", async () => {
  await member("a", "Anna Beispiel");
  await db.query("UPDATE profiles SET data=$2 WHERE id=$1", [
    "a",
    JSON.stringify({
      name: "Anna Beispiel",
      role: "Setter",
      goal: 230,
      days: [1, 3],
      memberAvatar: "existing-photo",
      legacy: "preserve",
    }),
  ]);
  await saveMemberProfile(db, a, profile);
  const raw = JSON.parse(
    (await db.query("SELECT data FROM profiles WHERE id=$1", ["a"]))[0].data,
  );
  assert.equal(raw.goal, 230);
  assert.deepEqual(raw.days, [1, 3]);
  assert.equal(raw.memberAvatar, "existing-photo");
  assert.equal(raw.network.contactPhone, "+491701234567");
  assert.equal((await ownMemberProfile(db, a)).name, "Anna Beispiel");
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM participants"))[0].n,
    1,
  );
});
test("unpublished profiles are invisible to others and remain editable by their owner", async () => {
  await member("a", "Anna Beispiel");
  await member("b", "Ben Beispiel");
  await saveMemberProfile(db, b, { ...profile, listed: false });
  assert.equal(
    (await directory(db, a)).some((m) => m.id === "p-b"),
    false,
  );
  assert.equal((await ownMemberProfile(db, b)).profile.listed, false);
  await assert.rejects(memberAvatar(db, a, "p-b"), /gibt es nicht/);
});
test("search combines offer and industry; Handwerker and Handwerksbetriebe match Handwerk", () => {
  const m = {
    ...profile,
    id: "p",
    name: "Anna",
    role: "",
    avatarUrl: "",
    mine: false,
    levels: [],
    packageName: "",
  } satisfies DirectoryMember;
  assert.equal(matchesMember(m, "Recruiting Handwerksbetriebe"), true);
  assert.equal(
    matchesMember(
      {
        ...m,
        services: ["Mitarbeitergewinnung"],
        headline: "Personalgewinnung für Handwerksbetriebe",
      },
      "Recruiting Handwerk",
    ),
    true,
  );
  assert.equal(matchesMember(m, "Recruiting Gastronomie"), false);
  assert.equal(matchesMember(m, "ANNA"), true);
});
test("unsafe links, unknown owner fields, scripts and oversized photos are rejected", async () => {
  assert.equal(
    memberProfileSchema.safeParse({
      ...profile,
      website: "javascript:alert(1)",
    }).success,
    false,
  );
  assert.equal(
    memberProfileSchema.safeParse({ ...profile, owner: "b" }).success,
    false,
  );
  await member("a", "Anna Beispiel");
  await assert.rejects(
    saveAvatar(db, a, { data: "data:image/svg+xml;base64,PHN2Zz4=" }),
    /JPG/,
  );
  assert.throws(
    () => validateAvatar("data:image/jpeg;base64,/9j/2Q=="),
    /Foto/,
  );
});
test("entry lookup shows names only and never offers claimed accounts", async () => {
  await db.query(
    "INSERT INTO participants(id,name,company,role,searchable) VALUES('free','Anna Beispiel','Confidential Client','Internal role',true)",
  );
  await member("b", "Anna B");
  const found = await searchProfiles(db, "Anna");
  assert.deepEqual(Object.keys(found[0]).sort(), ["id", "name"]);
  assert.equal(found.length, 1);
});
test("private routes have no image-extension, API, roster or content-summary exception", () => {
  assert.equal(safeNext("/mitglieder/p-existing-123"), "/mitglieder/p-existing-123");
  assert.equal(safeNext("//example.invalid/mitglieder"), "/");
  assert.equal(safeNext("/mitglieder/../verwaltung"), "/");
  for (const p of [
    "/api/community",
    "/mitglieder",
    "/api/members/avatar",
    "/api/members/avatar.png",
    "/llms.txt",
    "/llms-full.txt",
    "/call/abc",
  ])
    assert.equal(isPublicEntry(p), false, p);
  for (const p of [
    "/",
    "/ranking",
    "/api/ranking",
    "/api/ranking/month",
    "/anmelden",
    "/starten",
    "/api/auth",
    "/api/onboarding",
    "/auth/callback",
    "/api/cron/tick",
    "/impressum",
    "/datenschutz",
  ])
    assert.equal(isPublicEntry(p), true, p);
});

test("someone seeking recruiting is not returned as a recruiting provider", () => {
  const m: DirectoryMember = {
    ...profile,
    services: ["Webdesign"],
    industries: ["Handwerk"],
    headline: "Webdesigner für Handwerker",
    lookingFor: "Recruiting für Handwerk",
    id: "p",
    name: "Beispiel",
    role: "",
    avatarUrl: "",
    mine: false,
    levels: [],
    packageName: "",
  };
  assert.equal(matchesMember(m, "Recruiting Handwerk", "angebote"), false);
  assert.equal(matchesMember(m, "Recruiting Handwerk", "gesuche"), true);
});
test("removed avatars disappear from directory links", async () => {
  await member("a", "Anna Beispiel");
  await saveMemberProfile(db, a, profile);
  await saveAvatar(db, a, { data: "" });
  assert.equal((await directory(db, a))[0].avatarUrl, "");
});

const offer = {
  title: "Recruiting-Auftrag weitergeben",
  description: "Ein Handwerksbetrieb sucht Unterstützung beim Recruiting.",
  category: "Auftrag weitergeben" as const,
  industry: "Handwerk",
};
test("members finish their profile once before browsing; call preferences and identity survive", async () => {
  await member("a", "Anna Beispiel");
  await db.query("UPDATE profiles SET data=$2 WHERE id=$1", [
    "a",
    JSON.stringify({ goal: 90, network: { ...emptyMemberProfile } }),
  ]);
  assert.equal(await networkReady(db, a), false);
  await assert.rejects(directory(db, a), /Vervollständige/);
  await saveMemberProfile(db, a, profile);
  assert.equal(await networkReady(db, a), true);
  assert.equal((await directory(db, a))[0].id, "p-a");
  assert.equal(
    JSON.parse(
      (await db.query("SELECT data FROM profiles WHERE id='a'"))[0].data,
    ).goal,
    90,
  );
});
test("a new access request retains the referral message for team review", async () => {
  const r = await startRequest(db, {
    kind: "new",
    fullName: "Anna Beispiel",
    email: a.email,
    phone: "+491701234567",
    hint: "Ich komme über einen bestehenden Teilnehmer.",
  });
  const [row] = await db.query(
    "SELECT hint,status FROM onboarding_requests WHERE id=$1",
    [r.id],
  );
  assert.match(row.hint, /bestehenden Teilnehmer/);
  assert.equal(row.status, "awaiting_email");
});
test("offers stay private, use the real author and can only be changed by their owner", async () => {
  await member("a", "Anna Beispiel");
  await member("b", "Ben Beispiel");
  const created = await changeMemberOffer(db, a, "save", offer);
  const read = await listMemberOffers(db, b);
  assert.equal(read[0].id, created.id);
  assert.equal(read[0].member.id, "p-a");
  await assert.rejects(
    changeMemberOffer(db, b, "delete", { id: created.id }),
    /gehört nicht/,
  );
  await assert.rejects(
    changeMemberOffer(db, a, "save", { ...offer, owner: "b" }),
    /Unrecognized/,
  );
  await assert.rejects(
    listMemberOffers(db, { ...a, userId: "stranger" }),
    /freigegeben/,
  );
  await changeMemberOffer(db, a, "close", { id: created.id });
  assert.equal((await listMemberOffers(db, b)).length, 0);
  assert.equal((await listMemberOffers(db, a))[0].closed, true);
  await changeMemberOffer(db, a, "delete", { id: created.id });
  assert.equal((await listMemberOffers(db, a)).length, 0);
});
test("offer updates and profile updates preserve one another; unlisted authors disappear", async () => {
  await member("a", "Anna Beispiel");
  await member("b", "Ben Beispiel");
  const created = await changeMemberOffer(db, a, "save", offer);
  await saveMemberProfile(db, a, {
    ...profile,
    headline: "Recruiting mit Erfahrung",
  });
  assert.equal((await listMemberOffers(db, b))[0].id, created.id);
  await changeMemberOffer(db, a, "save", {
    ...offer,
    id: created.id,
    title: "Korrigierter Auftrag",
  });
  assert.equal(
    (await ownMemberProfile(db, a)).profile.headline,
    "Recruiting mit Erfahrung",
  );
  await saveMemberProfile(db, a, { ...profile, listed: false });
  assert.equal((await listMemberOffers(db, b)).length, 0);
});

test("a saved onboarding draft restores the step and text but never grants directory access", async () => {
  await member("a", "Anna Beispiel");
  await db.query("UPDATE profiles SET data=$2 WHERE id=$1", [
    "a",
    JSON.stringify({ goal: 140 }),
  ]);
  await saveNetworkDraft(db, a, { profile, step: 2 });
  const restored = await ownMemberProfile(db, a);
  assert.equal(restored.setupStep, 2);
  assert.equal(restored.profile.headline, profile.headline);
  assert.equal(await networkReady(db, a), false);
  await assert.rejects(directory(db, a), /Vervollständige/);
  await saveMemberProfile(db, a, profile);
  const final = await ownMemberProfile(db, a);
  assert.equal(final.hasCompleteProfile, true);
  assert.equal(final.setupStep, 0);
  const raw = JSON.parse(
    (await db.query("SELECT data FROM profiles WHERE id='a'"))[0].data,
  );
  assert.equal(raw.goal, 140);
  assert.equal(raw.memberNetworkDraft, undefined);
});
