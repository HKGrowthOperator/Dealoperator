import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../server/database";
import { publicRanking } from "../server/operator";
import {
  closingState,
  requestPause,
  saveDraft,
  submitClosing,
} from "../server/closing";
import { reflectionFeed } from "../server/reflections";
import {
  allowedPushEndpoint,
  dispatch,
  enqueue,
  subscribe,
  teamEvent,
} from "../server/notify";
import { planReminders, recheck } from "../server/scheduler";
import { commitWins, previewWins, resolveReviewCase } from "../server/wins-import";
import { decidePause } from "../server/admin";
import { noteConfirmedAccount } from "../server/onboarding";
import { syncDiscord } from "../server/discord-sync";
import { berlinDate } from "../lib/kpis";
import { defaultCommitmentSettings, zonedTime } from "../lib/commitment";

// Fiktive Konten; keine echten Kontaktdaten.
const admin = { userId: "admin", email: "admin@example.invalid", admin: true };
const alice = { userId: "alice", email: "alice@example.invalid", admin: false };
const bob = { userId: "bob", email: "bob@example.invalid", admin: false };
let pg: PGlite, db: Database;

before(async () => {
  process.env.OPERATOR_ADMIN_IDS = "admin";
  delete process.env.RESEND_API_KEY;
  delete process.env.DISCORD_BOT_TOKEN;
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as any, (fn) => pg.transaction((tx) => fn(new Database(tx as any))));
});
beforeEach(async () => {
  await pg.exec(
    `TRUNCATE participants,profiles,account_private,requests,rate_limits,onboarding_requests,
      notifications,notification_prefs,push_subscriptions,team_inbox,import_review_cases,
      participant_aliases,pauses,sync_outbox,app_settings CASCADE`,
  );
});
after(async () => {
  await pg.close();
});

const today = () => berlinDate();
function dayOffset(n: number) {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Mitglied mit eigenem Profil; optional mit Telefonnummer und öffentlicher Anzeige. */
async function member(actor: typeof alice, name: string, opts: { phone?: boolean; publicConsent?: boolean } = {}) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO participants(id,name,owner,email,public_consent,claimed_at) VALUES($1,$2,$3,$4,$5,now())",
    [id, name, actor.userId, actor.email, opts.publicConsent ?? false],
  );
  if (opts.phone !== false)
    await db.query("INSERT INTO account_private(owner,email,phone) VALUES($1,$2,'+4917012345678')", [
      actor.userId,
      actor.email,
    ]);
  return id;
}

function closing(extra: Record<string, unknown> = {}) {
  return {
    day: today(),
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
    counts: { attempts: 40, settingsBooked: 2, closingsBooked: 1 },
    reflection: { energy: 8, win: "Einstieg saß", next: "Früher starten", help: "" },
    acknowledged: true,
    ...extra,
  };
}

test("a draft is private: no ranking, no group sum, no exchange", async () => {
  await member(alice, "Alice", { publicConsent: true });
  await member(bob, "Bob");
  await saveDraft(db, alice, {
    day: today(),
    counts: { attempts: 99 },
    reflection: { energy: 9, win: "Entwurf" },
  });
  assert.equal((await db.query("SELECT * FROM checkins")).length, 0);
  assert.equal((await publicRanking(db, today(), today())).length, 0);
  const feed = await reflectionFeed(db, bob, {});
  assert.equal(feed.allowed, true);
  assert.equal(feed.cards.length, 0);
});

