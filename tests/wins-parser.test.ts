import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWins,
  readMetrics,
  resolveAuthor,
  splitMessages,
  type DirectoryEntry,
} from "../lib/wins-parser";

// Fiktive Namen. Echte Chatinhalte gehören nicht ins Repository.
const directory: DirectoryEntry[] = [
  { id: "p-anna", name: "Anna Beispiel", kind: "person" },
  { id: "p-ben", name: "Ben Muster", kind: "person", aliases: ["Benni"] },
  { id: "p-ben2", name: "Ben Probe", kind: "person" },
  { id: "p-duo", name: "Clara & Dora", kind: "joint" },
  { id: "p-emil", name: "Emil Test", kind: "person" },
];

test("reads the common chat export formats and multi-line messages", () => {
  const text = [
    "22.09.26, 18:56 - Anna Beispiel: 20 Anwahlen, 4 erreicht",
    "und 2 Settings vereinbart",
    "[22.09.26, 19:01:12] Emil Test: Calls: 150",
    "Benni  6:56 PM",
    "88 Anwahlen, 1 Closing",
    "Emil Test: 3 Termine",
  ].join("\n");
  const messages = splitMessages(text, "2026-09-22");
  assert.deepEqual(
    messages.map((m) => [m.author, m.messageDay, m.time]),
    [
      ["Anna Beispiel", "2026-09-22", "18:56"],
      ["Emil Test", "2026-09-22", "19:01"],
      ["Benni", "2026-09-22", "18:56"],
      ["Emil Test", "2026-09-22", null],
    ],
  );
  assert.match(messages[0].text, /2 Settings vereinbart/);
});

test("metric words map to the defined metrics; untyped appointments never become settings", () => {
  assert.deepEqual(readMetrics("222 Anwahlen, 5 Termine gelegt").metrics, {
    attempts: 222,
    legacyMeetings: 5,
  });
  assert.deepEqual(readMetrics("150 Calls und 1 Setter gelegt").metrics, {
    attempts: 150,
    settingsBooked: 1,
  });
  assert.deepEqual(
    readMetrics("2 Settings gehalten, 3 Settings vereinbart").metrics,
    { settingsHeld: 2, settingsBooked: 3 },
  );
  assert.deepEqual(readMetrics("Anwahlen: 40, Closings: 2, 1 Deal gewonnen").metrics, {
    attempts: 40,
    closingsBooked: 2,
    dealsWon: 1,
  });
  assert.deepEqual(readMetrics("zwei Closing-Termine, einen Setting-Termin").metrics, {
    closingsBooked: 2,
    settingsBooked: 1,
  });
  // „erreicht" und „Follow-ups" sind keine definierten Kennzahlen.
  assert.deepEqual(readMetrics("4 erreicht, 4 Follow-ups").metrics, {});
});

test("incremental phrasing and contradictions are flagged, never guessed", () => {
  assert.equal(readMetrics("noch ein Setting").increment, true);
  assert.equal(readMetrics("2. Termin gelegt").increment, true);
  assert.equal(readMetrics("+1 Setting").increment, true);
  assert.equal(readMetrics("3 Settings vereinbart").increment, false);
  assert.deepEqual(
    readMetrics("20 Anwahlen … eigentlich 25 Anwahlen").conflicts,
    ["attempts"],
  );
});

test("author resolution: exact name, alias, unique first name; ambiguity stays open", () => {
  assert.deepEqual(
    resolveAuthor("anna beispiel", directory).map((d) => d.id),
    ["p-anna"],
  );
  assert.deepEqual(resolveAuthor("Benni", directory).map((d) => d.id), ["p-ben"]);
  assert.deepEqual(resolveAuthor("Emil", directory).map((d) => d.id), ["p-emil"]);
  assert.deepEqual(
    resolveAuthor("Ben", directory).map((d) => d.id).sort(),
    ["p-ben", "p-ben2"],
  );
  assert.deepEqual(resolveAuthor("Unbekannt", directory), []);
});

