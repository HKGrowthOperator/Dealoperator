import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import {
  addSessionGuest,
  createSession,
  discordRoomLink,
  editSession,
  removeSessionGuest,
  setSessionRoom,
  toggleAttendance,
  upcomingSessions,
} from "../server/sessions";

// Fiktive Personen und Sessions; keine echten Daten.
let pg: PGlite, db: Database;
const team = { userId: "admin", team: true };
const host = { userId: "host", team: false };
const other = { userId: "other", team: false };

before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as unknown as Executor, (fn) => pg.transaction((tx) => fn(new Database(tx as unknown as Executor))));
});
beforeEach(async () => {
  await pg.exec("TRUNCATE sessions,rsvps,participants CASCADE");
  await db.query(
    "INSERT INTO participants(id,import_key,name,kind) VALUES('p-carina','akq-carina','Carina','person'),('p-joint','akq-duo','Carina und Tom','joint')",
  );
});
after(async () => pg.close());

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);
function input(capacity = 4, days = 5) {
  const start = inDays(days);
  start.setUTCHours(14, 0, 0, 0);
  const startsAt = start.toISOString();
  return { title: "Roleplay am Sonntag", kind: "Roleplay", date: startsAt.slice(0, 10), time: "16:00", minutes: 120, capacity, startsAt };
}
async function session(capacity = 4) {
  return (await createSession(db, host.userId, "Host", input(capacity))).id;
}
const stored = async (id: string) =>
  JSON.parse((await db.query("SELECT data FROM sessions WHERE id=$1", [id]))[0].data);

test("Team merkt ein vorhandenes Profil ohne Konto vor; es zählt als Platz", async () => {
  const id = await session();
  const r = await addSessionGuest(db, team, id, { participant: "p-carina" });
  assert.deepEqual(r, { participant: "p-carina", name: "Carina", created: false });
  assert.deepEqual((await stored(id)).guests, ["p-carina"]);
  const [pub] = await upcomingSessions(db);
  assert.equal(pub.attendees, 2, "Host und Vorgemerkte");
  await assert.rejects(addSessionGuest(db, team, id, { participant: "p-carina" }), /schon vorgemerkt/);
});

test("Unbekannter Name: neues Profil, gleicher Name über Schreibweise wird wiederverwendet", async () => {
  const id = await session();
  const r = await addSessionGuest(db, team, id, { name: "Linus  Zornig" });
  assert.equal(r.created, true);
  const [p] = await db.query("SELECT name,import_key,kind,public_consent,searchable FROM participants WHERE id=$1", [r.participant]);
  assert.deepEqual(p, { name: "Linus Zornig", import_key: "session-linus-zornig", kind: "person", public_consent: true, searchable: true });
  const id2 = await session();
  const again = await addSessionGuest(db, team, id2, { name: "linus zornig" });
  assert.equal(again.participant, r.participant);
  assert.equal(again.created, false);
  const [{ n }] = await db.query("SELECT count(*)::int n FROM participants WHERE name ILIKE 'linus zornig'");
  assert.equal(n, 1);
});

test("Nur das Team merkt vor; gemeinsame Meldungen sind kein Ziel", async () => {
  const id = await session();
  await assert.rejects(addSessionGuest(db, host, id, { participant: "p-carina" }), /nur das Team/);
  await assert.rejects(addSessionGuest(db, team, id, { participant: "p-joint" }), /gibt es nicht/);
  await assert.rejects(removeSessionGuest(db, other, id, "p-carina"), /nur das Team/);
});

test("Plätze: Vorgemerkte zählen beim Zusagen und beim Verkleinern", async () => {
  const id = await session(2);
  await addSessionGuest(db, team, id, { participant: "p-carina" });
  await assert.rejects(toggleAttendance(db, other.userId, id), /voll/);
  await assert.rejects(addSessionGuest(db, team, id, { name: "Noch Jemand" }), /Plätze sind belegt/);
  await assert.rejects(editSession(db, team, id, input(1)), /Kapazität/);
  await removeSessionGuest(db, team, id, "p-carina");
  assert.deepEqual((await toggleAttendance(db, other.userId, id)), { joined: true });
});

test("Wer vorgemerkt war und mit eigenem Konto zusagt, behält den Platz", async () => {
  const id = await session(2);
  await addSessionGuest(db, team, id, { participant: "p-carina" });
  await db.query("UPDATE participants SET owner='carina-konto' WHERE id='p-carina'");
  assert.deepEqual(await toggleAttendance(db, "carina-konto", id), { joined: true });
  assert.deepEqual((await stored(id)).guests, []);
  const [pub] = await upcomingSessions(db);
  assert.equal(pub.attendees, 2);
  await assert.rejects(addSessionGuest(db, team, id, { participant: "p-carina" }), /schon dabei/);
});

test("Raum-Link: nur Discord, nur Host oder Team", async () => {
  const id = await session();
  assert.equal(discordRoomLink(""), "");
  assert.equal(discordRoomLink(" https://discord.gg/abc "), "https://discord.gg/abc");
  assert.equal(discordRoomLink("https://discord.com/channels/1/2"), "https://discord.com/channels/1/2");
  for (const bad of ["http://discord.gg/abc", "https://discord.gg.evil.example/x", "https://evil.example/discord.gg", "javascript:alert(1)", "https://user:pw@discord.com/x"])
    assert.throws(() => discordRoomLink(bad), /Discord|discord/, bad);
  await assert.rejects(setSessionRoom(db, other, id, "https://discord.gg/abc"), /Host oder das Team/);
  await setSessionRoom(db, host, id, "https://discord.gg/abc");
  assert.equal((await stored(id)).roomUrl, "https://discord.gg/abc");
  await setSessionRoom(db, team, id, "");
  assert.equal((await stored(id)).roomUrl, "");
});

test("Öffentliche Liste: nur kommende, nicht abgesagte Sessions, ohne Namen der Teilnehmer", async () => {
  const id = await session();
  await addSessionGuest(db, team, id, { participant: "p-carina" });
  const cancelled = await session();
  const data = await stored(cancelled);
  await db.query("UPDATE sessions SET data=$1 WHERE id=$2", [JSON.stringify({ ...data, cancelled: true }), cancelled]);
  const list = await upcomingSessions(db);
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ["attendees", "capacity", "date", "host", "kind", "minutes", "startsAt", "time", "title"]);
  assert.ok(!JSON.stringify(list).includes("Carina"));
});