test("submitting needs numbers, a consciously chosen energy, both answers and the acknowledgement", async () => {
  await member(alice, "Alice");
  const c = closing();
  await assert.rejects(submitClosing(db, alice, { ...c, acknowledged: false }), /wer deinen Tagesabschluss sieht/);
  await assert.rejects(
    submitClosing(db, alice, { ...c, reflection: { ...c.reflection, energy: undefined } }),
    /Energie/,
  );
  await assert.rejects(
    submitClosing(db, alice, { ...c, reflection: { ...c.reflection, next: "" } }),
    /nächsten Calling-Tag/,
  );
  await assert.rejects(
    submitClosing(db, alice, { ...c, counts: { attempts: 40, settingsBooked: 2 } }),
  );
  // Entscheidergespräche nimmt der Tagesabschluss nicht an.
  await assert.rejects(
    submitClosing(db, alice, { ...c, counts: { ...c.counts, decisionMakerConversations: 3 } }),
  );
  const ok = await submitClosing(db, alice, c);
  assert.equal(ok.revision, 1);
});

test("without a phone number there is no counted closing and no access to the exchange", async () => {
  await member(alice, "Alice", { phone: false });
  await assert.rejects(submitClosing(db, alice, closing()), /Telefonnummer/);
  const feed = await reflectionFeed(db, alice, {});
  assert.equal(feed.allowed, false);
  assert.deepEqual(feed.missing, ["phone"]);
  // Ein Entwurf geht trotzdem — er zählt nirgends.
  assert.equal((await saveDraft(db, alice, { day: today(), counts: {}, reflection: {} })).ok, true);
});

test("the exchange shows only submitted closings; numbers only with public consent; help stays with the team", async () => {
  const a = await member(alice, "Alice", { publicConsent: false });
  await member(bob, "Bob", { publicConsent: true });
  await submitClosing(db, alice, closing({ reflection: { energy: 6, win: "Gut", next: "Besser", help: "Einwandbehandlung" } }));
  await submitClosing(db, bob, closing());
  const feed = await reflectionFeed(db, alice, {});
  assert.equal(feed.cards.length, 2);
  const card = feed.cards.find((c) => c.participant === a)!;
  assert.equal(card.numbers, null);
  assert.equal(card.help, "");
  assert.equal(card.reply.kind, "invite");
  assert.ok(feed.cards.find((c) => c.name === "Bob")!.numbers);
  const [inbox] = await db.query("SELECT kind,body FROM team_inbox WHERE kind='help'");
  assert.match(inbox.body, /Einwandbehandlung/);
  // Kein Push für den Unterstützungswunsch, nur Inbox.
  assert.equal((await db.query("SELECT * FROM notifications")).length, 0);
});

test("a late autosave never revives an older draft over a submitted closing", async () => {
  await member(alice, "Alice");
  await saveDraft(db, alice, { day: today(), baseRevision: 0, counts: { attempts: 10 }, reflection: {} });
  await submitClosing(db, alice, closing());
  const stale = await saveDraft(db, alice, { day: today(), baseRevision: 0, counts: { attempts: 11 }, reflection: {} });
  assert.equal(stale.ok, false);
  const state = await closingState(db, alice, today().slice(0, 7));
  assert.equal(state.drafts.length, 0);
});

test("a registration alerts the team exactly once per account, with neutral text", async () => {
  for (let i = 0; i < 3; i++)
    await db.transaction((tx) =>
      teamEvent(tx, {
        dedupeKey: `registration:r${i}`,
        kind: "registration",
        ref: `r${i}`,
        state: "confirmed",
        title: "Neue Registrierung bestätigt: Alice Beispiel",
        body: "E-Mail bestätigt.",
        alert: { key: "signup:alice", kind: "new" },
      }),
    );
  const sent = await db.query("SELECT channel,title,body FROM notifications ORDER BY channel");
  assert.deepEqual(sent.map((n) => n.channel), ["email", "push"]);
  for (const n of sent) {
    assert.doesNotMatch(`${n.title} ${n.body}`, /Alice|@|\+49/);
  }
});

const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const keys = { p256dh: `B${"a".repeat(86)}`, auth: "b".repeat(22) };

