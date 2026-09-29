import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import { ownClosings, submitClosing, toClosings } from "../server/closing";
import {
  commitWins,
  previewWins,
  resolveReviewCase,
  reviewCases,
} from "../server/wins-import";
import { berlinDate } from "../lib/kpis";
import { cleanDisplayName } from "../lib/wins-parser";

// Wins-Import aus der WhatsApp-Gruppe. Alle Namen, Nummern und Nachrichten
// sind erfunden.
const admin = { userId: "admin", email: "admin@example.invalid", admin: true };
const bert = { userId: "bert", email: "bert@example.invalid", admin: false };
let pg: PGlite, db: Database;

before(async () => {
  process.env.OPERATOR_ADMIN_IDS = "admin";
  delete process.env.RESEND_API_KEY;
  delete process.env.DISCORD_BOT_TOKEN;
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as unknown as Executor, (fn) =>
    pg.transaction((tx) => fn(new Database(tx as unknown as Executor))),
  );
});
beforeEach(async () => {
  await pg.exec(
    `TRUNCATE participants,profiles,account_private,requests,rate_limits,onboarding_requests,
      notifications,notification_prefs,push_subscriptions,team_inbox,import_review_cases,
      participant_aliases,pauses,sync_outbox,app_settings,checkin_revisions CASCADE`,
  );
});
after(async () => {
  await pg.close();
});

