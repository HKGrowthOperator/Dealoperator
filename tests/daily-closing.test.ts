import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../server/database";
import { publicRanking, showInRanking } from "../server/operator";
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
  pushName,
  subscribe,
  teamEvent,
  teamPushText,
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

/** Eine Einreichung ohne die Bestätigung „wer sieht was“ (Feld fehlt ganz). */
function unacknowledged(extra: Record<string, unknown> = {}) {
  const value: Record<string, unknown> = closing(extra);
  delete value.acknowledged;
  return value;
}

test("who sees the closing is confirmed once; later closings need no confirmation, on any day", async () => {
  const id = await member(alice, "Alice");
  await db.query("UPDATE participants SET eligible_since=now()-interval '10 days' WHERE id=$1", [id]);
  const month = today().slice(0, 7);
  assert.equal((await closingState(db, alice, month)).visibilityConfirmed, false);
  // Ein Tag aus den Gruppenmeldungen ist keine Bestätigung.
  await db.query(
    `INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,$2,'{"attempts":5}','wins-import','import')`,
    [id, dayOffset(-1)],
  );
  assert.equal((await closingState(db, alice, month)).visibilityConfirmed, false);
  // Beim ersten Mal ohne Bestätigung: abgelehnt, weggelassen wie verneint.
  await assert.rejects(submitClosing(db, alice, unacknowledged()), /wer deinen Tagesabschluss sieht/);
  await assert.rejects(submitClosing(db, alice, closing({ acknowledged: false })), /wer deinen Tagesabschluss sieht/);
  assert.equal((await closingState(db, alice, month)).visibilityConfirmed, false);
  await submitClosing(db, alice, closing());
  assert.equal((await closingState(db, alice, month)).visibilityConfirmed, true);
  // Danach: Korrektur und ein anderer Tag ohne erneute Bestätigung.
  const correction = unacknowledged({ expectedRevision: 1, counts: { attempts: 12, settingsBooked: 0, closingsBooked: 0 } });
  assert.equal((await submitClosing(db, alice, correction)).revision, 2);
  assert.ok((await submitClosing(db, alice, unacknowledged({ day: dayOffset(-1), expectedRevision: 1 }))).ok);
  // Auch ein älteres Formular, das die Bestätigung weiter mitschickt, geht.
  assert.ok((await submitClosing(db, alice, closing({ expectedRevision: 2 }))).ok);
  // Bob hat noch nie eingereicht: für ihn gilt die Bestätigung weiter.
  await member(bob, "Bob");
  assert.equal((await closingState(db, bob, month)).visibilityConfirmed, false);
  await assert.rejects(submitClosing(db, bob, unacknowledged()), /wer deinen Tagesabschluss sieht/);
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

test("a registration alerts the team exactly once per account; push names the person, the email stays neutral", async () => {
  for (let i = 0; i < 3; i++)
    await db.transaction((tx) =>
      teamEvent(tx, {
        dedupeKey: `registration:r${i}`,
        kind: "registration",
        ref: `r${i}`,
        state: "confirmed",
        title: "Neue Registrierung bestätigt: Alice Beispiel",
        body: "E-Mail bestätigt.",
        alert: {
          key: "signup:alice",
          kind: "new",
          push: teamPushText({ kind: "new", name: "Alice Beispiel" }),
        },
      }),
    );
  const sent = await db.query("SELECT channel,title,body,url FROM notifications ORDER BY channel");
  assert.deepEqual(sent.map((n) => n.channel), ["email", "push"]);
  const [email, push] = sent;
  assert.doesNotMatch(`${email.title} ${email.body}`, /Alice|@|\+49/);
  assert.equal(push.title, "Neue Registrierung");
  assert.equal(push.body, "Alice Beispiel hat sich bei Deal Operator registriert.");
  // Antippen öffnet genau den Inbox-Eintrag der ersten Registrierung.
  const [entry] = await db.query("SELECT id FROM team_inbox WHERE dedupe_key='registration:r0'");
  assert.equal(push.url, `/verwaltung?bereich=inbox&eintrag=${entry.id}`);
  assert.equal(email.url, push.url);
});

test("team push texts never carry contact details, whatever was typed into the name", () => {
  for (const typed of ["alice@example.invalid", "Alice 0170 1234567", "+49 170 12 34 56", "www.example.org", "   "]) {
    const t = teamPushText({ kind: "new", name: typed });
    assert.equal(t.body, "Eine Person hat sich bei Deal Operator registriert.");
  }
  const claim = teamPushText({ kind: "claim", name: "Bob Beispiel", profile: "Alex B.", request: "r1" });
  assert.deepEqual(claim, {
    title: "Profilübernahme prüfen",
    body: "Bob Beispiel möchte das Profil Alex B. übernehmen.",
    url: "/verwaltung?bereich=uebernahmen&anfrage=r1",
  });
  // Profilname aus einem Import, der wie eine Nummer aussieht: nicht zeigen.
  assert.equal(
    teamPushText({ kind: "claim", name: "Bob Beispiel", profile: "+49 170 1234567", request: "r1" }).body,
    "Bob Beispiel möchte ein bestehendes Profil übernehmen.",
  );
  assert.match(
    teamPushText({ kind: "claim", name: "Bob Beispiel", profile: null, request: "r1" }).body,
    /^Bob Beispiel möchte ein bestehendes Profil übernehmen\. Das Profil wählt ihr/,
  );
  assert.equal(pushName("A".repeat(80)).length, 60);
  assert.equal(pushName("Zeile\neins"), "Zeile eins");
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
      alert: { key: "signup:x", kind: "new", push: teamPushText({ kind: "new", name: "X" }) },
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
  // Eine früher gespeicherte Ruhezeit (20 bis 7 Uhr) zählt nicht mehr.
  await db.query(
    "INSERT INTO notification_prefs(owner,reminders,quiet_start,quiet_end) VALUES($1,true,1200,420)",
    [alice.userId],
  );
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

test("wins import: preview, commit, repeat without changes; claimed profiles keep getting their numbers", async () => {
  const anna = randomUUID();
  await db.query("INSERT INTO participants(id,name,kind) VALUES($1,'Anna Beispiel','person')", [anna]);
  const claimed = await member(bob, "Bert Probe");
  // Bert hat sein Profil vor drei Tagen übernommen. Seine Zahlen aus der
  // Gruppe landen trotzdem auf seinem Profil; nur ein eigener Abschluss für
  // denselben Tag geht vor (tests/wins-import.test.ts).
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
    ["neu", "neu", "prüffall"],
  );
  const expected = preview.rows.filter((r) => r.key).map((r) => ({ key: r.key!, revision: r.revision }));
  const result = await commitWins(db, admin, { text, day, key: randomUUID(), expected });
  assert.equal(result.written, 2);
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
  const bert = await db.query("SELECT counts,origin FROM checkins WHERE participant=$1", [claimed]);
  assert.deepEqual(bert.map((c) => [c.origin, c.counts.attempts]), [["import", 70]]);
  await assert.rejects(previewWins(db, alice, { text, day }), /Team/);
});

test("a review case resolved as alias takes over its numbers and makes the next import of the same text count", async () => {
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
  // Die Werte des Prüffalls sind mit der Zuordnung übernommen.
  const [row] = await db.query("SELECT counts FROM checkins WHERE participant=$1 AND day=$2", [anna, day]);
  assert.equal(row.counts.attempts, 30);
  const next = await previewWins(db, admin, { text, day });
  assert.equal(next.rows[0].action, "unverändert");
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
  await submitClosing(db, alice, closing());
  const result = await syncDiscord(db);
  assert.equal(result.configured, false);
  const [row] = await db.query("SELECT state FROM sync_outbox");
  assert.equal(row.state, "pending");
});

test("a closing is never shared on Discord, even when an older form still asks for it", async () => {
  const id = await member(alice, "Alice");
  // Ältere Formulare schicken das Feld noch mit: angenommen, nicht beachtet.
  const first = await submitClosing(db, alice, closing({ discord: true }));
  assert.equal(first.revision, 1);
  const share = async () =>
    (await db.query("SELECT discord_share FROM checkins WHERE participant=$1", [id]))[0].discord_share;
  assert.equal(await share(), false);
  // Korrektur mit neuen Zahlen: bleibt aus.
  await submitClosing(db, alice, closing({ expectedRevision: 1, discord: true, counts: { attempts: 41, settingsBooked: 2, closingsBooked: 1 } }));
  assert.equal(await share(), false);
  // Eine alte Freigabe von früher fällt beim nächsten Einreichen weg, auch
  // ohne inhaltliche Änderung (keine neue Fassung).
  await db.query("UPDATE checkins SET discord_share=true WHERE participant=$1", [id]);
  const again = await submitClosing(db, alice, closing({ expectedRevision: 2, counts: { attempts: 41, settingsBooked: 2, closingsBooked: 1 } }));
  assert.equal(again.unchanged, true);
  assert.equal(again.revision, 2);
  assert.equal(await share(), false);
  // Der Stand für das Formular enthält keine Discord-Angabe mehr.
  const state = await closingState(db, alice, today().slice(0, 7));
  assert.equal("discord" in state.closings[0], false);
});

test("an account signing in without a request gets one inbox entry and no push, never for existing profiles", async () => {
  await noteConfirmedAccount(db, alice);
  await noteConfirmedAccount(db, alice);
  assert.equal((await db.query("SELECT * FROM team_inbox")).length, 1);
  // Anmelden ist keine Registrierung: kein Team-Push, keine E-Mail.
  assert.equal((await db.query("SELECT * FROM notifications")).length, 0);
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

test("the closing can switch the ranking on, never off; the start page switch does the same", async () => {
  await member(alice, "Alice");
  await assert.rejects(showInRanking(db, bob), /Profil/);
  // Nur „ein“: false nimmt das Schema nicht an.
  await assert.rejects(submitClosing(db, alice, closing({ publicConsent: false })));
  await submitClosing(db, alice, closing({ publicConsent: true }));
  const [p] = await db.query("SELECT public_consent FROM participants WHERE owner='alice'");
  assert.equal(p.public_consent, true);
  assert.equal((await publicRanking(db, today(), today())).length, 1);
  const state = await closingState(db, alice, today().slice(0, 7));
  assert.equal(state.eligibility.participant?.publicConsent, true);

  await member(bob, "Bob");
  await submitClosing(db, bob, closing());
  assert.equal((await publicRanking(db, today(), today())).length, 1);
  assert.deepEqual(await showInRanking(db, bob), { ok: true, publicConsent: true });
  assert.equal((await publicRanking(db, today(), today())).length, 2);
});

test("a confirmed registration is only information: the inbox entry starts resolved", async () => {
  await noteConfirmedAccount(db, alice);
  const [entry] = await db.query("SELECT state,resolved_at FROM team_inbox WHERE dedupe_key='account:alice'");
  assert.equal(entry.state, "confirmed");
  assert.ok(entry.resolved_at, "steht gleich unter Erledigt");
  // Etwas, das eine Entscheidung braucht, bleibt offen.
  await db.transaction((tx) =>
    teamEvent(tx, {
      dedupeKey: "pause:x",
      kind: "pause",
      ref: "x",
      state: "requested",
      title: "Pause gemeldet",
      body: "",
      alert: false,
    }),
  );
  const [open] = await db.query("SELECT resolved_at FROM team_inbox WHERE dedupe_key='pause:x'");
  assert.equal(open.resolved_at, null);
});
