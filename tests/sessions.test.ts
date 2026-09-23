import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../server/database";
import { earliestSessionDay, sessionLeadError } from "../lib/session-rules";
import { cancelSession, createSession, editSession } from "../server/sessions";
import { runDiscordRooms, sessionRoomStatus, syncModeratorRoles, syncSessionRooms } from "../server/discord-sessions";

// Fiktive Konten und ein nachgebautes Discord; keine echten Daten, kein Netz.
let pg: PGlite, db: Database;
const alice = "alice";
const bob = "bob";
const mo = "mo";

before(async () => {
  process.env.OPERATOR_ADMIN_IDS = "admin";
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as any, (fn) => pg.transaction((tx) => fn(new Database(tx as any))));
});
beforeEach(async () => {
  await pg.exec("TRUNCATE sessions,rsvps,app_settings,discord_links,team_roles CASCADE");
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.DISCORD_GUILD_ID = "g1";
  process.env.DISCORD_SESSION_CATEGORY_ID = "cat1";
  process.env.DISCORD_MODERATOR_ROLE_ID = "role-mod";
});
after(async () => {
  for (const k of ["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_SESSION_CATEGORY_ID", "DISCORD_MODERATOR_ROLE_ID"])
    delete process.env[k];
  await pg.close();
});

const at = (iso: string) => new Date(iso);
function input(startsAt: string, extra: Record<string, unknown> = {}) {
  return {
    title: "Einwände üben",
    kind: "Roleplay",
    date: startsAt.slice(0, 10),
    time: startsAt.slice(11, 16),
    minutes: 45,
    capacity: 4,
    startsAt,
    ...extra,
  };
}
/** Discord-Nachbau: merkt sich Aufrufe, vergibt IDs, kann 404 liefern. */
function fakeDiscord(opts: { missing?: Set<string> } = {}) {
  const calls: { method: string; path: string; body: any }[] = [];
  let next = 1;
  const fetcher = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://discord.com/api/v10", "");
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body });
    if (opts.missing?.has(path)) return new Response("{}", { status: 404 });
    if (method === "POST") return Response.json({ id: `id${next++}` });
    if (method === "PATCH") return Response.json({ id: "x" });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

test("sessions need at least 12 hours and must be set up by the day before", () => {
  const now = at("2026-09-23T18:00:00Z"); // 20:00 in Berlin
  assert.match(sessionLeadError(at("2026-09-23T17:00:00Z"), now)!, /zukünftigen/);
  // Heute noch (Berlin): zu kurzfristig.
  assert.match(sessionLeadError(at("2026-09-23T21:00:00Z"), now)!, /Vortag/);
  // Morgen früh um 7 Uhr Berlin: nur 11 Stunden.
  assert.match(sessionLeadError(at("2026-09-24T05:00:00Z"), now)!, /12 Stunden/);
  // Morgen 9 Uhr Berlin: 13 Stunden, erlaubt.
  assert.equal(sessionLeadError(at("2026-09-24T07:00:00Z"), now), null);
  assert.equal(earliestSessionDay(now), "2026-09-24");
  // Kurz vor Mitternacht in Berlin: morgen ist der nächste Kalendertag.
  assert.equal(earliestSessionDay(at("2026-09-23T21:30:00Z")), "2026-09-24");
});

test("members create and edit their own sessions; the team may edit and cancel any, the host stays", async () => {
  await assert.rejects(createSession(db, alice, "Alice", input(new Date(Date.now() + 3600_000).toISOString())), /Vortag|Vorlauf|12 Stunden/);
  const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const { id } = await createSession(db, alice, "Alice", input(start));
  const [row] = await db.query("SELECT data FROM sessions WHERE id=$1", [id]);
  assert.equal(JSON.parse(row.data).url, "");
  assert.equal((await db.query("SELECT owner FROM rsvps WHERE session=$1", [id]))[0].owner, alice);
  // Fremde Session ohne Teamrolle: nein.
  await assert.rejects(editSession(db, { userId: bob, team: false }, id, input(start, { title: "Anders" })), /eigene/);
  await assert.rejects(cancelSession(db, { userId: bob, team: false }, id), /eigene/);
  // Moderator: darf korrigieren, der Host bleibt Alice, ein Discord-Raum bleibt erhalten.
  await db.query(
    "UPDATE sessions SET data=(data::jsonb || '{\"discord\":{\"channelId\":\"c9\",\"url\":\"https://discord.com/channels/g1/c9\"}}'::jsonb)::text WHERE id=$1",
    [id],
  );
  await editSession(db, { userId: mo, team: true }, id, input(start, { title: "Einwände üben, Runde 2" }));
  const edited = JSON.parse((await db.query("SELECT data FROM sessions WHERE id=$1", [id]))[0].data);
  assert.equal(edited.title, "Einwände üben, Runde 2");
  assert.equal(edited.host, "Alice");
  assert.equal(edited.discord.channelId, "c9");
  // Verschieben auf zu kurzfristig: abgelehnt.
  await assert.rejects(
    editSession(db, { userId: alice, team: false }, id, input(new Date(Date.now() + 2 * 3600_000).toISOString())),
    /Vortag|12 Stunden/,
  );
  await cancelSession(db, { userId: mo, team: true }, id);
  assert.equal(JSON.parse((await db.query("SELECT data FROM sessions WHERE id=$1", [id]))[0].data).cancelled, true);
});