test("the latest message per person and day wins; earlier interim states are not added", () => {
  const entries = parseWins({
    text: [
      "22.09.26, 13:34 - Emil Test: 150 Calls",
      "22.09.26, 18:01 - Emil Test: 300 Anwahlen und 2 Settings",
      "22.09.26, 15:00 - Anna Beispiel: 40 Anwahlen",
    ].join("\n"),
    defaultDay: "2026-09-22",
    directory,
  });
  const emil = entries.filter((e) => e.participantId === "p-emil");
  assert.deepEqual(
    emil.map((e) => [e.time, e.status, e.metrics.attempts]),
    [
      ["13:34", "superseded", 150],
      ["18:01", "ok", 300],
    ],
  );
  assert.match(emil[0].notes.join(" "), /nicht addiert/);
  assert.equal(entries.find((e) => e.participantId === "p-anna")?.status, "ok");
});

test("review cases: unknown, ambiguous, joint, increment, no metric", () => {
  const entries = parseWins({
    text: [
      "22.09.26, 10:00 - Niemand Bekannt: 10 Anwahlen",
      "22.09.26, 10:01 - Ben: 10 Anwahlen",
      "22.09.26, 10:02 - Clara & Dora: 222 Anwahlen",
      "22.09.26, 10:03 - Anna Beispiel: noch ein Setting",
      "22.09.26, 10:04 - Emil Test: Guten Morgen zusammen",
    ].join("\n"),
    defaultDay: "2026-09-22",
    directory,
  });
  assert.ok(entries.every((e) => e.status === "review"));
  assert.match(entries[0].reasons.join(), /keinem Profil/);
  assert.match(entries[1].reasons.join(), /mehreren Profilen/);
  assert.match(entries[2].reasons.join(), /gemeinsame Meldung/);
  assert.match(entries[3].reasons.join(), /Zuwachs/);
  assert.match(entries[4].reasons.join(), /Keine Kennzahl/);
});

test("performance day: a message after midnight belongs to the previous day", () => {
  const [entry] = parseWins({
    text: "23.09.26, 00:40 - Anna Beispiel: 55 Anwahlen",
    defaultDay: "2026-09-23",
    directory,
  });
  assert.equal(entry.day, "2026-09-22");
  assert.match(entry.notes.join(), /Vortag/);
});

test("halves, decimals and hedged numbers are never read as firm values", () => {
  const r = readMetrics("1,5 Settings und ca. 200 Anwahlen");
  assert.equal(r.uncertain, true);
  assert.equal(r.metrics.settingsBooked, undefined);
  assert.equal(readMetrics("½ Termin").uncertain, true);
  assert.equal(readMetrics("vielleicht 2 Closings").uncertain, true);
  assert.equal(readMetrics("3 Settings vereinbart").uncertain, false);
  const entries = parseWins({
    text: "22.09.26, 18:00 - Anna Beispiel: 0,5 Settings, 40 Anwahlen",
    defaultDay: "2026-09-22",
    directory,
  });
  assert.equal(entries[0].status, "review");
});

test("a first name alone is only a suggestion and needs confirmation", () => {
  const [e] = parseWins({
    text: "22.09.26, 18:00 - Emil: 40 Anwahlen",
    defaultDay: "2026-09-22",
    directory,
  });
  assert.equal(e.status, "review");
  assert.equal(e.participantId, "p-emil");
  assert.match(e.reasons.join(" "), /Vorschlag: Emil Test/);
});

test("zoom chat lines and day separators set author and day", () => {
  const text = [
    "Montag, 21. September",
    "18:10:05 Von Anna Beispiel an Alle: 30 Anwahlen",
    "22.09.2026",
    "19:20:00\tEmil Test:\t120 Anwahlen, 2 Settings",
    "20:00:00 Unbekanntes Format mit 5 Settings",
  ].join("\n");
  const messages = splitMessages(text, "2026-09-22");
  assert.deepEqual(
    messages.map((m) => [m.author, m.messageDay, m.time]),
    [
      ["Anna Beispiel", "2026-09-21", "18:10"],
      ["Emil Test", "2026-09-22", "19:20"],
      ["", "2026-09-22", null],
    ],
  );
  const entries = parseWins({ text, defaultDay: "2026-09-22", directory });
  assert.equal(entries[2].status, "review");
  assert.match(entries[2].reasons.join(" "), /ohne erkennbaren Absender/);
});

