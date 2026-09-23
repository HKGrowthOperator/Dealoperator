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

test("review cases: unknown, ambiguous, joint, increment; chatter without numbers is ignored", () => {
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
  assert.ok(entries.slice(0, 4).every((e) => e.status === "review"));
  assert.match(entries[0].reasons.join(), /keinem Profil/);
  assert.match(entries[1].reasons.join(), /mehreren Profilen/);
  assert.match(entries[2].reasons.join(), /gemeinsame Meldung/);
  assert.match(entries[3].reasons.join(), /Zuwachs/);
  // Plaudern ohne Zahlen ist kein Prüffall.
  assert.equal(entries[4].status, "ignored");
  assert.deepEqual(entries[4].reasons, []);
  assert.match(entries[4].notes.join(" "), /Keine Kennzahl/);
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

test("the latest value per metric wins across messages; a later lower value is a review case for that metric only", () => {
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
  // Nur die betroffene Kennzahl wird geprüft; bis dahin bleibt der höhere Wert.
  const last = lowered.at(-1)!;
  assert.equal(last.status, "ok");
  assert.equal(last.metrics.attempts, 50);
  assert.deepEqual(
    last.conflicts.map((c) => [c.metric, c.from, c.to]),
    [["attempts", 50, 30]],
  );
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

// ---------------------------------------------------------------------------
// WhatsApp-Gruppe: Formate, Leistungstag, Nachträge. Alles fiktiv.

const group: DirectoryEntry[] = [
  ...directory,
  { id: "p-alex", name: "Alex B.", kind: "person" },
];
const parse = (lines: string[], defaultDay = "2026-09-23") =>
  parseWins({ text: lines.join("\n"), defaultDay, directory: group, today: defaultDay });

test("WhatsApp Web/Desktop copies, iOS and Android exports parse, incl. multi-line and phone senders", () => {
  const entries = parse([
    "[19:05, 23.9.2026] Alex B.: Zahlen von heute:",
    "Anwahlen: 40",
    "Tag 3: läuft",
    "18:30 war ich fertig",
    "Settings: 2",
    "[19:07, 23.09.26] ‪+49 170 0000000‬: 55 Calls",
    "[23.09.26, 19:08:12] Emil Test: 60 Anwahlen",
    "‎23.09.26, 19:09 - Anna Beispiel: 70 Anwahlen",
    "23.09.2026, 19:10 - ~ Ben Muster: 80 Anwahlen",
    "23.09.26, 19:11 - Anna Beispiel hat die Gruppe verlassen",
    "[07:15 PM, 23.9.2026] Emil Test: 65 Anwahlen",
  ]);
  assert.deepEqual(
    entries.map((e) => [e.author, e.messageDay, e.time]),
    [
      ["Alex B.", "2026-09-23", "19:05"],
      ["+49 170 0000000", "2026-09-23", "19:07"],
      ["Emil Test", "2026-09-23", "19:08"],
      ["Anna Beispiel", "2026-09-23", "19:09"],
      ["Ben Muster", "2026-09-23", "19:10"],
      ["Emil Test", "2026-09-23", "19:15"],
    ],
  );
  const alex = entries[0];
  assert.equal(alex.status, "ok");
  assert.deepEqual(alex.metrics, { attempts: 40, settingsBooked: 2 });
  // Die Systemzeile hängt nichts an Annas Meldung an.
  assert.deepEqual(entries[3].metrics, { attempts: 70 });
  assert.equal(entries[1].status, "review");
  assert.match(entries[1].reasons.join(" "), /keinem Profil/);
});

test("a day separator word inside a WhatsApp message stays part of the message", () => {
  const [e] = parse(["[08:10, 24.9.2026] Alex B.: Nachtrag", "Gestern", "40 Anwahlen"], "2026-09-24");
  assert.equal(e.day, "2026-09-23");
  assert.equal(e.status, "ok");
  assert.deepEqual(e.metrics, { attempts: 40 });
});

test("'gestern' in prose does not move the numbers; only leading or fixed phrases do", () => {
  const at = (text: string, time = "19:00") =>
    parse([`[${time}, 23.9.2026] Alex B.: ${text}`])[0];
  const today = "2026-09-23";
  const yesterday = "2026-09-22";
  assert.equal(at("gestern hatte ich keine Zeit, heute 40 Calls").day, today);
  assert.equal(at("gestern hatte ich keine Zeit, heute 40 Calls").status, "ok");
  assert.equal(at("Heute 40 Calls, gestern hatte ich frei").day, today);
  assert.equal(at("40 Calls, mehr als gestern").day, today);
  assert.equal(at("40 Calls mehr als gestern").day, today);
  assert.equal(at("Setting für den 25.9. gelegt, 40 Calls").day, today);
  for (const text of [
    "Gestern: 40 Calls",
    "Gestern 40 Calls",
    "gestern - 40 Calls",
    "Nachtrag gestern 40 Calls",
    "Nachtrag von gestern: 40 Calls",
    "Zahlen von gestern: 40 Calls",
    "Zahlen für gestern 40 Calls",
    "Kurzer Nachtrag für gestern: 40 Calls",
    "22.9.: 40 Calls",
    "22.09. 40 Calls",
    "Nachtrag 22.9.: 40 Calls",
    "Nachtrag vom 22.09.2026: 40 Calls",
  ]) {
    const e = at(text);
    assert.equal(e.day, yesterday, text);
    assert.equal(e.status, "ok", text);
  }
});

test("conflicting day assignments in one message become a review case, never a guess", () => {
  const at = (text: string) => parse([`[19:00, 23.9.2026] Alex B.: ${text}`])[0];
  for (const text of [
    "Gestern: 40 Calls, heute: 20 Calls",
    "Nachtrag von gestern 40 Calls. Heute 20 Calls",
    "22.9.: 40 Calls, heute 20 Calls",
    "hab gestern 40 Calls gemacht, heute 20",
  ]) {
    const e = at(text);
    assert.equal(e.status, "review", text);
    assert.equal(e.applicable, false, text);
    assert.match(e.reasons.join(" "), /mehrere Tage/i, text);
  }
});

test("'gestern' next to numbers in prose asks: previous day or today?", () => {
  const [e] = parse(["[19:00, 23.9.2026] Alex B.: Hab gestern 40 Calls gemacht"]);
  assert.equal(e.status, "review");
  assert.equal(e.review, "day");
  assert.deepEqual(e.days, ["2026-09-22", "2026-09-23"]);
  assert.equal(e.day, "2026-09-22");
  assert.equal(e.applicable, true);
  assert.match(e.reasons.join(" "), /Vortag oder heute/);
});

test("after midnight up to the day cutoff counts for the previous day automatically", () => {
  const entries = parse(
    [
      "[00:40, 24.9.2026] Alex B.: 55 Anwahlen",
      "[03:30, 24.9.2026] Emil Test: Heute 40 Calls",
      "[05:59, 24.9.2026] Anna Beispiel: Gestern 30 Calls",
    ],
    "2026-09-24",
  );
  assert.deepEqual(
    entries.map((e) => [e.day, e.status]),
    [
      ["2026-09-23", "ok"],
      ["2026-09-23", "ok"],
      ["2026-09-23", "ok"],
    ],
  );
  assert.match(entries[0].notes.join(" "), /Vortag/);
});

test("morning reports and 'Nachtrag' without a day are review cases with the previous day suggested", () => {
  const entries = parse(
    [
      "[20:00, 23.9.2026] Alex B.: 30 Anwahlen",
      "[08:10, 24.9.2026] Alex B.: 40 Anwahlen",
      "[09:00, 24.9.2026] Emil Test: heute schon 20 Calls",
      "[09:30, 24.9.2026] Anna Beispiel: Gestern: 35 Calls",
      "[11:59, 24.9.2026] Ben Muster: Nachtrag 2 Settings",
      "[19:00, 24.9.2026] Ben Muster: Nachtrag: 50 Anwahlen",
      "[19:30, 24.9.2026] Alex B.: 50 Anwahlen",
      "[13:00, 24.9.2026] Emil Test: 45 Anwahlen",
    ],
    "2026-09-24",
  );
  const [alexEvening, alexMorning, emilMorning, annaMorning, benMorning, benNachtrag, alexToday, emilNoon] = entries;
  assert.deepEqual([alexEvening.day, alexEvening.status], ["2026-09-23", "ok"]);
  for (const e of [alexMorning, benMorning, benNachtrag]) {
    assert.equal(e.status, "review", e.excerpt);
    assert.equal(e.review, "day", e.excerpt);
    assert.equal(e.day, "2026-09-23", e.excerpt);
    assert.deepEqual(e.days, ["2026-09-23", "2026-09-24"], e.excerpt);
    assert.match(e.reasons.join(" "), /Vortag oder heute/, e.excerpt);
  }
  assert.deepEqual([emilMorning.day, emilMorning.status], ["2026-09-24", "superseded"]);
  assert.deepEqual([annaMorning.day, annaMorning.status], ["2026-09-23", "ok"]);
  // Die Morgenmeldung fließt nicht in den heutigen Stand ein.
  assert.deepEqual([alexToday.day, alexToday.status, alexToday.metrics], ["2026-09-24", "ok", { attempts: 50 }]);
  assert.ok(alexToday.observations.every((o) => o.stamp !== "2026-09-24 08:10"));
  assert.deepEqual([emilNoon.day, emilNoon.status, emilNoon.metrics.attempts], ["2026-09-24", "ok", 45]);
});

test("chatter is ignored; unclear halves still become a review case", () => {
  const entries = parse([
    "[19:00, 23.9.2026] Anna Beispiel: Top, weiter so! 💪",
    "[19:01, 23.9.2026] Emil Test: <Medien ausgeschlossen>",
    "[19:02, 23.9.2026] Ben Muster: ½ Termin",
  ]);
  assert.deepEqual(
    entries.map((e) => e.status),
    ["ignored", "ignored", "review"],
  );
});

test("an explicit alias beats duplicate display names", () => {
  const twins: DirectoryEntry[] = [
    { id: "p-alex-1", name: "Alex B.", kind: "person" },
    { id: "p-alex-2", name: "Alex B.", kind: "person", aliases: ["alex b"] },
  ];
  assert.deepEqual(resolveAuthor("Alex B.", twins).map((d) => d.id), ["p-alex-2"]);
  const [e] = parseWins({
    text: "[19:00, 23.9.2026] Alex B.: 40 Anwahlen",
    defaultDay: "2026-09-23",
    directory: twins,
  });
  assert.equal(e.status, "ok");
  assert.equal(e.participantId, "p-alex-2");
  // Ohne Alias bleibt es mehrdeutig.
  const [open] = parseWins({
    text: "[19:00, 23.9.2026] Alex B.: 40 Anwahlen",
    defaultDay: "2026-09-23",
    directory: twins.map((t) => ({ ...t, aliases: [] })),
  });
  assert.equal(open.status, "review");
  assert.match(open.reasons.join(" "), /mehreren Profilen/);
});

test("a phone number sender matches its alias key, never its plain number", () => {
  const withKey: DirectoryEntry[] = [
    { id: "p-alex", name: "Alex B.", kind: "person", aliases: ["tel:schluessel"] },
  ];
  const [e] = parseWins({
    text: "[19:00, 23.9.2026] +49 170 0000000: 40 Anwahlen",
    defaultDay: "2026-09-23",
    directory: withKey,
    aliasKeyOf: (author) => (/^\+49 170/.test(author) ? "tel:schluessel" : null),
  });
  assert.equal(e.status, "ok");
  assert.equal(e.participantId, "p-alex");
});
