import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../server/database";
import { homeState } from "../server/home";
import { latestPublicDay } from "../server/ranking-history";
import { safeNext } from "../lib/navigation";

// Fiktive Konten. 24.09.2026 ist ein Donnerstag, 28.09.2026 ein Montag.
const alice = { userId: "alice", email: "alice@example.invalid", admin: false };
const newbie = { userId: "newbie", email: "newbie@example.invalid", admin: false };
let pg: PGlite, db: Database;

before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as any, (fn) => pg.transaction((tx) => fn(new Database(tx as any))));
});
beforeEach(async () => {
  await pg.exec("TRUNCATE participants,onboarding_requests,pauses,app_settings CASCADE");
  await db.query(
    `INSERT INTO participants(id,name,owner,public_consent,claimed_at,eligible_since,kind)
     VALUES('p-alice','Alice Beispiel','alice',true,now(),'2026-09-01T08:00:00Z','person')`,
  );
});
after(async () => {
  await pg.close();
});

const counts = JSON.stringify({ attempts: 40, settingsBooked: 1, closingsBooked: 0 });
async function closed(day: string) {
  await db.query(
    `INSERT INTO checkins(participant,day,counts,source,origin,first_submitted_at,submitted_at)
     VALUES('p-alice',$1,$2,'closing','closing',now(),now())`,
    [day, counts],
  );
}
// Donnerstagabend, lange nach der Frist für Mittwoch.
const thursday = new Date("2026-09-24T18:00:00Z");

test("today is open, then a draft, then done", async () => {
  let s = await homeState(db, alice, "2026-09-24", thursday);
  assert.equal(s.participant?.id, "p-alice");
  assert.deepEqual(s.today, { day: "2026-09-24", status: "open", due: true });
  await db.query("INSERT INTO checkin_drafts(participant,day) VALUES('p-alice','2026-09-24')");
  s = await homeState(db, alice, "2026-09-24", thursday);
  assert.equal(s.today?.status, "draft");
  await closed("2026-09-24");
  s = await homeState(db, alice, "2026-09-24", thursday);
  assert.equal(s.today?.status, "done");
});

test("weekends are not calling days; a curated import counts as entered", async () => {
  const saturday = await homeState(db, alice, "2026-09-26", new Date("2026-09-26T12:00:00Z"));
  assert.equal(saturday.today?.due, false);
  await db.query(
    `INSERT INTO checkins(participant,day,counts,source,origin) VALUES('p-alice','2026-09-24',$1,'import','import')`,
    [counts],
  );
  assert.equal((await homeState(db, alice, "2026-09-24", thursday)).today?.status, "imported");
});

test("Friday stays open on Monday morning until the deadline, then drops away", async () => {
  const mondayEarly = new Date("2026-09-28T06:00:00Z"); // 08:00 in Berlin
  const early = await homeState(db, alice, "2026-09-28", mondayEarly);
  assert.equal(early.earlier?.day, "2026-09-25");
  const mondayLate = new Date("2026-09-28T12:00:00Z");
  assert.equal((await homeState(db, alice, "2026-09-28", mondayLate)).earlier, null);
  await closed("2026-09-25");
  assert.equal((await homeState(db, alice, "2026-09-28", mondayEarly)).earlier, null);
});

test("no open earlier day before the account could close days", async () => {
  await db.query("UPDATE participants SET eligible_since='2026-09-28T07:00:00Z' WHERE id='p-alice'");
  const s = await homeState(db, alice, "2026-09-28", new Date("2026-09-28T07:30:00Z"));
  assert.equal(s.earlier, null);
});

test("accounts without a profile see their takeover state, never someone else's day", async () => {
  let s = await homeState(db, newbie, "2026-09-24", thursday);
  assert.equal(s.participant, null);
  assert.equal(s.today, null);
  assert.equal(s.request, null);
  await db.query(
    `INSERT INTO onboarding_requests(id,kind,participant,email,full_name,phone,status,owner)
     VALUES('r1','claim','p-alice','newbie@example.invalid','Neu Beispiel','+49170','pending','newbie')`,
  );
  s = await homeState(db, newbie, "2026-09-24", thursday);
  assert.deepEqual(s.request, { kind: "claim", status: "pending" });
});

test("latest public day: today if reported, else the last reported day, never a private one", async () => {
  assert.equal(await latestPublicDay(db, "2026-09-24"), null);
  await db.query(
    `INSERT INTO participants(id,name,public_consent,kind) VALUES('p-hidden','Privat',false,'person')`,
  );
  await db.query(
    `INSERT INTO checkins(participant,day,counts,source,origin) VALUES('p-hidden','2026-09-24',$1,'import','import')`,
    [counts],
  );
  assert.equal(await latestPublicDay(db, "2026-09-24"), null);
  await db.query(
    `INSERT INTO checkins(participant,day,counts,source,origin) VALUES('p-alice','2026-09-22',$1,'import','import')`,
    [counts],
  );
  assert.equal(await latestPublicDay(db, "2026-09-24"), "2026-09-22");
  // Ein späterer Tag (Zeitzonen, Tests) gilt nie als „heute“.
  await db.query(
    `INSERT INTO checkins(participant,day,counts,source,origin) VALUES('p-alice','2026-09-25',$1,'import','import')`,
    [counts],
  );
  assert.equal(await latestPublicDay(db, "2026-09-24"), "2026-09-22");
  await closed("2026-09-24");
  assert.equal(await latestPublicDay(db, "2026-09-24"), "2026-09-24");
});

test("login without a target goes to the shared homepage", () => {
  assert.equal(safeNext(null), "/");
  assert.equal(safeNext(""), "/");
  assert.equal(safeNext("/?day=2026-09-22&metric=attempts"), "/?day=2026-09-22&metric=attempts");
});
