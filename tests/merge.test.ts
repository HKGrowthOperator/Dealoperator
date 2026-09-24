import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../server/database";
import { mergeParticipants, mergePreview } from "../server/merge";
import { publicRanking } from "../server/operator";
import { closingState } from "../server/closing";

// Fiktive Konten; keine echten Kontaktdaten.
const admin = { userId: "admin", email: "admin@example.invalid", admin: true };
const mod = { userId: "mod", email: "mod@example.invalid", admin: false, moderator: true };
const flo = { userId: "flo", email: "flo@example.invalid", admin: false };
let pg: PGlite, db: Database;

before(async () => {
  process.env.OPERATOR_ADMIN_IDS = "admin";
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as any, (fn) => pg.transaction((tx) => fn(new Database(tx as any))));
});
beforeEach(async () => {
  await pg.exec(
    `TRUNCATE participants,checkins,checkin_revisions,checkin_drafts,participant_aliases,pauses,
      discord_posts,sync_outbox,claim_tokens,onboarding_requests,team_inbox,notifications,account_private CASCADE`,
  );
});
after(async () => {
  await pg.close();
});

const counts = (attempts: number) =>
  JSON.stringify({
    attempts,
    decisionMakerConversations: null,
    settingsBooked: 1,
    settingsHeld: null,
    closingsBooked: 0,
    closingsHeld: null,
    dealsWon: null,
    legacyMeetings: null,
  });

async function imported(day: string, attempts: number, participant = "alt") {
  await db.query(
    "INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,$2,$3::jsonb,'wins-import','import')",
    [participant, day, counts(attempts)],
  );
}
async function closing(day: string, attempts: number, participant = "neu") {
  await db.query(
    `INSERT INTO checkins(participant,day,counts,source,origin,first_submitted_at,submitted_at,shared)
     VALUES($1,$2,$3::jsonb,'website','closing',now(),now(),true)`,
    [participant, day, counts(attempts)],
  );
  await db.query(
    "INSERT INTO checkin_revisions(participant,day,revision,counts,actor,source) VALUES($1,$2,1,$3::jsonb,'flo','website')",
    [participant, day, counts(attempts)],
  );
}

/** Altes Importprofil mit Historie und ein neu angelegtes Profil mit Konto. */
async function twoProfiles() {
  await db.query(
    "INSERT INTO participants(id,import_key,name,company,public_consent) VALUES('alt','akq-flo','Flo Graf','',true)",
  );
  await db.query(
    "INSERT INTO participants(id,name,company,owner,email,public_consent,claimed_at,eligible_since) VALUES('neu','Flo Graf','Graf GmbH','flo',$1,false,now(),now())",
    [flo.email],
  );
  await db.query("INSERT INTO account_private(owner,email,phone) VALUES('flo',$1,'+4917012345678')", [flo.email]);
  await imported("2026-09-22", 244);
  await imported("2026-09-23", 120);
  await closing("2026-09-24", 24);
  await db.query("INSERT INTO participant_aliases(alias,participant) VALUES('Flo G.','alt')");
  await db.query("INSERT INTO sync_outbox(participant) VALUES('alt'),('neu')");
}

test("the preview plans per day and changes nothing", async () => {
  await twoProfiles();
  const p = await mergePreview(db, admin, { keep: "alt", absorb: "neu" });
  assert.equal(p.owner, "absorb");
  assert.equal(p.keep.days, 2);
  assert.equal(p.absorb.days, 1);
  assert.deepEqual(
    p.days.map((d) => [d.day, d.action]),
    [["2026-09-24", "move"]],
  );
  assert.equal((await db.query("SELECT count(*)::int AS n FROM participants"))[0].n, 2);
});

