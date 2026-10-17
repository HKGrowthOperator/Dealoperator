import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import { planCallReminders, recheckCallReminder } from "../server/call-reminders";
import { callEntryDestination } from "../server/call-entry";

let pg: PGlite, db: Database;
const now = new Date("2026-10-08T15:00:00Z");
const start = "2026-10-08T15:10:00.000Z";
before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as unknown as Executor, (fn) => pg.transaction((tx) => fn(new Database(tx as unknown as Executor))));
});
beforeEach(async () => {
  await pg.exec("TRUNCATE sessions,rsvps,notifications,push_subscriptions,notification_prefs CASCADE");
  await db.query("INSERT INTO sessions(id,owner,data) VALUES('call','host',$1)", [JSON.stringify({title:"Einwände üben",date:"2026-10-08",time:"17:10",startsAt:start,minutes:30,capacity:4})]);
  await db.query("INSERT INTO rsvps(session,owner) VALUES('call','alice'),('call','bob')");
  await db.query("INSERT INTO push_subscriptions(id,owner,endpoint,p256dh,auth) VALUES('device','alice','https://fcm.googleapis.com/fcm/send/test','test','test')");
});
after(async () => pg.close());

test("reminds only confirmed attendees with an enabled device, once per start time", async () => {
  assert.equal(await planCallReminders(db, new Date("2026-10-08T14:54:00Z")), 0);
  assert.equal(await planCallReminders(db, now), 1);
  assert.equal(await planCallReminders(db, now), 0);
  const [notification] = await db.query("SELECT recipient,kind,ref,url,not_after FROM notifications");
  assert.equal(notification.recipient,"alice");
  assert.equal(notification.url,"/call/call");
  assert.equal(new Date(notification.not_after).toISOString(),start);
  assert.equal(await recheckCallReminder(db,{kind:String(notification.kind),recipient:String(notification.recipient),ref:String(notification.ref)}),null);
  assert.equal(await planCallReminders(db,new Date(start)),0);
});

test("push entry opens the current validated room and stops cancelled or expired calls", async () => {
  assert.equal(await callEntryDestination(db,"call",now),"https://meet.google.com/dki-umso-umr");
  await db.query("UPDATE sessions SET data=(data::jsonb || $1::jsonb)::text",[JSON.stringify({roomUrl:"https://meet.google.com/abc-defg-hij"})]);
  assert.equal(await callEntryDestination(db,"call",now),"https://meet.google.com/abc-defg-hij");
  await db.query("UPDATE sessions SET data=(data::jsonb || $1::jsonb)::text",[JSON.stringify({roomUrl:"https://attacker.example/room",url:"javascript:alert(1)"})]);
  assert.equal(await callEntryDestination(db,"call",now),"https://meet.google.com/dki-umso-umr");
  assert.equal(await callEntryDestination(db,"missing",now),null);
  assert.equal(await callEntryDestination(db,"call",new Date("2026-10-08T15:40:00Z")),null);
  await db.query("UPDATE sessions SET data=(data::jsonb || '{\"cancelled\":true}'::jsonb)::text");
  assert.equal(await callEntryDestination(db,"call",now),null);
});

test("Sunday roleplay reminds at fifteen minutes and respects opt-out and disabled devices",async () => {
  await db.query("UPDATE sessions SET data=(data::jsonb || $1::jsonb)::text",[JSON.stringify({date:"2026-10-18",time:"09:00",startsAt:"2026-10-18T07:00:00.000Z",minutes:45,capacity:25})]);
  assert.equal(await planCallReminders(db,new Date("2026-10-18T06:44:59Z")),0);
  assert.equal(await planCallReminders(db,new Date("2026-10-18T06:45:00Z")),1);
  assert.equal(await planCallReminders(db,new Date("2026-10-18T06:46:00Z")),0);
  await db.query("DELETE FROM notifications");
  await db.query("UPDATE push_subscriptions SET disabled_at=now()");
  assert.equal(await planCallReminders(db,new Date("2026-10-18T06:45:00Z")),0);
  await db.query("UPDATE push_subscriptions SET disabled_at=null");
  await db.query("INSERT INTO notification_prefs(owner,reminders) VALUES('alice',false)");
  assert.equal(await planCallReminders(db,new Date("2026-10-18T06:45:00Z")),0);
});

test("withdrawn RSVP, cancelled call, changed start and disabled reminders invalidate queued reminders", async () => {
  const message = {kind:"call:reminder",recipient:"alice",ref:JSON.stringify({id:"call",start})};
  await db.query("DELETE FROM rsvps WHERE owner='alice'");
  assert.match((await recheckCallReminder(db,message))!,/Teilnahme/);
  await db.query("INSERT INTO rsvps(session,owner) VALUES('call','alice')");
  await db.query("UPDATE sessions SET data=(data::jsonb || '{\"cancelled\":true}'::jsonb)::text");
  assert.equal(await planCallReminders(db,now),0);
  assert.match((await recheckCallReminder(db,message))!,/abgesagt/);
  await db.query("UPDATE sessions SET data=(data::jsonb || '{\"cancelled\":false,\"startsAt\":\"2026-10-08T15:12:00.000Z\"}'::jsonb)::text");
  assert.match((await recheckCallReminder(db,message))!,/verschoben/);
  assert.equal(await planCallReminders(db,now),1);
  await db.query("INSERT INTO notification_prefs(owner,reminders) VALUES('alice',false)");
  assert.equal(await planCallReminders(db,now),0);
  assert.match((await recheckCallReminder(db,message))!,/ausgeschaltet/);
});
