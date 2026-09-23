import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../server/database";
import { berlinDate } from "../lib/kpis";
import { defaultCommitmentSettings } from "../lib/commitment";
import { requestPause } from "../server/closing";
import { issueClaim } from "../server/operator";
import { decidePause, saveCommitmentRules, teamInbox } from "../server/admin";
import { notificationStatus } from "../server/notify";
import { dispatch, enqueue, ensureAdminPrefs, notificationPrefs, savePrefs, subscribe, teamEvent } from "../server/notify";
import { recheck } from "../server/scheduler";
import { isTeamMember, setTeamRole, teamList, teamRecipients } from "../server/roles";

// Fiktive Konten; keine echten Kontaktdaten.
const owner = { userId: "owner", email: "owner@example.invalid", admin: true };
const alice = { userId: "alice", email: "alice@example.invalid", admin: false };
const mo = { userId: "mo", email: "mo@example.invalid", admin: false, moderator: true };
const ada = { userId: "ada", email: "ada@example.invalid", admin: true };
let pg: PGlite, db: Database;

before(async () => {
  process.env.OPERATOR_ADMIN_IDS = "owner";
  delete process.env.RESEND_API_KEY;
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as any, (fn) => pg.transaction((tx) => fn(new Database(tx as any))));
});
beforeEach(async () => {
  await pg.exec(
    `TRUNCATE participants,account_private,notifications,notification_prefs,push_subscriptions,
      team_inbox,pauses,team_roles,app_settings CASCADE`,
  );
  for (const a of [owner, alice, mo, ada])
    await db.query("INSERT INTO account_private(owner,email) VALUES($1,$2)", [a.userId, a.email]);
});
after(async () => {
  await pg.close();
});

const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const keys = { p256dh: `B${"a".repeat(86)}`, auth: "b".repeat(22) };
const signup = (id: string) =>
  db.transaction((tx) =>
    teamEvent(tx, {
      dedupeKey: `account:${id}`,
      kind: "registration",
      ref: id,
      state: "confirmed",
      title: "Neue Anmeldung bestätigt",
      body: "",
      alert: { key: `signup:${id}`, kind: "new" },
    }),
  );

test("only admins grant and remove roles; the fixed owner cannot be changed", async () => {
  await assert.rejects(setTeamRole(db, alice, { owner: "mo", role: "moderator" }), /Admin/);
  await setTeamRole(db, owner, { owner: "mo", role: "moderator" });
  await assert.rejects(setTeamRole(db, mo, { owner: "alice", role: "moderator" }), /Admin/);
  await assert.rejects(setTeamRole(db, owner, { owner: "owner", role: null }), /fest/);
  await assert.rejects(setTeamRole(db, owner, { owner: "nobody", role: "admin" }), /gibt es nicht/);

  // Neue Team-Mitglieder bekommen die E-Mail-Absicherung standardmäßig.
  const [prefs] = await db.query("SELECT team_alerts,team_email FROM notification_prefs WHERE owner='mo'");
  assert.deepEqual({ ...prefs }, { team_alerts: true, team_email: true });

  const list = await teamList(db, owner);
  assert.deepEqual(
    list.members.map((m) => [m.owner, m.role, m.fixed]).sort(),
    [["mo", "moderator", false], ["owner", "owner", true]],
  );
  assert.deepEqual(list.accounts.map((a) => a.owner).sort(), ["ada", "alice"]);
  await assert.rejects(teamList(db, mo), /Admin/);

  await setTeamRole(db, owner, { owner: "mo", role: "admin" });
  assert.equal((await teamList(db, owner)).members.find((m) => m.owner === "mo")?.role, "admin");
  await setTeamRole(db, owner, { owner: "mo", role: null });
  assert.equal(await isTeamMember(db, "mo"), false);
  assert.equal(await isTeamMember(db, "owner"), true);
});

test("moderators handle team tasks but not settings or roles", async () => {
  await db.query(
    "INSERT INTO participants(id,name,owner,email,claimed_at) VALUES($1,'Alice','alice',$2,now())",
    [randomUUID(), alice.email],
  );
  await db.query("UPDATE account_private SET phone='+4917012345678' WHERE owner='alice'");
  const { id } = await requestPause(db, alice, {
    from: berlinDate(),
    to: berlinDate(),
    reason: "Urlaub",
  });
  await assert.rejects(decidePause(db, alice, { id, decision: "approved" }), /Team/);
  await decidePause(db, mo, { id, decision: "approved" });
  assert.ok(Array.isArray(await teamInbox(db, mo)));
  await assert.rejects(saveCommitmentRules(db, mo, defaultCommitmentSettings), /Admin/);
  // Einladungscodes gehören zum CSV-Reiter und damit zu den Admins.
  const free = randomUUID();
  await db.query("INSERT INTO participants(id,name) VALUES($1,'Offen')", [free]);
  await assert.rejects(issueClaim(db, mo, free), /Admin/);
});