test("push targets are limited to browser push services", () => {
  assert.equal(allowedPushEndpoint(endpoint(1)), true);
  assert.equal(allowedPushEndpoint("https://web.push.apple.com/abc"), true);
  assert.equal(allowedPushEndpoint("https://evil.example/fcm.googleapis.com"), false);
  assert.equal(allowedPushEndpoint("http://fcm.googleapis.com/x"), false);
  assert.equal(allowedPushEndpoint("https://user:pw@fcm.googleapis.com/x"), false);
});

test("each device gets a push at most once, even after a crash between sending and marking", async () => {
  await subscribe(db, alice, { endpoint: endpoint(1), keys }, "iPhone");
  await subscribe(db, alice, { endpoint: endpoint(2), keys }, "Mac");
  await enqueue(db, {
    dedupeKey: "test:once",
    recipient: alice.userId,
    channel: "push",
    kind: "test",
    title: "Deal Operator",
    body: "Test",
  });
  const seen: string[] = [];
  const send = (async (sub: { endpoint: string }) => {
    seen.push(sub.endpoint);
    return { statusCode: 201 };
  }) as any;
  await dispatch(db, recheck, new Date(), send);
  assert.equal(seen.length, 2);
  // Absturz simulieren: Zeile hängt in „sending“, Frist abgelaufen.
  await db.query(
    "UPDATE notifications SET status='sending',claimed_at=now()-interval '20 minutes' WHERE dedupe_key='test:once'",
  );
  await dispatch(db, recheck, new Date(), send);
  assert.equal(seen.length, 2);
  // Doppeltes Einreihen desselben Anlasses legt nichts Neues an.
  assert.equal(
    await enqueue(db, { dedupeKey: "test:once", recipient: alice.userId, channel: "push", kind: "test", title: "x", body: "y" }),
    false,
  );
});

test("a team push without a device waits instead of being dropped", async () => {
  await db.transaction((tx) =>
    teamEvent(tx, {
      dedupeKey: "registration:x",
      kind: "registration",
      ref: "x",
      state: "confirmed",
      title: "Neue Registrierung",
      body: "",
      alert: { key: "signup:x", kind: "new" },
    }),
  );
  await dispatch(db, recheck, new Date(), (async () => ({})) as any);
  const rows = await db.query("SELECT channel,status FROM notifications ORDER BY channel");
  // Ohne Gerät und ohne Mail-Konfiguration: beide warten.
  assert.deepEqual(rows.map((r) => [r.channel, r.status]), [
    ["email", "pending"],
    ["push", "pending"],
  ]);
  await subscribe(db, admin, { endpoint: endpoint(9), keys }, "iPhone");
  await db.query("UPDATE notifications SET next_attempt_at=now()");
  let pushed = 0;
  await dispatch(db, recheck, new Date(), (async () => {
    pushed++;
    return {};
  }) as any);
  assert.equal(pushed, 1);
});

test("reminders are planned once, and skipped when the closing arrived in between", async () => {
  const id = await member(alice, "Alice");
  await db.query("UPDATE participants SET eligible_since=now()-interval '10 days' WHERE id=$1", [id]);
  await subscribe(db, alice, { endpoint: endpoint(3), keys }, "iPhone");
  // Ein Werktag um 20:35 Berliner Zeit.
  let day = today();
  while ([6, 0].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    day = d.toISOString().slice(0, 10);
  }
  const at = zonedTime(day, 20, 35, "Europe/Berlin");
  await db.transaction((tx) => planReminders(tx, at, defaultCommitmentSettings));
  await db.transaction((tx) => planReminders(tx, at, defaultCommitmentSettings));
  const planned = await db.query("SELECT kind,ref FROM notifications");
  assert.deepEqual(planned.map((p) => p.kind), ["reminder:evening"]);
  // Abschluss liegt inzwischen vor → erneute Prüfung verhindert den Versand.
  await db.query(
    `INSERT INTO checkins(participant,day,counts,source,origin,first_submitted_at,submitted_at,shared)
     VALUES($1,$2,'{}','website','closing',now(),now(),true)`,
    [id, day],
  );
  assert.match(
    (await recheck(db, { kind: "reminder:evening", recipient: alice.userId, ref: `${id}:${day}` }))!,
    /liegt inzwischen vor/,
  );
});