test("explicit day references win; a weekday mid-sentence does not", () => {
  const entries = parseWins({
    text: [
      "23.09.26, 08:30 - Anna Beispiel: gestern 150 Anwahlen",
      "23.09.26, 18:00 - Emil Test: 2 Settings für Freitag gelegt, 90 Anwahlen",
      "28.09.26, 07:45 - Ben Muster: Fr: 60 Anwahlen",
    ].join("\n"),
    defaultDay: "2026-09-23",
    directory,
  });
  assert.deepEqual(
    entries.map((e) => [e.participantId, e.day]),
    [
      ["p-anna", "2026-09-22"],
      ["p-emil", "2026-09-23"],
      ["p-ben", "2026-09-25"],
    ],
  );
});

test("the latest value per metric wins across messages; a later lower value is a review case", () => {
  const merged = parseWins({
    text: [
      "22.09.26, 18:00 - Anna Beispiel: 50 Anwahlen, 2 Settings",
      "22.09.26, 21:00 - Anna Beispiel: 80 Anwahlen",
    ].join("\n"),
    defaultDay: "2026-09-22",
    directory,
  });
  const final = merged.find((e) => e.status === "ok")!;
  assert.deepEqual(final.metrics, { attempts: 80, settingsBooked: 2 });
  // Eine Meldung um 00:40 gehört zum Vortag und ist trotzdem die späteste.
  const lateNight = parseWins({
    text: [
      "22.09.26, 21:10 - Emil Test: 100 Anwahlen",
      "23.09.26, 00:40 - Emil Test: 140 Anwahlen",
    ].join("\n"),
    defaultDay: "2026-09-22",
    directory,
  });
  assert.equal(lateNight.find((e) => e.status === "ok")!.metrics.attempts, 140);
  const lowered = parseWins({
    text: [
      "22.09.26, 18:00 - Anna Beispiel: 50 Anwahlen",
      "22.09.26, 21:00 - Anna Beispiel: 30 Anwahlen",
    ].join("\n"),
    defaultDay: "2026-09-22",
    directory,
  });
  assert.equal(lowered.at(-1)!.status, "review");
});

test("thousand separators are whole numbers, not decimals", () => {
  const r = readMetrics("1.200 Anwahlen und 3 Settings");
  assert.equal(r.uncertain, false);
  assert.deepEqual(r.metrics, { attempts: 1200, settingsBooked: 3 });
  assert.equal(readMetrics("1.5 Settings").uncertain, true);
});

test("each line is read on its own: 'Anwahlen 120' above 'Settings 2' stays apart", () => {
  assert.deepEqual(readMetrics("Anwahlen 120\nSettings 2").metrics, { attempts: 120, settingsBooked: 2 });
  assert.deepEqual(readMetrics("Calls 80 Closings 1").metrics, { attempts: 80, closingsBooked: 1 });
  assert.deepEqual(readMetrics("Anwahlen - 120\nSettings - 2").metrics, { attempts: 120, settingsBooked: 2 });
  assert.deepEqual(readMetrics("120 Anwahlen 2 Settings").metrics, { attempts: 120, settingsBooked: 2 });
});

test("metric lines under a message are continuation lines, not new authors", () => {
  const entries = parseWins({
    text: ["Emil Test  18:56", "Anwahlen: 120", "Settings: 2"].join("\n"),
    defaultDay: "2026-09-22",
    directory,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].participantId, "p-emil");
  assert.deepEqual(entries[0].metrics, { attempts: 120, settingsBooked: 2 });
  assert.equal(entries[0].status, "ok");
});