test("the sync creates one voice channel and one event per session, links it, and is idempotent", async () => {
  const now = at("2026-09-23T18:00:00Z");
  const start = "2026-09-25T16:00:00.000Z";
  await db.query("INSERT INTO sessions(id,owner,data) VALUES('s1',$1,$2)", [
    alice,
    JSON.stringify({ ...input(start), host: "Alice", url: "", cancelled: false }),
  ]);
  const d = fakeDiscord();
  const first = await syncSessionRooms(db, d.fetcher, now);
  assert.deepEqual(first, { configured: true, created: 1, updated: 0, closed: 0, failed: 0 });
  const channel = d.calls.find((c) => c.path === "/guilds/g1/channels")!;
  assert.equal(channel.body.type, 2);
  assert.equal(channel.body.parent_id, "cat1");
  assert.equal(channel.body.user_limit, 4);
  assert.match(channel.body.name, /^Roleplay · Fr 25\.09\. 18:00 · Einwände üben$/);
  const event = d.calls.find((c) => c.path === "/guilds/g1/scheduled-events")!;
  assert.equal(event.body.entity_type, 2);
  assert.equal(event.body.channel_id, "id1");
  assert.equal(event.body.scheduled_start_time, start);
  assert.match(event.body.description, /Roleplay mit Alice, 45 Minuten, 4 Plätze/);
  assert.doesNotMatch(JSON.stringify(d.calls), /@|\+49/);
  const room = JSON.parse((await db.query("SELECT data FROM sessions WHERE id='s1'"))[0].data).discord;
  assert.equal(room.url, "https://discord.com/channels/g1/id1");
  assert.equal(room.eventUrl, "https://discord.com/events/g1/id2");
  // Zweiter Lauf ohne Änderung: kein Aufruf.
  const before = d.calls.length;
  await syncSessionRooms(db, d.fetcher, now);
  assert.equal(d.calls.length, before);
  assert.deepEqual(await sessionRoomStatus(db, now), { withRoom: 1, waiting: 0, lastRun: null });
});

test("changes are pulled into Discord; a deleted channel is recreated; cancel and past sessions are cleaned up", async () => {
  const now = at("2026-09-23T18:00:00Z");
  const start = "2026-09-25T16:00:00.000Z";
  await db.query("INSERT INTO sessions(id,owner,data) VALUES('s1',$1,$2)", [
    alice,
    JSON.stringify({ ...input(start), host: "Alice", url: "", cancelled: false }),
  ]);
  const d = fakeDiscord();
  await syncSessionRooms(db, d.fetcher, now);
  await db.query(
    "UPDATE sessions SET data=(data::jsonb || '{\"title\":\"Neuer Titel\",\"capacity\":5}'::jsonb)::text WHERE id='s1'",
  );
  const r = await syncSessionRooms(db, d.fetcher, now);
  assert.equal(r.configured && r.updated, 1);
  assert.equal(d.calls.at(-2)!.method, "PATCH");
  assert.equal(d.calls.at(-2)!.body.user_limit, 5);
  assert.equal(d.calls.at(-1)!.body.name, "Neuer Titel");
  // Im Discord gelöscht: der Abgleich legt Kanal und Event neu an.
  const gone = fakeDiscord({ missing: new Set(["/channels/id1"]) });
  await db.query("UPDATE sessions SET data=(data::jsonb || '{\"minutes\":60}'::jsonb)::text WHERE id='s1'");
  const again = await syncSessionRooms(db, gone.fetcher, now);
  assert.equal(again.configured && again.created, 1);
  // Absage: Event und Kanal werden entfernt, danach Ruhe.
  await db.query("UPDATE sessions SET data=(data::jsonb || '{\"cancelled\":true}'::jsonb)::text WHERE id='s1'");
  const c = fakeDiscord();
  const closed = await syncSessionRooms(db, c.fetcher, now);
  assert.equal(closed.configured && closed.closed, 1);
  assert.deepEqual(c.calls.map((x) => x.method), ["DELETE", "DELETE"]);
  await syncSessionRooms(db, c.fetcher, now);
  assert.equal(c.calls.length, 2);
  // Vorbei (6 Stunden nach Ende): aufräumen.
  await db.query("INSERT INTO sessions(id,owner,data) VALUES('s2',$1,$2)", [
    alice,
    JSON.stringify({
      ...input("2026-09-22T10:00:00.000Z"),
      host: "Alice",
      discord: { channelId: "old", url: "https://discord.com/channels/g1/old" },
    }),
  ]);
  const p = fakeDiscord();
  const past = await syncSessionRooms(db, p.fetcher, now);
  assert.equal(past.configured && past.closed, 1);
  assert.deepEqual(p.calls, [{ method: "DELETE", path: "/channels/old", body: null }]);
});