test("wins import: preview, commit, repeat without changes; members' days stay theirs", async () => {
  const anna = randomUUID();
  await db.query("INSERT INTO participants(id,name,kind) VALUES($1,'Anna Beispiel','person')", [anna]);
  const claimed = await member(bob, "Bert Probe");
  // Bert hat sein Profil vor drei Tagen übernommen: ab dann zählen nur seine
  // eigenen Abschlüsse.
  await db.query("UPDATE participants SET claimed_at=now()-interval '3 days' WHERE id=$1", [claimed]);
  const day = dayOffset(-1);
  const [y, m, d] = day.split("-");
  const text = [
    `${d}.${m}.${y.slice(2)}, 18:00 - Anna Beispiel: 50 Anwahlen, 2 Settings`,
    `${d}.${m}.${y.slice(2)}, 19:00 - Bert Probe: 70 Anwahlen`,
    `${d}.${m}.${y.slice(2)}, 19:30 - Unbekannt Person: 10 Anwahlen`,
  ].join("\n");
  const preview = await previewWins(db, admin, { text, day });
  assert.deepEqual(
    preview.rows.map((r) => r.action),
    ["neu", "übersprungen", "prüffall"],
  );
  const expected = preview.rows.filter((r) => r.key).map((r) => ({ key: r.key!, revision: r.revision }));
  const result = await commitWins(db, admin, { text, day, key: randomUUID(), expected });
  assert.equal(result.written, 1);
  assert.equal(result.cases, 1);
  const again = await previewWins(db, admin, { text, day });
  assert.equal(again.rows[0].action, "unverändert");
  const second = await commitWins(db, admin, {
    text,
    day,
    key: randomUUID(),
    expected: again.rows.filter((r) => r.key).map((r) => ({ key: r.key!, revision: r.revision })),
  });
  assert.equal(second.written, 0);
  assert.equal(second.cases, 0);
  assert.equal((await db.query("SELECT * FROM checkins WHERE participant=$1", [claimed])).length, 0);
  await assert.rejects(previewWins(db, alice, { text, day }), /Team/);
});

test("a review case resolved as alias makes the next import of the same text count", async () => {
  const anna = randomUUID();
  await db.query("INSERT INTO participants(id,name,kind) VALUES($1,'Anna Beispiel','person')", [anna]);
  const day = dayOffset(-2);
  const [y, m, d] = day.split("-");
  const text = `${d}.${m}.${y.slice(2)}, 18:00 - Anni B.: 30 Anwahlen`;
  const first = await previewWins(db, admin, { text, day });
  await commitWins(db, admin, { text, day, key: randomUUID(), expected: [] });
  assert.equal(first.rows[0].action, "prüffall");
  const [c] = await db.query("SELECT id FROM import_review_cases");
  await resolveReviewCase(db, admin, { id: c.id, decision: "alias", participantId: anna });
  const next = await previewWins(db, admin, { text, day });
  assert.equal(next.rows[0].action, "neu");
  assert.equal(next.rows[0].participantId, anna);
});

test("members request pauses from today on; the team decides once", async () => {
  await member(alice, "Alice");
  await assert.rejects(requestPause(db, alice, { from: dayOffset(-1), to: dayOffset(2) }), /ab heute/);
  const { id } = await requestPause(db, alice, { from: today(), to: dayOffset(3), reason: "Urlaub" });
  await assert.rejects(decidePause(db, alice, { id, decision: "approved" }), /Team/);
  await decidePause(db, admin, { id, decision: "approved" });
  await assert.rejects(decidePause(db, admin, { id, decision: "rejected" }), /schon entschieden/);
});