function dayOffset(n: number) {
  const d = new Date(`${berlinDate()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Eine Zeile im Format von WhatsApp Web: „[19:05, 23.9.2026] Name: Text“. */
function wa(day: string, time: string, author: string, text: string) {
  const [y, m, d] = day.split("-");
  return `[${time}, ${Number(d)}.${Number(m)}.${y}] ${author}: ${text}`;
}
async function person(name: string) {
  const id = randomUUID();
  await db.query("INSERT INTO participants(id,name,kind) VALUES($1,$2,'person')", [id, name]);
  return id;
}
/** Vorschau erstellen und genau das Gezeigte übernehmen, wie die Oberfläche. */
async function importChat(lines: string[], day = berlinDate()) {
  const text = lines.join("\n");
  const preview = await previewWins(db, admin, { text, day });
  const expected = preview.rows
    .filter((r) => (r.action === "neu" || r.action === "korrektur") && r.key)
    .map((r) => ({ key: r.key!, revision: r.revision }));
  const result = await commitWins(db, admin, { text, day, key: randomUUID(), expected });
  return { preview, result };
}
async function counts(participant: string, day: string) {
  const [row] = await db.query("SELECT counts,origin FROM checkins WHERE participant=$1 AND day=$2", [
    participant,
    day,
  ]);
  if (!row) return null;
  return Object.fromEntries(Object.entries(row.counts).filter(([, v]) => v !== null));
}

test("re-pasting is idempotent; an older message never overwrites a newer correction", async () => {
  const alex = await person("Alex B.");
  const d1 = dayOffset(-2);
  const first = wa(d1, "18:00", "Alex B.", "40 Anwahlen, 1 Setting");
  const correction = wa(d1, "20:00", "Alex B.", "50 Anwahlen");
  const a = await importChat([first, correction]);
  assert.equal(a.result.written, 1);
  assert.deepEqual(await counts(alex, d1), { attempts: 50, settingsBooked: 1 });

  const again = await importChat([first, correction]);
  assert.equal(again.result.written, 0);
  assert.equal(again.result.cases, 0);
  assert.deepEqual(
    again.preview.rows.filter((r) => r.key).map((r) => r.action),
    ["unverändert"],
  );

  // Nur die ältere Nachricht erneut eingefügt: der neuere Stand bleibt.
  const older = await importChat([first]);
  assert.equal(older.result.written, 0);
  assert.equal(older.preview.rows[0].action, "unverändert");
  assert.match(older.preview.rows[0].notes.join(" "), /neuere Stand/);
  assert.deepEqual(await counts(alex, d1), { attempts: 50, settingsBooked: 1 });

  // Eine spätere Nachricht gewinnt, ohne dass etwas addiert wird.
  const later = await importChat([wa(d1, "21:30", "Alex B.", "55 Anwahlen")]);
  assert.equal(later.preview.rows[0].action, "korrektur");
  assert.deepEqual(await counts(alex, d1), { attempts: 55, settingsBooked: 1 });

  // Der ganze ältere Verlauf erneut: nichts ändert sich.
  const full = await importChat([first, correction]);
  assert.equal(full.result.written, 0);
  assert.deepEqual(await counts(alex, d1), { attempts: 55, settingsBooked: 1 });
  const [{ n }] = await db.query("SELECT count(*)::int AS n FROM checkin_revisions WHERE participant=$1", [alex]);
  assert.equal(n, 2);
});

test("a later lower value only blocks that metric; the other numbers still count", async () => {
  const alex = await person("Alex B.");
  const d1 = dayOffset(-2);
  const chat = [
    wa(d1, "18:00", "Alex B.", "50 Anwahlen, 2 Settings"),
    wa(d1, "21:00", "Alex B.", "30 Anwahlen, 3 Settings"),
  ];
  const { preview, result } = await importChat(chat);
  assert.deepEqual(
    preview.rows.filter((r) => r.action !== "ersetzt").map((r) => r.action),
    ["neu", "prüffall"],
  );
  const conflict = preview.rows.find((r) => r.action === "prüffall")!;
  assert.match(conflict.reasons.join(" "), /Anwahlen 50 → 30/);
  assert.doesNotMatch(conflict.reasons.join(" "), /attempts/);
  assert.equal(result.cases, 1);
  assert.deepEqual(await counts(alex, d1), { attempts: 50, settingsBooked: 3 });

  const [c] = await reviewCases(db, admin);
  assert.deepEqual(c.values, { attempts: 30 });
  assert.equal(c.applicable, true);
  await resolveReviewCase(db, admin, { id: c.id, decision: "apply" });
  assert.deepEqual(await counts(alex, d1), { attempts: 30, settingsBooked: 3 });

  // Erneut eingefügt: kein neuer Prüffall, nichts ändert sich.
  const again = await importChat(chat);
  assert.equal(again.result.written, 0);
  assert.equal(again.result.cases, 0);
  assert.deepEqual(await counts(alex, d1), { attempts: 30, settingsBooked: 3 });

  // Mit „Korrektur“ gilt der niedrigere Wert sofort.
  await importChat([wa(d1, "22:00", "Alex B.", "Korrektur: 25 Anwahlen")]);
  assert.deepEqual(await counts(alex, d1), { attempts: 25, settingsBooked: 3 });
});

test("claimed profiles get their numbers; an own closing wins and replaces an imported day", async () => {
  const id = randomUUID();
  await db.query(
    `INSERT INTO participants(id,name,owner,email,claimed_at,eligible_since)
     VALUES($1,'Bert Probe',$2,$3,now()-interval '5 days',now()-interval '5 days')`,
    [id, bert.userId, bert.email],
  );
  await db.query("INSERT INTO account_private(owner,email,phone) VALUES($1,$2,'+491700000000')", [
    bert.userId,
    bert.email,
  ]);
  const d1 = dayOffset(-1);
  const d2 = dayOffset(-2);
  const closing = (day: string, expectedRevision: number) => ({
    day,
    expectedRevision,
    idempotencyKey: randomUUID(),
    counts: { attempts: 40, settingsBooked: 1, closingsBooked: 0 },
    reflection: { energy: 7, win: "Gute Gespräche", next: "Früher starten", help: "" },
    acknowledged: true,
  });
  await submitClosing(db, bert, closing(d2, 0));

  const { preview, result } = await importChat([
    wa(d2, "19:00", "Bert Probe", "70 Anwahlen"),
    wa(d1, "19:00", "Bert Probe", "80 Anwahlen, 2 Settings"),
  ]);
  assert.deepEqual(
    preview.rows.map((r) => [r.day, r.action]),
    [
      [d2, "übersprungen"],
      [d1, "neu"],
    ],
  );
  assert.match(preview.rows[0].reasons.join(" "), /eigener Tagesabschluss vorhanden/);
  assert.equal(result.written, 1);
  assert.deepEqual(await counts(id, d2), { attempts: 40, settingsBooked: 1, closingsBooked: 0 });
  assert.deepEqual(await counts(id, d1), { attempts: 80, settingsBooked: 2 });
  // Ein vom Import gefüllter Tag zählt nicht als eigener Abschluss.
  assert.deepEqual(
    toClosings(await ownClosings(db, id)).map((c) => c.day),
    [d2],
  );
  const imported = (await ownClosings(db, id)).find((c) => c.day === d1)!;
  assert.equal(imported.replaceable, true);

  // Der eigene Abschluss ersetzt den importierten Tag, statt blockiert zu werden.
  await submitClosing(db, bert, closing(d1, imported.revision));
  const [row] = await db.query("SELECT counts,origin,reflection FROM checkins WHERE participant=$1 AND day=$2", [
    id,
    d1,
  ]);
  assert.equal(row.origin, "closing");
  assert.equal(row.counts.attempts, 40);
  assert.equal(row.counts.legacyMeetings, null);
  assert.equal(row.reflection.win, "Gute Gespräche");
  assert.deepEqual(
    toClosings(await ownClosings(db, id)).map((c) => c.day).sort(),
    [d2, d1].sort(),
  );
  // Danach lässt der Import den Tag in Ruhe.
  const later = await importChat([wa(d1, "21:00", "Bert Probe", "90 Anwahlen")]);
  assert.equal(later.preview.rows[0].action, "übersprungen");
  assert.equal((await counts(id, d1))!.attempts, 40);
});

test("a morning report without a day becomes a case that applies to the chosen day", async () => {
  const alex = await person("Alex B.");
  const d1 = dayOffset(-2);
  const d2 = dayOffset(-1);
  const chat = [wa(d1, "19:00", "Alex B.", "30 Anwahlen"), wa(d2, "08:10", "Alex B.", "40 Anwahlen")];
  const { preview, result } = await importChat(chat);
  const morning = preview.rows.find((r) => r.action === "prüffall")!;
  assert.deepEqual(morning.review?.days, [d1, d2]);
  assert.match(morning.reasons.join(" "), /Vortag oder heute/);
  assert.equal(result.cases, 1);
  // Nicht still in den Stand eines Tages gemischt.
  assert.deepEqual(await counts(alex, d1), { attempts: 30 });
  assert.equal(await counts(alex, d2), null);

  const [c] = await reviewCases(db, admin);
  assert.equal(c.kind, "day");
  assert.deepEqual(c.days, [d1, d2]);
  assert.deepEqual(c.values, { attempts: 40 });
  await assert.rejects(
    resolveReviewCase(db, admin, { id: c.id, decision: "apply", day: dayOffset(-5) }),
    /Tag/,
  );
  await resolveReviewCase(db, admin, { id: c.id, decision: "apply", day: d1 });
  assert.deepEqual(await counts(alex, d1), { attempts: 40 });
  assert.equal(await counts(alex, d2), null);

  const again = await importChat(chat);
  assert.equal(again.result.written, 0);
  assert.equal(again.result.cases, 0);
  assert.equal(again.preview.rows.find((r) => r.time === "08:10")?.action, "bekannt");
});

test("full chat re-paste: profiles stay, numbers land on the right day, late reports are added", async () => {
  const alex = await person("Alex B.");
  const emil = await person("Emil Test");
  const anna = await person("Anna Beispiel");
  const d1 = dayOffset(-2);
  const d2 = dayOffset(-1);
  const chatA = [
    wa(d1, "18:00", "Alex B.", "35 Anwahlen, 1 Setting"),
    wa(d1, "18:30", "Emil Test", "Zahlen von heute:\nAnwahlen: 60"),
    wa(d1, "19:00", "Anna Beispiel", "20 Anwahlen"),
    wa(d1, "19:30", "+49 170 0000000", "10 Anwahlen"),
    // Plaudern ohne Zahlen: kein Prüffall.
    wa(d1, "19:45", "Anna Beispiel", "Top, weiter so! 💪"),
  ];
  const chatB = [
    wa(d1, "20:30", "Alex B.", "Korrektur: 40 Anwahlen, 1 Setting"),
    // Nach Mitternacht: automatisch der Vortag.
    wa(d2, "00:30", "Emil Test", "70 Anwahlen"),
    // Nachtrag am Morgen mit „gestern“: automatisch der Vortag.
    wa(d2, "08:15", "Anna Beispiel", "Nachtrag gestern: 25 Anwahlen, 1 Setting"),
    // Morgens ohne Tagesangabe: Prüffall, Vortag vorgeschlagen.
    wa(d2, "09:00", "Alex B.", "45 Anwahlen"),
    wa(d2, "18:00", "Alex B.", "gestern hatte ich keine Zeit mehr, heute 50 Anwahlen"),
    wa(d2, "19:00", "Emil Test", "45 Anwahlen, 2 Settings"),
  ];
  const profiles = async () =>
    (await db.query("SELECT id,name FROM participants ORDER BY name")).map((p) => `${p.id}:${p.name}`);
  const before = await profiles();

  const a = await importChat(chatA, d1);
  assert.equal(a.result.written, 3);
  assert.equal(a.result.cases, 1);
  const b = await importChat([...chatA, ...chatB], d2);
  assert.equal(b.result.cases, 1);
  assert.deepEqual(await profiles(), before);

  assert.deepEqual(await counts(alex, d1), { attempts: 40, settingsBooked: 1 });
  assert.deepEqual(await counts(emil, d1), { attempts: 70 });
  assert.deepEqual(await counts(anna, d1), { attempts: 25, settingsBooked: 1 });
  assert.deepEqual(await counts(alex, d2), { attempts: 50 });
  assert.deepEqual(await counts(emil, d2), { attempts: 45, settingsBooked: 2 });
  assert.equal(await counts(anna, d2), null);

  // Der Morgen-Nachtrag wird mit einem Klick für den Vortag übernommen.
  const open = (await reviewCases(db, admin)).filter((c) => c.status === "open");
  assert.equal(open.length, 2);
  const morning = open.find((c) => c.kind === "day")!;
  await resolveReviewCase(db, admin, { id: morning.id, decision: "apply", day: d1 });
  assert.deepEqual(await counts(alex, d1), { attempts: 45, settingsBooked: 1 });

  // Nochmals alles einfügen, auch in anderer Reihenfolge: nichts ändert sich.
  const snapshot = await db.query("SELECT participant,day,counts,revision FROM checkins ORDER BY participant,day");
  for (const lines of [[...chatA, ...chatB], [...chatB, ...chatA], chatA]) {
    const r = await importChat(lines, d2);
    assert.equal(r.result.written, 0);
    assert.equal(r.result.cases, 0);
  }
  assert.deepEqual(
    await db.query("SELECT participant,day,counts,revision FROM checkins ORDER BY participant,day"),
    snapshot,
  );
  assert.deepEqual(await profiles(), before);
  assert.equal((await db.query("SELECT id FROM import_review_cases")).length, 2);
});

test("phone number senders are masked in review cases; the alias is kept without the number", async () => {
  const alex = await person("Alex B.");
  const d1 = dayOffset(-2);
  const sender = "+49 170 0000000";
  await importChat([wa(d1, "19:30", sender, "10 Anwahlen")]);
  const [c] = await reviewCases(db, admin);
  assert.doesNotMatch(c.name_seen, /0000000|170 0/);
  assert.match(c.name_seen, /^\+49 /);
  assert.equal(c.aliasable, true);
  await resolveReviewCase(db, admin, { id: c.id, decision: "alias", participantId: alex });
  assert.deepEqual(await counts(alex, d1), { attempts: 10 });
  // Nirgends steht die volle Nummer.
  const stored = JSON.stringify([
    await db.query("SELECT * FROM import_review_cases"),
    await db.query("SELECT * FROM participant_aliases"),
  ]);
  assert.doesNotMatch(stored, /1700000000|170 0000000/);
  // Die nächste Meldung von derselben Nummer landet auf demselben Profil.
  const next = await importChat([wa(d1, "21:00", sender, "20 Anwahlen")]);
  assert.equal(next.preview.rows[0].participantId, alex);
  assert.equal(next.preview.rows[0].action, "korrektur");
  assert.doesNotMatch(next.preview.rows[0].author, /0000000/);
  assert.deepEqual(await counts(alex, d1), { attempts: 20 });
});

test("duplicate display names: the alias decides, every time", async () => {
  const first = await person("Alex B.");
  const second = await person("Alex B.");
  const d1 = dayOffset(-2);
  await importChat([wa(d1, "19:00", "Alex B.", "40 Anwahlen")]);
  const [c] = await reviewCases(db, admin);
  assert.match(c.reason, /mehreren Profilen/);
  await resolveReviewCase(db, admin, { id: c.id, decision: "alias", participantId: second });
  assert.equal(await counts(first, d1), null);
  assert.deepEqual(await counts(second, d1), { attempts: 40 });
  const next = await importChat([wa(d1, "21:00", "Alex B.", "45 Anwahlen")]);
  assert.equal(next.preview.rows[0].participantId, second);
  assert.deepEqual(await counts(second, d1), { attempts: 45 });
  assert.equal(await counts(first, d1), null);
});

test("a dismissed conflict stays dismissed; a genuinely new conflict creates a new case", async () => {
  const alex = await person("Alex B.");
  const d1 = dayOffset(-2);
  const chat = [
    wa(d1, "18:00", "Alex B.", "50 Anwahlen"),
    wa(d1, "21:00", "Alex B.", "30 Anwahlen"),
    wa(d1, "21:05", "Anna Beispiel", "Top, weiter so!"),
  ];
  const first = await importChat(chat);
  assert.equal(first.result.cases, 1);
  assert.equal(first.preview.rows.find((r) => r.author === "Anna Beispiel")?.action, "ignoriert");
  const [c] = await reviewCases(db, admin);
  await resolveReviewCase(db, admin, { id: c.id, decision: "dismiss" });
  const again = await importChat(chat);
  assert.equal(again.result.cases, 0);
  assert.equal(again.preview.rows.find((r) => r.review?.kind === "value")?.action, "bekannt");
  assert.deepEqual(await counts(alex, d1), { attempts: 50 });
  const newer = await importChat([...chat, wa(d1, "22:00", "Alex B.", "25 Anwahlen")]);
  assert.equal(newer.result.cases, 1);
  const open = (await reviewCases(db, admin)).filter((x) => x.status === "open");
  assert.deepEqual(open.map((x) => [x.from, x.values]), [[{ attempts: 50 }, { attempts: 25 }]]);
});

// ---------------------------------------------------------------------------
// Neues Profil aus einem Prüffall („create“)

async function openCases() {
  return (await reviewCases(db, admin)).filter((c) => c.status === "open");
}
async function profileCount() {
  const [{ n }] = await db.query("SELECT count(*)::int AS n FROM participants");
  return n as number;
}

test("the suggested name drops ~, emojis and decorative symbols; masked numbers give none", () => {
  assert.equal(cleanDisplayName("~ Max Müller 🚀"), "Max Müller");
  assert.equal(cleanDisplayName("✨ Lisa ✨"), "Lisa");
  assert.equal(cleanDisplayName("~Anna   B."), "Anna B.");
  assert.equal(cleanDisplayName("𝐌𝐚𝐱 ❤️"), "Max");
  assert.equal(cleanDisplayName("👨‍👩‍👧 Familie Groß 🇩🇪"), "Familie Groß");
  assert.equal(cleanDisplayName("Jean-Luc O’Neil"), "Jean-Luc O’Neil");
  assert.equal(cleanDisplayName("+49 ••• •••••00"), "");
});

test("an unknown sender becomes a new profile with alias and values, even with 0 Anwahlen", async () => {
  const d1 = dayOffset(-2);
  const d2 = dayOffset(-1);
  await importChat([wa(d1, "19:00", "~ Max Neu 🚀", "0 Anwahlen, 1 Setting")]);
  const [c] = await openCases();
  assert.equal(c.kind, "person");
  assert.match(c.reason, /keinem Profil zugeordnet/);
  assert.equal(c.aliasable, true);
  assert.equal(c.suggestedName, "Max Neu");
  assert.equal(await profileCount(), 0);

  const result = await resolveReviewCase(db, admin, { id: c.id, decision: "create", name: c.suggestedName });
  assert.equal(result.written, true);
  assert.equal(
    result.message,
    `Profil „Max Neu“ angelegt. Übernommen für ${d1.slice(8, 10)}.${d1.slice(5, 7)}.: Anwahlen 0, Settings vereinbart 1.`,
  );
  const profiles = await db.query("SELECT id,import_key,name,kind,public_consent,searchable,owner FROM participants");
  assert.equal(profiles.length, 1);
  const [p] = profiles;
  assert.equal(result.participantId, p.id);
  assert.deepEqual(
    { key: p.import_key, name: p.name, kind: p.kind, consent: p.public_consent, searchable: p.searchable, owner: p.owner },
    { key: "wins-max-neu", name: "Max Neu", kind: "person", consent: true, searchable: true, owner: null },
  );
  assert.deepEqual(
    (await db.query("SELECT alias,participant FROM participant_aliases")).map((a) => [a.alias, a.participant]),
    [["max neu", p.id]],
  );
  assert.deepEqual(await counts(p.id, d1), { attempts: 0, settingsBooked: 1 });
  const [day] = await db.query("SELECT origin,source FROM checkins WHERE participant=$1", [p.id]);
  assert.deepEqual([day.origin, day.source], ["import", "wins-import"]);
  assert.equal((await db.query("SELECT 1 FROM sync_outbox WHERE participant=$1", [p.id])).length, 1);
  assert.deepEqual(await openCases(), []);

  // Der nächste Import desselben Absenders landet ohne Prüffall im neuen Profil.
  const next = await importChat([
    wa(d1, "19:00", "~ Max Neu 🚀", "0 Anwahlen, 1 Setting"),
    wa(d1, "21:00", "~ Max Neu 🚀", "35 Anwahlen, 1 Setting"),
    wa(d2, "19:00", "Max Neu", "20 Anwahlen"),
  ]);
  assert.deepEqual(
    next.preview.rows.filter((r) => r.key).map((r) => [r.participantId, r.day, r.action]),
    [
      [p.id, d1, "korrektur"],
      [p.id, d2, "neu"],
    ],
  );
  assert.equal(next.result.cases, 0);
  assert.deepEqual(await counts(p.id, d1), { attempts: 35, settingsBooked: 1 });
  assert.deepEqual(await counts(p.id, d2), { attempts: 20 });
  assert.equal(await profileCount(), 1);
});

test("create is refused for an existing name, a taken alias, a case without a name and an empty name", async () => {
  const anna = await person("Anna Beispiel");
  const alex = await person("Alex B.");
  const d1 = dayOffset(-2);
  await importChat([
    wa(d1, "18:00", "Anna B", "30 Anwahlen"),
    wa(d1, "19:00", "Anna B", "35 Anwahlen, 1 Closing"),
    wa(d1, "20:00", "Alex B.", "50 Anwahlen"),
    wa(d1, "21:00", "Alex B.", "30 Anwahlen"),
  ]);
  const cases = await openCases();
  const [first, second] = cases.filter((c) => c.name_seen === "Anna B").sort((a, b) => a.excerpt.localeCompare(b.excerpt));
  const conflict = cases.find((c) => c.kind === "value")!;
  assert.equal(conflict.aliasable, false);
  const before = await profileCount();

  // Gleicher Name, auch anders geschrieben: zuordnen statt ein zweites Profil.
  for (const name of ["Anna Beispiel", "anna  beispiel 🙂", "ANNA-BEISPIEL"])
    await assert.rejects(resolveReviewCase(db, admin, { id: first.id, decision: "create", name }), {
      status: 409,
      message: /Es gibt schon ein Profil „Anna Beispiel“/,
    });
  // Ohne Buchstaben (nur Emojis) oder zu kurz: kein Profil.
  for (const name of ["🚀🚀", "A", ""])
    await assert.rejects(resolveReviewCase(db, admin, { id: first.id, decision: "create", name }), /mindestens zwei Zeichen/);
  await assert.rejects(resolveReviewCase(db, admin, { id: first.id, decision: "create" }), /Namen für das neue Profil/);
  // Ein Prüffall ohne gemeldeten Namen (späterer niedrigerer Wert).
  await assert.rejects(resolveReviewCase(db, admin, { id: conflict.id, decision: "create", name: "Alex Neu" }), {
    status: 409,
    message: /keinen Namen zum Zuordnen/,
  });

  // Der Name ist inzwischen einem Profil zugeordnet: kein zweites Profil dafür.
  await resolveReviewCase(db, admin, { id: first.id, decision: "alias", participantId: anna });
  await assert.rejects(resolveReviewCase(db, admin, { id: second.id, decision: "create", name: "Anna B." }), {
    status: 409,
    message: /bereits dem Profil „Anna Beispiel“ zugeordnet/,
  });

  assert.equal(await profileCount(), before);
  assert.deepEqual(
    (await openCases()).map((c) => c.id).sort(),
    [second.id, conflict.id].sort(),
  );
  assert.equal(await counts(alex, d1).then((c) => c?.attempts), 50);
});

test("a taken import key gets a suffix; a phone sender needs a typed name and maps later", async () => {
  await db.query("INSERT INTO participants(id,import_key,name) VALUES($1,'wins-jorg-gross','Jemand Anderes')", [
    randomUUID(),
  ]);
  const d1 = dayOffset(-2);
  const phone = "+49 170 0000000";
  await importChat([
    wa(d1, "19:00", "Jörg Groß", "12 Anwahlen"),
    wa(d1, "19:10", "Jorg Gross", "3 Settings"),
    wa(d1, "19:20", phone, "1 Closing"),
  ]);
  const cases = await openCases();
  const byName = (n: string) => cases.find((c) => c.name_seen === n)!;
  const one = await resolveReviewCase(db, admin, { id: byName("Jörg Groß").id, decision: "create", name: "Jörg Groß" });
  const two = await resolveReviewCase(db, admin, { id: byName("Jorg Gross").id, decision: "create", name: "Jorg Gross" });
  const keys = async (id: unknown) =>
    (await db.query("SELECT import_key FROM participants WHERE id=$1", [id]))[0].import_key;
  assert.equal(await keys(one.participantId), "wins-jorg-gross-2");
  assert.equal(await keys(two.participantId), "wins-jorg-gross-3");

  const masked = cases.find((c) => c.name_seen.startsWith("+49"))!;
  assert.equal(masked.suggestedName, "");
  await assert.rejects(resolveReviewCase(db, admin, { id: masked.id, decision: "create", name: masked.suggestedName }));
  const lea = await resolveReviewCase(db, admin, { id: masked.id, decision: "create", name: "Lea Beispiel" });
  assert.equal(await keys(lea.participantId), "wins-lea-beispiel");
  assert.deepEqual(await counts(lea.participantId as string, d1), { closingsBooked: 1 });
  const stored = JSON.stringify(await db.query("SELECT * FROM participant_aliases"));
  assert.doesNotMatch(stored, /1700000000|170 0000000/);
  const next = await importChat([wa(d1, "21:00", phone, "2 Closings")]);
  assert.equal(next.preview.rows[0].participantId, lea.participantId);
  assert.deepEqual(await counts(lea.participantId as string, d1), { closingsBooked: 2 });
});

test("creating a profile also takes over other open reports that only lacked the person", async () => {
  const d1 = dayOffset(-3);
  const d2 = dayOffset(-2);
  const d3 = dayOffset(-1);
  await importChat([
    wa(d1, "19:00", "Kim Neu", "40 Anwahlen"),
    wa(d2, "19:00", "Kim Neu", "Closing gelegt: 1"),
    // Morgens ohne Tagesangabe: bleibt ein Prüffall mit Tageswahl.
    wa(d3, "08:10", "Kim Neu", "30 Anwahlen"),
  ]);
  const cases = await openCases();
  assert.equal(cases.length, 3);
  const first = cases.find((c) => c.day === d1)!;
  const result = await resolveReviewCase(db, admin, { id: first.id, decision: "create", name: "Kim Neu" });
  const id = result.participantId as string;
  assert.match(result.message!, /^Profil „Kim Neu“ angelegt\. Übernommen für /);
  assert.match(result.message!, new RegExp(`Weitere Meldungen übernommen: ${d2.slice(8, 10)}\\.${d2.slice(5, 7)}\\.`));
  assert.match(result.message!, /Ein weiterer Prüffall mit diesem Namen ist noch offen\./);
  assert.deepEqual(await counts(id, d1), { attempts: 40 });
  assert.deepEqual(await counts(id, d2), { closingsBooked: 1 });
  assert.equal(await counts(id, d3), null);
  const [left] = await openCases();
  assert.equal(left.kind, "person");
  assert.deepEqual(left.days, [d2, d3]);
  // Der verbleibende Prüffall lässt sich dem neuen Profil zuordnen.
  await resolveReviewCase(db, admin, { id: left.id, decision: "alias", participantId: id, day: d3 });
  assert.deepEqual(await counts(id, d3), { attempts: 30 });
  assert.equal(await profileCount(), 1);
});