test("without bot token nothing happens and the status says what is missing", async () => {
  delete process.env.DISCORD_BOT_TOKEN;
  const d = fakeDiscord();
  const r = await syncSessionRooms(db, d.fetcher);
  assert.deepEqual(r, { configured: false, missing: ["DISCORD_BOT_TOKEN"] });
  assert.equal(d.calls.length, 0);
});

test("team members with a linked Discord account get the moderator role; only roles the sync gave are taken back", async () => {
  await db.query("INSERT INTO team_roles(owner,role,granted_by) VALUES('mo','moderator','admin')");
  await db.query(
    "INSERT INTO discord_links(owner,discord_user_id,discord_name) VALUES('mo','d-mo','Mo'),('alice','d-alice','Alice'),('admin','d-admin','Admin')",
  );
  const d = fakeDiscord();
  const r = await syncModeratorRoles(db, d.fetcher);
  assert.deepEqual(r, { configured: true, added: 2, removed: 0, waiting: 0 });
  assert.deepEqual(
    d.calls.map((c) => `${c.method} ${c.path}`).sort(),
    ["PUT /guilds/g1/members/d-admin/roles/role-mod", "PUT /guilds/g1/members/d-mo/roles/role-mod"],
  );
  // Rolle entzogen: der Abgleich nimmt sie im Discord wieder weg, Alice bleibt unberührt.
  await db.query("DELETE FROM team_roles WHERE owner='mo'");
  const e = fakeDiscord();
  const r2 = await syncModeratorRoles(db, e.fetcher);
  assert.deepEqual(r2, { configured: true, added: 0, removed: 1, waiting: 0 });
  assert.deepEqual(e.calls.map((c) => `${c.method} ${c.path}`), ["DELETE /guilds/g1/members/d-mo/roles/role-mod"]);
  // Noch nicht auf dem Server (404): später erneut.
  await db.query("INSERT INTO team_roles(owner,role,granted_by) VALUES('alice','moderator','admin')");
  const f = fakeDiscord({ missing: new Set(["/guilds/g1/members/d-alice/roles/role-mod"]) });
  const r3 = await syncModeratorRoles(db, f.fetcher);
  assert.deepEqual(r3, { configured: true, added: 0, removed: 0, waiting: 1 });
});

test("automatic runs happen at most every 15 minutes and never twice at the same time", async () => {
  const now = at("2026-09-23T18:00:00Z");
  const d = fakeDiscord();
  const first = await runDiscordRooms(db, { fetcher: d.fetcher, now, auto: true });
  assert.equal("sessions" in first, true);
  const soon = await runDiscordRooms(db, { fetcher: d.fetcher, now: new Date(now.getTime() + 5 * 60_000), auto: true });
  assert.deepEqual(soon, { configured: true, skipped: true });
  // Der Knopf läuft sofort, außer ein anderer Lauf hält gerade die Sperre.
  await db.query(
    "UPDATE app_settings SET value=jsonb_build_object('until',$1::text) WHERE key='discord-rooms-lease'",
    [new Date(now.getTime() + 60 * 60_000).toISOString()],
  );
  assert.deepEqual(await runDiscordRooms(db, { fetcher: d.fetcher, now }), { configured: true, busy: true });
});