test("without Discord credentials nothing is marked as synced", async () => {
  await member(alice, "Alice");
  await submitClosing(db, alice, closing({ discord: true }));
  const result = await syncDiscord(db);
  assert.equal(result.configured, false);
  const [row] = await db.query("SELECT state FROM sync_outbox");
  assert.equal(row.state, "pending");
});

test("a new account from the sign-in page alerts the team once, never for existing profiles", async () => {
  await noteConfirmedAccount(db, alice);
  await noteConfirmedAccount(db, alice);
  assert.equal((await db.query("SELECT * FROM team_inbox")).length, 1);
  const sent = await db.query("SELECT channel FROM notifications ORDER BY channel");
  assert.deepEqual(sent.map((n) => n.channel), ["email", "push"]);
  await member(bob, "Bob");
  await noteConfirmedAccount(db, bob);
  assert.equal((await db.query("SELECT * FROM team_inbox")).length, 1);
});

test("saved rules with the retired calling-streak switch stay valid; only one streak is left", async () => {
  const { loadCommitmentSettings, saveCommitmentSettings } = await import("../server/settings");
  const { defaultCommitmentSettings } = await import("../lib/commitment");
  await db.query(
    `INSERT INTO app_settings(key,value) VALUES('commitment',$1::jsonb)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [JSON.stringify({ ...defaultCommitmentSettings, deadlineHour: 11, zeroCallDayBreaksCallingStreak: true })],
  );
  const loaded = await loadCommitmentSettings(db);
  assert.equal(loaded.deadlineHour, 11);
  assert.equal("zeroCallDayBreaksCallingStreak" in loaded, false);
  // Auch ein älteres Formular mit dem Schalter lässt sich noch speichern.
  const saved = await saveCommitmentSettings(db, "admin", { ...loaded, zeroCallDayBreaksCallingStreak: false });
  assert.equal("zeroCallDayBreaksCallingStreak" in saved, false);
  await db.query("DELETE FROM app_settings WHERE key='commitment'");
});

test("an own closing replaces a day filled from the group messages; curated imports stay locked", async () => {
  const id = await member(alice, "Alice");
  const imported = async (source: string) =>
    db.query(
      `INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,$2,$3::jsonb,$4,'import')
       ON CONFLICT(participant,day) DO UPDATE SET counts=excluded.counts,source=excluded.source`,
      [id, today(), JSON.stringify({ attempts: 70, legacyMeetings: 2 }), source],
    );
  // Ein Entwurf von vorher.
  await saveDraft(db, alice, { day: today(), baseRevision: 0, counts: { attempts: 45 }, reflection: {} });
  // Kuratierter Import (z. B. CSV, Akquise Day): bleibt gesperrt.
  await imported("owner-import");
  await assert.rejects(submitClosing(db, alice, closing({ expectedRevision: 1 })), /übernommenen Stand/);
  assert.equal((await closingState(db, alice, today().slice(0, 7))).drafts.length, 0);
  // Aus den Gruppenmeldungen übernommen: nur eine Lücke, die der eigene
  // Abschluss füllt. Der Entwurf bleibt sichtbar.
  await imported("wins-import");
  const state = await closingState(db, alice, today().slice(0, 7));
  assert.equal(state.closings[0].replaceable, true);
  assert.equal(state.drafts[0]?.counts.attempts, 45);
  // Ein übernommener Tag zählt nicht als eigener Abschluss.
  assert.equal(state.summary?.closedDays ?? 0, 0);
  await submitClosing(db, alice, closing({ expectedRevision: 1 }));
  const [row] = await db.query("SELECT counts,origin,revision,first_submitted_at FROM checkins WHERE participant=$1", [id]);
  assert.equal(row.origin, "closing");
  assert.equal(row.revision, 2);
  assert.ok(row.first_submitted_at);
  assert.equal(row.counts.attempts, 40);
  // Werte aus dem übernommenen Stand werden nicht mitgenommen.
  assert.equal(row.counts.legacyMeetings, null);
});