test("every admin and moderator gets each team alert once; a removed role stops open pushes", async () => {
  await setTeamRole(db, owner, { owner: "mo", role: "moderator" });
  await setTeamRole(db, owner, { owner: "ada", role: "admin" });
  assert.deepEqual((await teamRecipients(db)).sort(), ["ada", "mo", "owner"]);

  await signup("new-1");
  await signup("new-1");
  const rows = await db.query("SELECT recipient,channel FROM notifications ORDER BY recipient,channel");
  assert.deepEqual(
    rows.map((r) => `${r.recipient}:${r.channel}`),
    ["ada:email", "ada:push", "mo:email", "mo:push", "owner:email", "owner:push"],
  );

  await subscribe(db, owner, { endpoint: endpoint(1), keys }, "iPhone");
  await subscribe(db, mo, { endpoint: endpoint(2), keys }, "iPhone");
  await setTeamRole(db, owner, { owner: "mo", role: null });
  const seen: string[] = [];
  await dispatch(db, recheck, new Date(), (async (sub: { endpoint: string }) => {
    seen.push(sub.endpoint);
    return { statusCode: 201 };
  }) as any);
  assert.deepEqual(seen, [endpoint(1)]);
  const [moPush] = await db.query(
    "SELECT status,detail FROM notifications WHERE recipient='mo' AND channel='push'",
  );
  assert.equal(moPush.status, "skipped");
  assert.match(moPush.detail, /Team-Rolle/);
});

test("switching off team pushes keeps the separate email safeguard", async () => {
  await setTeamRole(db, owner, { owner: "mo", role: "moderator" });
  await db.query("UPDATE notification_prefs SET team_alerts=false WHERE owner='mo'");
  await signup("new-2");
  await dispatch(db, recheck, new Date(), (async () => ({ statusCode: 201 })) as any);
  const rows = await db.query(
    "SELECT channel,status FROM notifications WHERE recipient='mo' ORDER BY channel",
  );
  // Ohne Mail-Konfiguration wartet die E-Mail; der Push ist bewusst aus.
  assert.deepEqual(rows.map((r) => [r.channel, r.status]), [
    ["email", "pending"],
    ["push", "skipped"],
  ]);
});

test("everyone can save reminder settings; team members also their team switches", async () => {
  const base = { reminders: true, quietStart: null, quietEnd: null };
  // Mitglied: keine Team-Schalter, aber speichern klappt.
  await savePrefs(db, alice, base);
  await assert.rejects(savePrefs(db, alice, { ...base, teamAlerts: false }), /Team/);
  // Moderator: schaltet Pushs ab, E-Mail bleibt an.
  await setTeamRole(db, owner, { owner: "mo", role: "moderator" });
  await savePrefs(db, mo, { ...base, teamAlerts: false });
  let prefs = await notificationPrefs(db, "mo");
  assert.equal(prefs.teamAlerts, false);
  assert.equal(prefs.teamEmail, true);
  await savePrefs(db, mo, { ...base, teamEmail: false });
  prefs = await notificationPrefs(db, "mo");
  assert.equal(prefs.teamEmail, false);
  // Admin ohne Team-Felder: Standard bleibt an.
  await savePrefs(db, owner, { ...base, reminders: false });
  prefs = await notificationPrefs(db, "owner");
  assert.equal(prefs.reminders, false);
  assert.equal(prefs.teamEmail, true);
});

test("someone who saved reminders before becoming team still gets team emails", async () => {
  await savePrefs(db, alice, { reminders: true, quietStart: null, quietEnd: null });
  await setTeamRole(db, owner, { owner: "alice", role: "moderator" });
  const moderator = { ...alice, moderator: true };
  await ensureAdminPrefs(db, moderator);
  assert.equal((await notificationPrefs(db, "alice")).teamEmail, true);
  await signup("new-3");
  await dispatch(db, recheck, new Date(), (async () => ({ statusCode: 201 })) as any);
  const [mail] = await db.query(
    "SELECT status FROM notifications WHERE recipient='alice' AND channel='email'",
  );
  // Wartet nur noch auf die Mail-Konfiguration, statt übersprungen zu werden.
  assert.equal(mail.status, "pending");
});