test("merging moves history, revisions, aliases and the account to the kept profile", async () => {
  await twoProfiles();
  const r = await mergeParticipants(db, admin, { keep: "alt", absorb: "neu" });
  assert.deepEqual(r, { ok: true, keep: "alt", move: 1, replace: 0, drop: 0 });
  const rows = await db.query("SELECT id,owner,email,import_key,company,public_consent,claimed_at,eligible_since FROM participants");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "alt");
  assert.equal(rows[0].owner, "flo");
  assert.equal(rows[0].email, flo.email);
  assert.equal(rows[0].import_key, "akq-flo");
  assert.equal(rows[0].company, "Graf GmbH", "Firma füllt die Lücke");
  assert.ok(rows[0].claimed_at && rows[0].eligible_since);
  assert.deepEqual(
    (await db.query("SELECT day,origin FROM checkins WHERE participant='alt' ORDER BY day")).map((c) => `${c.day}:${c.origin}`),
    ["2026-09-22:import", "2026-09-23:import", "2026-09-24:closing"],
  );
  assert.equal((await db.query("SELECT count(*)::int AS n FROM checkin_revisions WHERE participant='alt'"))[0].n, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM participant_aliases WHERE participant='alt'"))[0].n, 1);
  assert.deepEqual(
    (await db.query("SELECT participant,state FROM sync_outbox")).map((o) => `${o.participant}:${o.state}`),
    ["alt:pending"],
  );
  const [inbox] = await db.query("SELECT kind,state,resolved_at FROM team_inbox");
  assert.equal(inbox.kind, "merge");
  assert.ok(inbox.resolved_at, "nur zur Information");
  // Die Person sieht ihre ganze Historie und steht mit allen Tagen in der Rangliste.
  const state = await closingState(db, flo, "2026-09");
  assert.equal(state.eligibility.participant?.id, "alt");
  assert.equal(state.closings.length, 3);
  assert.equal((await publicRanking(db, "2026-09-22", "2026-09-24")).length, 1);
});

test("an own closing replaces an imported day; between two closings the kept profile wins", async () => {
  await twoProfiles();
  await closing("2026-09-23", 130); // eigener Abschluss gegen den Import vom 23.
  await closing("2026-09-22", 250); // eigener Abschluss gegen den Import vom 22.
  await db.query("DELETE FROM checkins WHERE participant='alt' AND day='2026-09-22'");
  await closing("2026-09-22", 200, "alt"); // zwei eigene Abschlüsse am 22.: „alt“ bleibt
  const p = await mergePreview(db, admin, { keep: "alt", absorb: "neu" });
  assert.deepEqual(
    p.days.map((d) => [d.day, d.action]),
    [
      ["2026-09-22", "drop"],
      ["2026-09-23", "replace"],
      ["2026-09-24", "move"],
    ],
  );
  const r = await mergeParticipants(db, admin, { keep: "alt", absorb: "neu" });
  assert.deepEqual(r, { ok: true, keep: "alt", move: 1, replace: 1, drop: 1 });
  const days = await db.query("SELECT day,origin,counts->>'attempts' AS a FROM checkins ORDER BY day");
  assert.deepEqual(
    days.map((d) => `${d.day}:${d.origin}:${d.a}`),
    ["2026-09-22:closing:200", "2026-09-23:closing:130", "2026-09-24:closing:24"],
  );
  // Alle Fassungen bleiben, auch die des entfallenen Tages.
  assert.equal((await db.query("SELECT count(*)::int AS n FROM checkin_revisions WHERE participant='alt'"))[0].n, 4);
});

test("a differing name becomes an alias; the direction can be reversed", async () => {
  await twoProfiles();
  await db.query("UPDATE participants SET name='Florian Graf' WHERE id='neu'");
  await mergeParticipants(db, admin, { keep: "alt", absorb: "neu" });
  const aliases = await db.query("SELECT alias FROM participant_aliases WHERE participant='alt' ORDER BY alias");
  assert.deepEqual(aliases.map((a) => a.alias), ["Flo G.", "Florian Graf"]);
});

test("refusals: same profile, two accounts, joint reports, non-admins", async () => {
  await twoProfiles();
  await assert.rejects(mergeParticipants(db, admin, { keep: "alt", absorb: "alt" }), /verschiedene/);
  await assert.rejects(mergeParticipants(db, mod, { keep: "alt", absorb: "neu" }), /Admin/);
  await assert.rejects(mergePreview(db, admin, { keep: "alt", absorb: "fehlt" }), /nicht mehr/);
  await db.query("INSERT INTO participants(id,name,kind) VALUES('duo','A & B','joint')");
  await assert.rejects(mergeParticipants(db, admin, { keep: "alt", absorb: "duo" }), /Gemeinsame/);
  await db.query("UPDATE participants SET owner='other' WHERE id='alt'");
  await assert.rejects(mergeParticipants(db, admin, { keep: "alt", absorb: "neu" }), /zwei Konten/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM participants"))[0].n, 3);
});