test("the team inbox only calls a hint handed over after the push service or Resend took it", async () => {
  delete process.env.NOTIFY_FROM;
  await signup("new-4");
  let [item] = await teamInbox(db, owner);
  // Ohne Gerät und ohne Mail-Einrichtung: beides wartet, mit Grund.
  assert.deepEqual(
    item.delivery.map((d) => [d.channel, d.state]).sort(),
    [["email", "waiting_config"], ["push", "waiting_device"]],
  );
  await subscribe(db, owner, { endpoint: endpoint(7), keys }, "iPhone");
  await dispatch(db, recheck, new Date(), (async () => ({ statusCode: 201 })) as any);
  [item] = await teamInbox(db, owner);
  assert.deepEqual(
    item.delivery.map((d) => [d.channel, d.state]).sort(),
    [["email", "waiting_config"], ["push", "delivered"]],
  );
  const status = await notificationStatus(db);
  assert.equal(status.counts.sent, 1);
  assert.equal(status.counts.waitingConfig, 1);
  assert.equal(status.counts.waitingDevice, 0);
});

test("a rejected push counts as failed, an expired hint keeps its reason, old-key devices do not count", async () => {
  delete process.env.NOTIFY_FROM;
  await signup("new-5");
  // Gerät mit einem früheren Schlüssel: zählt wie kein Gerät.
  await subscribe(db, owner, { endpoint: endpoint(8), keys }, "iPhone");
  await db.query("UPDATE push_subscriptions SET vapid_key='ALT' WHERE owner='owner'");
  let [item] = await teamInbox(db, owner);
  assert.ok(item.delivery.some((d) => d.channel === "push" && d.state === "waiting_device"));
  // Push-Dienst lehnt ab: fehlgeschlagen, nicht „nicht gesendet“.
  await db.query("UPDATE push_subscriptions SET vapid_key=''");
  await dispatch(db, recheck, new Date(), (async () => {
    throw Object.assign(new Error("boom"), { statusCode: 500 });
  }) as any);
  [item] = await teamInbox(db, owner);
  assert.ok(item.delivery.some((d) => d.channel === "push" && d.state === "failed"));
  // E-Mail wartet auf die Einrichtung; nach Ablauf bleibt der Grund sichtbar.
  await db.query("UPDATE notifications SET next_attempt_at=now(),not_after=now()-interval '1 minute' WHERE channel='email'");
  await dispatch(db, recheck, new Date(), (async () => ({ statusCode: 201 })) as any);
  [item] = await teamInbox(db, owner);
  assert.ok(item.delivery.some((d) => d.channel === "email" && d.state === "expired_config"));
  const status = await notificationStatus(db);
  assert.equal(status.counts.failed, 1);
  assert.equal(status.counts.expired, 1);
});

test("an ended subscription is no failure: team hints wait, and a re-enabled device gets them", async () => {
  await signup("new-6");
  await subscribe(db, owner, { endpoint: endpoint(11), keys }, "iPhone");
  await dispatch(db, recheck, new Date(), (async () => {
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  }) as any);
  let [push] = await db.query("SELECT status,detail FROM notifications WHERE recipient='owner' AND channel='push'");
  assert.equal(push.status, "pending");
  assert.match(push.detail, /Kein Gerät mehr/);
  let [item] = await teamInbox(db, owner);
  assert.ok(item.delivery.some((d) => d.channel === "push" && d.state === "waiting_device"));
  // Dasselbe Gerät stimmt neu zu: der Hinweis geht doch noch hinaus.
  await subscribe(db, owner, { endpoint: endpoint(11), keys }, "iPhone");
  await db.query("UPDATE notifications SET next_attempt_at=now()");
  let sends = 0;
  await dispatch(db, recheck, new Date(), (async () => {
    sends++;
    return { statusCode: 201 };
  }) as any);
  assert.equal(sends, 1);
  [push] = await db.query("SELECT status FROM notifications WHERE recipient='owner' AND channel='push'");
  assert.equal(push.status, "sent");
  [item] = await teamInbox(db, owner);
  assert.ok(item.delivery.some((d) => d.channel === "push" && d.state === "delivered"));

  // Eine gewöhnliche Push-Nachricht an ein beendetes Abo ist kein Fehler.
  await subscribe(db, alice, { endpoint: endpoint(12), keys }, "iPhone");
  await enqueue(db, { dedupeKey: "test:gone", recipient: "alice", channel: "push", kind: "test", title: "x", body: "y" });
  await dispatch(db, recheck, new Date(), (async () => {
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  }) as any);
  const [plain] = await db.query("SELECT status FROM notifications WHERE dedupe_key='test:gone'");
  assert.equal(plain.status, "skipped");
  assert.equal((await notificationStatus(db)).counts.failed, 0);
});
