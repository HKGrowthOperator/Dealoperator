import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addDays,
  deadlineFor,
  defaultCommitmentSettings as S,
  isoWeekday,
  summarize,
  zonedTime,
  type Closing,
} from "../lib/commitment";
import { aggregate, emptyCounts, progress, scoreOf, type Counts } from "../lib/kpis";
import type { DatedRankingRow } from "../lib/ranking-history";
import {
  BEST_METRICS,
  ETAPPEN,
  GAME_LADDER,
  GAME_TEXT,
  bestRows,
  communityGoalFor,
  communityView,
  communityWeek,
  counted,
  etappeCrossed,
  flameState,
  gameCounts,
  gameMoments,
  gameSummary,
  gameView,
  ladderStep,
  levelUps,
  markFor,
  markNotice,
  monthPlaces,
  newBests,
  newStreakBest,
  nextEtappe,
  personalBests,
  plausibilityHint,
  roundFor,
  streakNote,
  weekStartOf,
  weekView,
  withSubmitted,
  type CommunityRow,
  type GameCheckin,
  type GameInputs,
  type GameRevision,
} from "../lib/game";

// ---------------------------------------------------------------------------
// Bausteine. Berlin-Ortszeit als Zeitpunkt, damit die Tests die Regeln lesen.

const TZ = "Europe/Berlin";
const at = (day: string, hh: number, mm = 0) => zonedTime(day, hh, mm, TZ);
const counts = (c: Partial<Counts> = {}): Counts => ({ ...emptyCounts(), ...c });
const asCounts = (c: Partial<Counts> | number | null) =>
  counts(typeof c === "number" || c === null ? { attempts: c } : c);

type Entry = { row: GameCheckin; revisions: GameRevision[] };
/** Übernommener Tag aus dem Import. */
function imported(day: string, c: Partial<Counts> | number | null): Entry {
  return {
    row: {
      day,
      counts: asCounts(c),
      origin: "import",
      source: "wins-import",
      firstSubmittedAt: null,
      callsDocumentedAt: null,
    },
    revisions: [],
  };
}
/** Eigener Abschluss, erste Einreichung zum Zeitpunkt `when`, mit Fassung. */
function submitted(day: string, c: Partial<Counts> | number | null, when: Date): Entry {
  const full = asCounts(c);
  const iso = when.toISOString();
  return {
    row: {
      day,
      counts: full,
      origin: "closing",
      source: "website",
      firstSubmittedAt: iso,
      submittedAt: iso,
      callsDocumentedAt: (full.attempts ?? 0) > 0 ? iso : null,
    },
    revisions: [{ day, counts: full, createdAt: iso, source: "website" }],
  };
}
/** Korrektur eines eigenen Abschlusses: neuer Stand und neue Fassung. */
function corrected(entry: Entry, c: Partial<Counts>, when: Date): Entry {
  const full = counts({ ...entry.row.counts, ...c });
  const iso = when.toISOString();
  return {
    row: {
      ...entry.row,
      counts: full,
      submittedAt: iso,
      callsDocumentedAt:
        entry.row.callsDocumentedAt ?? ((full.attempts ?? 0) > 0 ? iso : null),
    },
    revisions: [...entry.revisions, { day: entry.row.day, counts: full, createdAt: iso, source: "website" }],
  };
}
function game(entries: Entry[], extra: Partial<GameInputs> = {}): GameInputs {
  return {
    participantId: "me",
    checkins: entries.map((e) => e.row),
    revisions: entries.flatMap((e) => e.revisions),
    pauses: [],
    settings: S,
    trackingStart: "2026-08-03",
    eligibleSince: "2026-08-03T06:00:00.000Z",
    splitDay: null,
    goal: null,
    days: [1, 2, 3, 4, 5],
    ...extra,
  };
}
/** n Werktage (Montag bis Freitag) vor `day`, der jüngste zuerst. */
function weekdaysBefore(day: string, n: number) {
  const out: string[] = [];
  for (let d = addDays(day, -1); out.length < n; d = addDays(d, -1)) if (isoWeekday(d) <= 5) out.push(d);
  return out;
}
function weekdaysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5) out.push(d);
  return out;
}
/** Übernommene Basis: je Werktag vor `day` ein Wert, der jüngste zuerst. */
const basis = (day: string, values: (number | null)[]) =>
  weekdaysBefore(day, values.length).map((d, i) => imported(d, values[i]));
const roundAt = (inputs: GameInputs, day: string, now: Date) =>
  roundFor(inputs, day, gameSummary(inputs, now, { from: day }).days.find((d) => d.day === day) ?? null);
const submit = (inputs: GameInputs, day: string, c: Partial<Counts> | number, when: Date) =>
  withSubmitted(inputs, { day, counts: asCounts(c), submittedAt: when.toISOString() });

// 2026-09-28 ist ein Montag.
const MO = "2026-09-28",
  DI = "2026-09-29",
  MI = "2026-09-30",
  DO = "2026-10-01",
  FR = "2026-10-02";

// ---------------------------------------------------------------------------
// 1. Tagesmarke und volle Runde

test("Marke: nächste Stufe der Leiter, bei Gleichstand die höhere, Grenzen 50 und 300", () => {
  assert.deepEqual([...GAME_LADDER], [50, 75, 100, 125, 150, 200, 250, 300]);
  for (const [median, step] of [
    [0, 50],
    [30, 50],
    [60, 50],
    [62.5, 75],
    [95, 100],
    [112.5, 125],
    [140, 150],
    [175, 200],
    [225, 250],
    [300, 300],
    [480, 300],
  ])
    assert.equal(ladderStep(median), step, `Median ${median}`);
});

test("Marke: Median mit ungerader und gerader Anzahl, unter 3 Basistagen 50", () => {
  const D = "2026-10-07";
  const mark = (values: (number | null)[]) => markFor(game(basis(D, values)), D);
  assert.deepEqual(mark([90, 100, 130]), { mark: 100, basisDays: 3, comeback: null });
  assert.equal(mark([60, 65, 60, 65])?.mark, 75);
  assert.equal(mark([150, 200, 150, 200])?.mark, 200);
  assert.equal(mark([200, 250, 200, 250])?.mark, 250);
  assert.equal(mark([20, 20, 20])?.mark, 50);
  assert.equal(mark([500, 500, 500])?.mark, 300);
  assert.deepEqual(mark([300, 300]), { mark: 50, basisDays: 2, comeback: null });
  assert.deepEqual(mark([]), { mark: 50, basisDays: 0, comeback: null });
});

test("Basis: nur Pflicht-Tage davor, höchstens 10 und 60 Kalendertage; 0 zählt, null nicht", () => {
  const D = "2026-10-07";
  // Die zehn jüngsten: fünfmal 100, fünfmal 200 ergibt 150. Ältere 200er zählen nicht.
  const ten = markFor(game(basis(D, [100, 100, 100, 100, 100, 200, 200, 200, 200, 200, 200, 200])), D);
  assert.deepEqual(ten, { mark: 150, basisDays: 10, comeback: null });
  // Wochenende und Pausentage tragen nichts bei.
  const free = game(
    [...basis(D, [100, 100]), imported("2026-10-03", 1000), imported("2026-10-04", 1000), imported(FR, 1000)],
    { pauses: [{ from: FR, to: FR }] },
  );
  assert.deepEqual(markFor(free, D), { mark: 50, basisDays: 2, comeback: null });
  // 60 Kalendertage: vor dem Di. 06.10. zählt Fr. 07.08. noch, Do. 06.08. nicht mehr.
  const T = "2026-10-06";
  const window = game([
    ...basis(T, [100, 100, 100]),
    imported("2026-08-07", 1000),
    imported("2026-08-06", 1000),
    imported("2026-08-05", 1000),
  ]);
  assert.deepEqual(markFor(window, T), { mark: 100, basisDays: 4, comeback: null });
  // 0 ist eine Meldung, null nicht: [200, 0, 0, 200] ergibt den Median 100.
  assert.deepEqual(markFor(game(basis(D, [200, 200, null, 0, 0])), D), {
    mark: 100,
    basisDays: 4,
    comeback: null,
  });
});

test("Basis: Importe und eigene Tage gleich, auch vor trackingStart; der eigene Wert von D zählt nicht", () => {
  const D = "2026-10-07";
  const mixed = game([
    submitted("2026-10-06", 100, at("2026-10-06", 20)),
    imported("2026-10-05", 100),
    submitted("2026-10-02", 100, at("2026-10-02", 20)),
  ]);
  assert.equal(markFor(mixed, D)?.mark, 100);
  // Erfassung beginnt erst an D: die übernommene Historie trägt die Marke sofort.
  const fresh = game(basis(D, [100, 100, 100]), {
    trackingStart: D,
    eligibleSince: at(D, 8).toISOString(),
  });
  assert.equal(markFor(fresh, D)?.mark, 100);
  // Vor der Freischaltung gibt es keine Marke.
  assert.equal(markFor(fresh, "2026-10-06"), null);
  const withToday = game([...basis(D, [100, 100, 100]), submitted(D, 1000, at(D, 20))]);
  assert.deepEqual(markFor(withToday, D), markFor(game(basis(D, [100, 100, 100])), D));
});

test("Basis: der aufgeteilte Duo-Tag 22.09.2026 zählt nicht als Tageswert", () => {
  const D = "2026-09-24";
  const entries = [imported("2026-09-23", 100), imported("2026-09-22", 1000), imported("2026-09-21", 100)];
  assert.deepEqual(markFor(game(entries, { splitDay: "2026-09-22" }), D), {
    mark: 50,
    basisDays: 2,
    comeback: null,
  });
  assert.equal(markFor(game(entries), D)?.basisDays, 3);
  // Am Duo-Tag selbst gibt es keine Marke.
  assert.equal(markFor(game(entries, { splitDay: "2026-09-22" }), "2026-09-22"), null);
});

test("Marke nur an Pflicht-Tagen: Wochenende und Pause ohne Marke", () => {
  const inputs = game(basis("2026-10-07", [100, 100, 100]), { pauses: [{ from: "2026-10-08", to: "2026-10-08" }] });
  assert.equal(markFor(inputs, "2026-10-03"), null);
  assert.equal(markFor(inputs, "2026-10-04"), null);
  assert.equal(markFor(inputs, "2026-10-08"), null);
  assert.equal(markFor(game([], { trackingStart: null, eligibleSince: null }), "2026-10-07"), null);
});

test("Spielstand: Erhöhung nach der Frist zählt nicht, Senkung schon, Erhöhung davor zählt", () => {
  const first = submitted(MO, 80, at(MO, 20));
  const raisedLate = corrected(first, { attempts: 120 }, at(MI, 12));
  assert.equal(gameCounts(game([raisedLate]), MO)?.attempts, 80);
  assert.deepEqual(counted(game([raisedLate]), MO), [{ metric: "attempts", counted: 80, current: 120 }]);
  const loweredLate = corrected(first, { attempts: 60 }, at(MI, 12));
  assert.equal(gameCounts(game([loweredLate]), MO)?.attempts, 60);
  assert.deepEqual(counted(game([loweredLate]), MO), []);
  const raisedInTime = corrected(first, { attempts: 120 }, at(DI, 9, 30));
  assert.equal(gameCounts(game([raisedInTime]), MO)?.attempts, 120);
  // Ein Tag ohne Zeile hat keinen Spielstand.
  assert.equal(gameCounts(game([first]), DI), null);
});

test("Spielstand: Nachtrag nach der Frist nutzt die erste Einreichung", () => {
  const late = submitted(MO, 50, at(DO, 12));
  const raised = corrected(late, { attempts: 90 }, at(FR, 12));
  assert.equal(gameCounts(game([raised]), MO)?.attempts, 50);
});

test("Spielstand: ersetzter Wins-Import nutzt nur Fassungen mit source='website'", () => {
  const own = corrected(submitted(MO, 100, at(DI, 8)), { attempts: 150 }, at(MI, 12));
  const inputs = game([own]);
  inputs.revisions.push({
    day: MO,
    counts: counts({ attempts: 300 }),
    createdAt: at(DI, 9).toISOString(),
    source: "wins-import",
  });
  assert.equal(gameCounts(inputs, MO)?.attempts, 100);
});

test("Spielstand: null in der Fassung gilt als nicht gemeldet; Altdaten ohne Fassung nutzen den Stand", () => {
  const first = submitted(MO, { attempts: 40, settingsBooked: null }, at(MO, 20));
  const later = corrected(first, { settingsBooked: 3 }, at(MI, 12));
  const state = gameCounts(game([later]), MO);
  assert.equal(state?.settingsBooked, null);
  assert.equal(state?.attempts, 40);
  // Altdaten: ein Abschluss ohne jede Fassung, nach der Frist auf 90 geändert.
  const legacy = corrected(submitted(MO, 70, at(MO, 20)), { attempts: 90 }, at(MI, 12));
  assert.equal(gameCounts(game([{ ...legacy, revisions: [] }]), MO)?.attempts, 90);
});

test("Spielstand: eine bestätigte Pause verschiebt die Frist", () => {
  const friday = "2026-09-25";
  const raised = corrected(submitted(friday, 80, at(friday, 20)), { attempts: 120 }, at(DI, 15));
  assert.equal(gameCounts(game([raised]), friday)?.attempts, 80);
  assert.equal(gameCounts(game([raised], { pauses: [{ from: MO, to: DI }] }), friday)?.attempts, 120);
});

test("Spielstand: Sommerzeitende am 25.10.2026 verschiebt die Frist auf 09:00 UTC", () => {
  const friday = "2026-10-23";
  assert.equal(deadlineFor(friday, S).toISOString(), "2026-10-26T09:00:00.000Z");
  const first = submitted(friday, 80, at(friday, 20));
  const inTime = corrected(first, { attempts: 120 }, new Date("2026-10-26T08:30:00Z"));
  const tooLate = corrected(first, { attempts: 120 }, new Date("2026-10-26T09:30:00Z"));
  assert.equal(gameCounts(game([inTime]), friday)?.attempts, 120);
  assert.equal(gameCounts(game([tooLate]), friday)?.attempts, 80);
});

test("Volle Runde nur bei called und erreichter Marke; reflected, late und imported nie", () => {
  const D = "2026-10-06";
  const base = basis(D, [100, 100, 100]);
  const evening = at(D, 21);
  const later = at("2026-10-07", 12);
  const called = roundAt(game([...base, submitted(D, 120, at(D, 20))]), D, evening);
  assert.deepEqual(called, { mark: 100, attempts: 120, markReached: true, onTime: true, full: true, imported: false });
  const short = roundAt(game([...base, submitted(D, 80, at(D, 20))]), D, evening);
  assert.equal(short?.full, false);
  assert.equal(short?.markReached, false);
  assert.equal(short?.onTime, true);
  const reflected = roundAt(game([...base, submitted(D, 0, at(D, 20))]), D, evening);
  assert.equal(reflected?.full, false);
  assert.equal(reflected?.onTime, true);
  const late = roundAt(game([...base, submitted(D, 150, at("2026-10-07", 11))]), D, later);
  assert.equal(late?.markReached, true);
  assert.equal(late?.full, false);
  assert.equal(late?.onTime, false);
  const fromGroup = roundAt(game([...base, imported(D, 150)]), D, later);
  assert.deepEqual(fromGroup, { mark: 100, attempts: 150, markReached: true, onTime: false, full: false, imported: true });
  // Dieselbe Runde in der Übersicht.
  const view = gameView(game([...base, submitted(D, 120, at(D, 20))]), evening);
  assert.equal(view.round?.full, true);
  assert.equal(view.days.find((d) => d.day === D)?.fullRound, true);
  assert.equal(gameView(game([...base, imported(D, 150)]), later).days.find((d) => d.day === D)?.fullRound, false);
});

// Historie für den Wiedereinstieg: jeder Werktag vom 01. bis 23.09. mit 120 Anwahlen.
const history = (value = 120, to = "2026-09-23") =>
  weekdaysBetween("2026-09-01", to).map((d) => imported(d, value));

test("Wiedereinstieg: drei leere Calling-Wochentage davor ergeben Marke 50", () => {
  assert.deepEqual(markFor(game(history()), DI), { mark: 50, basisDays: 10, comeback: "gap" });
  // Ohne Lücke bleibt es beim Median: 120 liegt am nächsten an 125.
  assert.deepEqual(markFor(game([...history(), imported(MO, 120)]), DI), {
    mark: 125,
    basisDays: 10,
    comeback: null,
  });
});

test("Wiedereinstieg: der Folgetag zählt noch, der übernächste nicht", () => {
  const back = game([...history(), submitted(DI, 60, at(DI, 20))]);
  assert.equal(markFor(back, MI)?.comeback, "gap");
  assert.equal(markFor(back, MI)?.mark, 50);
  assert.equal(markFor(back, DO)?.comeback, null);
});

test("Wiedereinstieg: eine reine Pause ergibt 'pause', eine gemischte Lücke 'gap'", () => {
  assert.equal(markFor(game(history(), { pauses: [{ from: "2026-09-24", to: MO }] }), DI)?.comeback, "pause");
  assert.equal(
    markFor(game(history(), { pauses: [{ from: "2026-09-24", to: "2026-09-25" }] }), DI)?.comeback,
    "gap",
  );
});

test("Karte: Wiedereinstieg ersetzt Titel und Satz, neues Konto bekommt die erste Marke", () => {
  assert.deepEqual(markNotice({ mark: 50, basisDays: 10, comeback: "gap" }, 7), {
    title: "Willkommen zurück.",
    text: "Heute reicht: 50 Anwahlen und dein Abschluss. Nichts nachholen, einfach wieder anfangen.",
  });
  assert.deepEqual(markNotice({ mark: 50, basisDays: 10, comeback: "pause" }, 7), {
    title: "Pause vorbei.",
    text: "Heute reicht: 50 Anwahlen und dein Abschluss. Deine Serie wartet bei 7.",
  });
  assert.deepEqual(markNotice({ mark: 50, basisDays: 2, comeback: null }, 0), {
    title: null,
    text: "Deine erste Tagesmarke: 50 Anwahlen. Ab drei gemeldeten Calling-Tagen richtet sie sich nach dir.",
  });
  assert.equal(markNotice({ mark: 100, basisDays: 10, comeback: null }, 7), null);
});

test("Wiedereinstieg: ein neues Konto ohne frühere Anwahlen nie", () => {
  assert.deepEqual(markFor(game(history(0)), DI), { mark: 50, basisDays: 10, comeback: null });
  assert.deepEqual(markFor(game([]), DI), { mark: 50, basisDays: 0, comeback: null });
});

test("Wiedereinstieg: das Wochenende unterbricht die Zählung nicht", () => {
  // Mi. bis Fr. leer, am Samstag ein freiwilliger Abschluss: trotzdem eine Lücke vor Montag.
  const weekend = game([...history(120, "2026-09-22"), submitted("2026-09-26", 80, at("2026-09-26", 12))]);
  assert.equal(markFor(weekend, MO)?.comeback, "gap");
  // Nur Do. und Fr. leer: Mittwoch gehört zu den drei Tagen, keine Lücke.
  assert.equal(markFor(game(history(120, "2026-09-23")), MO)?.comeback, null);
});

test("Eingaben fremder Profile und kind='joint' fließen nie ein", () => {
  const D = "2026-10-07";
  const inputs = game([...basis(D, [100, 100, 100]), submitted("2026-09-21", 100, at("2026-09-21", 20))]);
  inputs.checkins.push(
    { ...imported(MO, 999).row, participant: "other" },
    { ...imported(DI, 999).row, kind: "joint" },
  );
  inputs.revisions.push({
    day: "2026-09-21",
    counts: counts({ attempts: 10 }),
    createdAt: at("2026-09-21", 19).toISOString(),
    participant: "other",
  });
  assert.equal(gameCounts(inputs, MO), null);
  assert.equal(gameCounts(inputs, DI), null);
  assert.equal(gameCounts(inputs, "2026-09-21")?.attempts, 100);
  assert.equal(personalBests(inputs).day.attempts?.value, 100);
  assert.equal(markFor(inputs, D)?.mark, 100);
  // Ein gemeinsamer Datensatz spielt gar nicht mit.
  const joint = { ...inputs, kind: "joint" };
  assert.equal(markFor(joint, D), null);
  assert.equal(personalBests(joint).reportedDays, 0);
  assert.deepEqual(levelUps(game([]), joint), []);
});

// ---------------------------------------------------------------------------
// 2. Serie als Flamme mit Etappen

test("Etappen: 4 auf 5 löst aus, 5 auf 6 nicht; mehrere ergeben die höchste; nach 100 keine", () => {
  assert.deepEqual([...ETAPPEN], [5, 10, 20, 40, 60, 100]);
  assert.equal(etappeCrossed(4, 5), 5);
  assert.equal(etappeCrossed(5, 6), null);
  assert.equal(etappeCrossed(3, 12), 10);
  assert.equal(etappeCrossed(99, 100), 100);
  assert.equal(etappeCrossed(100, 140), null);
  assert.equal(nextEtappe(0), 5);
  assert.equal(nextEtappe(5), 10);
  assert.equal(nextEtappe(99), 100);
  assert.equal(nextEtappe(100), null);
});

test("Neuer Serien-Bestwert erst ab bisherigem Bestwert 3, Gleichstand ist keiner", () => {
  assert.equal(newStreakBest({ best: 3 }, { current: 4 }), 4);
  assert.equal(newStreakBest({ best: 2 }, { current: 3 }), null);
  assert.equal(newStreakBest({ best: 5 }, { current: 5 }), null);
});

test("flameState für 0, 1, 4, 5, 19, 20, atRisk und Pause", () => {
  const flame = (current: number, atRisk: unknown = null, paused = false) =>
    flameState({ current }, atRisk, paused);
  assert.equal(flame(0), "none");
  assert.equal(flame(1), "short");
  assert.equal(flame(4), "short");
  assert.equal(flame(5), "glow");
  assert.equal(flame(19), "glow");
  assert.equal(flame(20), "long");
  assert.equal(flame(7, { day: MO, deadline: at(DI, 10).toISOString() }), "risk");
  assert.equal(flame(7, null, true), "paused");
});

test("Öffentliche Zeile bekommt nie atRisk oder Pause", async () => {
  // Öffentlich zeigt die Flamme nur die Länge: flameState(streak, null, false).
  for (let n = 0; n <= 120; n++)
    assert.ok(!["risk", "paused"].includes(flameState({ current: n }, null, false)));
  const source = await readFile(new URL("../server/commitment-public.ts", import.meta.url), "utf8");
  const pushed = source.slice(source.indexOf("rows.push({"), source.indexOf("});", source.indexOf("rows.push({")));
  assert.ok(pushed.length > 0);
  assert.doesNotMatch(pushed, /atRisk|paused|pause/i);
});

test("Serie aus summarize(): gleiche Zahlen wie closingState, auch mit 0 Anwahlen", () => {
  const entries = [
    submitted(MO, 80, at(MO, 20)),
    submitted(DI, 0, at(DI, 20)),
    submitted(MI, 120, at(MI, 20)),
  ];
  const inputs = game(entries, { trackingStart: MO, eligibleSince: at(MO, 8).toISOString() });
  const now = at(DO, 12);
  const closings: Closing[] = entries.map((e) => ({
    day: e.row.day,
    attempts: e.row.counts.attempts ?? null,
    firstSubmittedAt: e.row.firstSubmittedAt!,
    submittedAt: e.row.submittedAt!,
    callsDocumentedAt: e.row.callsDocumentedAt,
  }));
  const reference = summarize({ closings, trackingStart: MO, from: MO, to: DO, now, settings: S });
  const view = gameView(inputs, now);
  assert.equal(view.streak.current, reference.streak.current);
  assert.equal(view.streak.best, reference.streak.best);
  assert.equal(view.streak.current, 3);
  assert.equal(view.streak.nextEtappe, 5);
  // Heute offen ist der normale Auftrag, keine Gefahr.
  assert.equal(reference.atRisk?.day, DO);
  assert.equal(view.streak.atRisk, null);
  assert.equal(view.streak.flame, "short");
  assert.equal(view.deadline, at(FR, 10).toISOString());
});

test("Gefahr: ein früherer Tag hängt noch an seiner Frist", () => {
  const inputs = game([submitted(MO, 80, at(MO, 20)), submitted(DI, 90, at(DI, 20))], {
    trackingStart: MO,
    eligibleSince: at(MO, 8).toISOString(),
  });
  const morning = gameView(inputs, at(DO, 9));
  assert.deepEqual(morning.streak.atRisk, { day: MI, deadline: at(DO, 10).toISOString() });
  assert.equal(morning.streak.flame, "risk");
  assert.equal(
    GAME_TEXT.streakAtRisk(morning.streak.atRisk!, TZ, at(DO, 9)),
    "Deine Serie hängt an Mittwoch. Bis heute 10:00 Uhr.",
  );
  // Nach der Frist ist die Serie gerissen, keine Gefahr mehr.
  const later = gameView(inputs, at(DO, 11));
  assert.equal(later.streak.atRisk, null);
  assert.equal(later.streak.current, 0);
  assert.equal(later.streak.flame, "none");
});

test("streakNote: Pause, Gefahr, Start, nächste Etappe, alle Etappen", () => {
  const note = (streak: { current: number; best: number; atRisk?: { day: string; deadline: string } | null; paused?: boolean }, status: "open" | "called" | null = "called") =>
    streakNote({ atRisk: null, paused: false, ...streak }, status, TZ, at("2026-10-03", 12));
  assert.equal(note({ current: 7, best: 7, paused: true }), "Pause: deine Serie wartet bei 7.");
  assert.equal(
    note({ current: 7, best: 7, atRisk: { day: FR, deadline: at("2026-10-05", 10).toISOString() } }),
    "Deine Serie hängt an Freitag. Bis Mo. 10:00 Uhr.",
  );
  assert.equal(note({ current: 0, best: 3 }, "open"), "Serie startet mit diesem Tag");
  assert.equal(note({ current: 0, best: 3 }, null), "Serie startet mit deinem nächsten rechtzeitigen Abschluss");
  assert.equal(note({ current: 7, best: 9 }), "Nächste Etappe: 10 Tage. Noch 3 rechtzeitige Abschlüsse.");
  assert.equal(note({ current: 9, best: 9 }), "Nächste Etappe: 10 Tage. Noch 1 rechtzeitiger Abschluss.");
  assert.equal(note({ current: 112, best: 112 }), "Alle Etappen geschafft. Bestwert 112.");
});

test("Pause heute: die Flamme wartet, ohne Frist", () => {
  const inputs = game([submitted(MO, 80, at(MO, 20))], {
    trackingStart: MO,
    eligibleSince: at(MO, 8).toISOString(),
    pauses: [{ from: DI, to: MI }],
  });
  const view = gameView(inputs, at(DI, 12));
  assert.equal(view.streak.paused, true);
  assert.equal(view.streak.flame, "paused");
  assert.equal(view.mark, null);
  assert.equal(view.round, null);
  assert.equal(view.deadline, null);
});

test("Freischaltungstag: Marke und Frist stehen schon vor dem ersten Abschluss", () => {
  const D = "2026-10-06";
  const inputs = game(basis(D, [100, 100, 100]), { trackingStart: "2026-10-07", eligibleSince: at(D, 9).toISOString() });
  const view = gameView(inputs, at(D, 12));
  assert.equal(view.mark?.mark, 100);
  assert.equal(view.deadline, at("2026-10-07", 10).toISOString());
  assert.equal(GAME_TEXT.closingDue(view.deadline!, TZ, at(D, 12)), "Abschluss bis morgen 10:00 Uhr");
});

// ---------------------------------------------------------------------------
// 3. Tagesbilanz nach dem Einreichen

/** Eine Woche Mo. 05. bis Do. 08.10. rechtzeitig, davor zwei übernommene Tage. */
function weekScenario(day: string, attempts: number, goal = 500) {
  const before = game(
    [
      imported(DO, 50),
      imported(FR, 50),
      ...weekdaysBetween("2026-10-05", addDays(day, -1)).map((d) => submitted(d, 60, at(d, 20))),
    ],
    { trackingStart: "2026-10-05", eligibleSince: "2026-10-05T06:00:00.000Z", goal },
  );
  const after = submit(before, day, { attempts, settingsBooked: 0, closingsBooked: 0 }, at(day, 20));
  return { before, after, now: at(day, 21) };
}
const rec = (id: string, day: string, attempts: number, kind: "person" | "joint" = "person"): DatedRankingRow => ({
  id,
  key: id,
  name: id,
  company: "",
  role: "",
  kind,
  claimed: true,
  counts: counts({ attempts }),
  source: "Selbst gemeldet",
  updatedAt: "2026-10-06T00:00:00.000Z",
  day,
});

test("gameMoments: feste Rangfolge, höchstens zwei Höhepunkte", () => {
  const D = "2026-10-09";
  const { before, after, now } = weekScenario(D, 300);
  const records = [
    rec("a", DO, 2000),
    rec("b", DO, 500),
    rec("c", DO, 400),
    ...[DO, FR].map((d) => rec("me", d, 50)),
    ...weekdaysBetween("2026-10-05", "2026-10-08").map((d) => rec("me", d, 60)),
  ];
  const moments = gameMoments({
    before,
    after,
    day: D,
    firstSubmission: true,
    monthRecords: records,
    participantId: "me",
    now,
  });
  assert.equal(moments.status, "called");
  assert.deepEqual(moments.streak, { before: { current: 4, best: 4 }, after: { current: 5, best: 5 } });
  assert.equal(moments.round?.full, true);
  // Möglich wären Etappe, Bestwert, Level, Wochenziel und Platz; es bleiben die ersten zwei.
  assert.deepEqual(moments.highlights, [
    {
      kind: "etappe",
      title: "5 Tage Serie.",
      detail: "Eine ganze Calling-Woche, jeder Tag rechtzeitig. So lang wie nie.",
    },
    { kind: "best", title: "Neuer Bestwert: 300 Anwahlen an einem Tag.", detail: "Bisher 60 am 05.10." },
  ]);
  assert.deepEqual(levelUps(before, after), ["Anwahlen auf Level 2"]);
  // Freitag: diese Woche folgt kein Calling-Tag mehr, also die nächste Etappe.
  assert.deepEqual(moments.nextStep, { kind: "etappe", text: "Als Nächstes: Etappe 10 Tage Serie, noch 5 rechtzeitige Abschlüsse.", etappe: 10 });
  // Keine Wertungszahl und keine Gewichte in den Texten.
  const score = String(scoreOf(counts({ attempts: 300 })) + 4 * 60 + 2 * 50);
  for (const h of moments.highlights) {
    const text = `${h.title} ${h.detail}`;
    assert.doesNotMatch(text, /Wertung|Gewicht|Punkte/);
    assert.ok(!text.includes(score), text);
  }
});

test("gameMoments: Korrektur und unveränderte Fassung liefern keine Höhepunkte", () => {
  const D = "2026-10-09";
  const { before, after, now } = weekScenario(D, 300);
  const correction = gameMoments({ before, after, day: D, firstSubmission: false, participantId: "me", now });
  assert.deepEqual(correction.highlights, []);
  assert.equal(correction.round?.full, true);
  assert.equal(correction.streak.after.current, 5);
});

test("gameMoments: Als Nächstes nennt mitten in der Woche den Rest bis zum Wochenziel", () => {
  const D = "2026-10-07";
  const { before, after, now } = weekScenario(D, 100);
  const moments = gameMoments({ before, after, day: D, firstSubmission: true, participantId: "me", now });
  assert.deepEqual(moments.nextStep, {
    kind: "week",
    text: "Als Nächstes: Diese Woche noch 280 Anwahlen bis zu deinem Wochenziel.",
    attempts: 220,
    goal: 500,
    remaining: 280,
  });
  // Nie ein Hinweis zum gerade eingereichten Tag.
  assert.doesNotMatch(moments.nextStep!.text, /heute|Mittwoch|07\.10\./);
});

test("gameMoments: Als Nächstes zählt den heutigen Calling-Tag, solange er noch offen ist", () => {
  // Mo. bis Mi. je 100, Wochenziel 600; der Donnerstag wird am Freitag um 09:00 eingereicht.
  const D = "2026-10-08";
  const F = "2026-10-09";
  const before = game(
    weekdaysBetween("2026-10-05", "2026-10-07").map((d) => submitted(d, 100, at(d, 20))),
    { trackingStart: "2026-10-05", eligibleSince: "2026-10-05T06:00:00.000Z", goal: 600 },
  );
  const after = submit(before, D, { attempts: 100, settingsBooked: 0, closingsBooked: 0 }, at(F, 9));
  const moments = gameMoments({ before, after, day: D, firstSubmission: true, participantId: "me", now: at(F, 9) });
  assert.equal(moments.status, "called");
  assert.deepEqual(moments.nextStep, {
    kind: "week",
    text: "Als Nächstes: Diese Woche noch 200 Anwahlen bis zu deinem Wochenziel.",
    attempts: 400,
    goal: 600,
    remaining: 200,
  });
  // Am Donnerstagabend eingereicht ergibt dasselbe.
  const evening = submit(before, D, { attempts: 100, settingsBooked: 0, closingsBooked: 0 }, at(D, 19));
  const sameDay = gameMoments({ before, after: evening, day: D, firstSubmission: true, participantId: "me", now: at(D, 19) });
  assert.equal(sameDay.nextStep?.kind, "week");
  // Ist der Freitag schon eingereicht, folgt diese Woche kein Calling-Tag mehr.
  const withFriday = submit(before, F, { attempts: 100, settingsBooked: 0, closingsBooked: 0 }, at(F, 8));
  const late = submit(withFriday, D, { attempts: 100, settingsBooked: 0, closingsBooked: 0 }, at(F, 9));
  const done = gameMoments({ before: withFriday, after: late, day: D, firstSubmission: true, participantId: "me", now: at(F, 9) });
  assert.equal(done.nextStep?.kind, "etappe");
});

test("Nachtrag nach der Frist: keine Etappe, Serie unverändert, Bestwert möglich", () => {
  const D = "2026-10-08";
  const { before } = weekScenario(D, 0);
  const after = submit(before, D, { attempts: 400 }, at("2026-10-09", 11));
  const moments = gameMoments({ before, after, day: D, firstSubmission: true, participantId: "me", now: at("2026-10-09", 12) });
  assert.equal(moments.status, "late");
  assert.deepEqual(moments.streak.after, moments.streak.before);
  assert.ok(moments.highlights.every((h) => h.kind !== "etappe" && h.kind !== "streak-best"));
  assert.equal(moments.highlights[0]?.kind, "best");
});

/** Monatsplatz-Zeile einer ersten Einreichung am 06.10. */
function placeLine(records: DatedRankingRow[], attempts: number, oldCounts: Partial<Counts> | null = null) {
  const day = "2026-10-06";
  const before = game(oldCounts ? [imported(day, oldCounts)] : [], { trackingStart: null, eligibleSince: null });
  const after = submit(before, day, attempts, at(day, 20));
  const moments = gameMoments({
    before,
    after,
    day,
    firstSubmission: true,
    monthRecords: records,
    oldCounts,
    participantId: "me",
    now: at(day, 21),
  });
  return moments.highlights.find((h) => h.kind === "place")?.title ?? null;
}
const others = (values: number[]) => values.map((v, i) => rec(`o${i}`, DO, v));

test("Monatsplatz: Sprung, Spitze, Podium und Neueinstieg", () => {
  assert.equal(
    placeLine([...others([95, 90, 85, 80, 75, 70, 65, 60, 55, 50]), rec("me", FR, 57)], 15),
    "Dein Tag hat dich im Oktober von Platz 9 auf Platz 6 gebracht.",
  );
  assert.equal(placeLine([...others([90, 50]), rec("me", FR, 60)], 40), "Du führst den Oktober an.");
  assert.equal(
    placeLine([...others([90, 80, 70, 60, 50]), rec("me", FR, 55)], 20),
    "Du stehst im Oktober jetzt auf dem Podium: Platz 3.",
  );
  assert.equal(
    placeLine(others(Array.from({ length: 13 }, (_, i) => 90 - i)), 20),
    "Im Oktober bist du neu dabei: Platz 14.",
  );
});

test("Monatsplatz: Gleichstände wie in der Rangliste (1, 1, 3)", () => {
  const records = others([90, 90]);
  assert.deepEqual(monthPlaces(records, "me", "2026-10-06", null, counts({ attempts: 80 })), {
    month: "2026-10",
    before: null,
    after: 3,
  });
  assert.equal(placeLine(records, 80), "Du stehst im Oktober jetzt auf dem Podium: Platz 3.");
});

test("Monatsplatz: keine Zeile bei gleichem oder schlechterem Platz; vorher mit den Import-Zahlen", () => {
  assert.equal(placeLine([...others([90, 50]), rec("me", FR, 60)], 5), null);
  // Ersetzter Import: vorher 80 (Platz 2), eigener Abschluss 60 (Platz 3).
  const records = [...others([90, 70]), rec("me", "2026-10-06", 80)];
  assert.equal(placeLine(records, 60, { attempts: 80 }), null);
  assert.deepEqual(monthPlaces(records, "me", "2026-10-06", { attempts: 80 }, { attempts: 60 }), {
    month: "2026-10",
    before: 2,
    after: 3,
  });
});

test("Monatsplatz: gemeinsame Meldungen bekommen nie einen Platz", () => {
  const records = [rec("duo", DO, 1000, "joint"), ...others([90])];
  assert.equal(placeLine(records, 95), "Du führst den Oktober an.");
  assert.equal(monthPlaces(records, "duo", DO, null, { attempts: 1000 }).after, null);
});

test("Leistungslevel rechnen wie bisher mit dem aktuellen Stand aller eigenen Tage", () => {
  // Nach der Frist auf 450 erhöht: im Spiel zählen 80, für das Level 450.
  const raised = corrected(submitted(MO, 80, at(MO, 20)), { attempts: 450 }, at(MI, 12));
  const before = game([raised, imported("2026-09-21", { attempts: 0, settingsBooked: 4 })]);
  const after = submit(before, DO, { attempts: 100, settingsBooked: 1 }, at(DO, 20));
  assert.deepEqual(levelUps(before, after), ["Anwahlen auf Level 2", "Settings auf Level 1"]);
  // Dieselbe Rechnung wie bisher im Formular (levelsOf/levelUps).
  const levelsOf = (rows: GameCheckin[]) =>
    progress(aggregate(rows.map((c) => ({ ...emptyCounts(), ...c.counts }) as Counts)));
  const old = new Map(levelsOf(before.checkins).map((t) => [t.id, t.level]));
  assert.deepEqual(
    levelsOf(after.checkins)
      .filter((t) => t.level > (old.get(t.id) ?? 0))
      .map((t) => `${t.label} auf Level ${t.level}`),
    levelUps(before, after),
  );
});

test("withSubmitted ersetzt die eine Tageszeile im Speicher", () => {
  const before = game([imported(MO, 300)], { trackingStart: MO, eligibleSince: at(MO, 8).toISOString() });
  const after = submit(before, MO, 120, at(MO, 20));
  assert.equal(after.checkins.length, 1);
  assert.equal(after.checkins[0].origin, "closing");
  assert.equal(after.checkins[0].firstSubmittedAt, at(MO, 20).toISOString());
  assert.equal(gameCounts(after, MO)?.attempts, 120);
  assert.equal(gameCounts(before, MO)?.attempts, 300);
  // Korrektur: erste Einreichung und erste Dokumentation der Anwahlen bleiben.
  const again = submit(after, MO, 90, at(MI, 12));
  assert.equal(again.checkins[0].firstSubmittedAt, at(MO, 20).toISOString());
  assert.equal(again.checkins[0].callsDocumentedAt, at(MO, 20).toISOString());
  assert.equal(gameCounts(again, MO)?.attempts, 90);
  // Abschluss am Freischaltungstag: die Erfassung beginnt an diesem Tag.
  const fresh = game([], { trackingStart: DI, eligibleSince: at(MO, 15).toISOString() });
  assert.equal(submit(fresh, MO, 60, at(MO, 20)).trackingStart, MO);
});

test("submitted-note: eine alte Notiz (ohne game, mit levelUps) wird ohne Fehler gelesen", async () => {
  const old = JSON.stringify({
    day: "2026-10-06",
    unchanged: false,
    effect: "Rechtzeitig eingereicht.",
    levelUps: ["Anwahlen auf Level 2"],
    settings: null,
  });
  const scope = globalThis as { sessionStorage?: unknown };
  scope.sessionStorage = { getItem: () => old, setItem: () => undefined, removeItem: () => undefined };
  try {
    const { takeSubmitted } = await import("../app/features/submitted-note");
    const note = takeSubmitted("2026-10-06");
    assert.equal(note?.day, "2026-10-06");
    assert.equal(note?.game, null);
    assert.equal(note?.counts, null);
  } finally {
    delete scope.sessionStorage;
  }
});

test("submitted-note: die eingereichten Zahlen reisen mit, damit die Zahlenzeile nicht auf die Rangliste wartet", async () => {
  let stored = "";
  const scope = globalThis as { sessionStorage?: unknown };
  scope.sessionStorage = {
    getItem: () => stored || null,
    setItem: (_: string, value: string) => void (stored = value),
    removeItem: () => void (stored = ""),
  };
  try {
    const { rememberSubmitted, takeSubmitted } = await import("../app/features/submitted-note");
    const counts = { attempts: 127, settingsBooked: 4, closingsBooked: 1, settingsHeld: null };
    rememberSubmitted({ day: "2026-10-06", unchanged: false, effect: null, counts, game: null, settings: null });
    assert.deepEqual(takeSubmitted("2026-10-06")?.counts, counts);
    // Genau einmal; Unstimmiges gilt als Notiz ohne Zahlen.
    assert.equal(takeSubmitted("2026-10-06"), null);
    stored = JSON.stringify({ day: "2026-10-06", counts: { attempts: "127" } });
    assert.equal(takeSubmitted("2026-10-06")?.counts, null);
    stored = JSON.stringify({ day: "2026-10-06", counts: { attempts: 80, fremd: 1 } });
    assert.deepEqual(takeSubmitted("2026-10-06")?.counts, { attempts: 80 });
  } finally {
    delete scope.sessionStorage;
  }
  // Beide Wege zur Bilanz legen die Zahlen in die Notiz.
  for (const file of ["day-view.tsx", "day-entry.tsx"]) {
    const source = await readFile(new URL(`../app/features/${file}`, import.meta.url), "utf8");
    assert.match(source, /rememberSubmitted\(\{[^}]*counts: confirmation\.counts,/, file);
  }
});

// ---------------------------------------------------------------------------
// 4. Persönliche Bestwerte und Ehrlichkeitsfrage

test("Bestwerte: 4 frühere Tage ergeben keinen Höhepunkt, 5 schon", () => {
  const four = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].map((d) => imported(d, 50));
  const day = "2026-10-02";
  const run = (entries: Entry[]) => {
    const before = game(entries);
    return newBests(before, submit(before, day, 80, at(day, 20)), day).day;
  };
  assert.deepEqual(run(four), []);
  assert.deepEqual(run([imported("2026-09-25", 50), ...four]), [
    { metric: "attempts", value: 80, previous: { value: 50, day: "2026-09-25" } },
  ]);
});

test("Bestwerte: Woche ab 2, Monat ab 1 früheren Zeitraum mit Meldung", () => {
  const day = "2026-10-06";
  const run = (entries: Entry[]) => {
    const before = game(entries);
    return newBests(before, submit(before, day, 150, at(day, 20)), day);
  };
  assert.equal(run([imported("2026-09-28", 100)]).week, null);
  assert.deepEqual(run([imported("2026-09-21", 100), imported("2026-09-28", 100)]).week, {
    value: 150,
    weekStart: "2026-10-05",
    previous: 100,
  });
  assert.equal(run([imported("2026-10-01", 100)]).month, null);
  assert.deepEqual(run([imported("2026-09-28", 100)]).month, { value: 150, month: "2026-10", previous: 100 });
});

test("Bestwerte: 0 zählt als Vorgeschichte, null nicht; erster Wert über 0 ohne Vergleich", () => {
  const day = "2026-10-02";
  const earlier = weekdaysBefore(day, 5);
  const run = (values: (number | null)[]) => {
    const before = game(earlier.map((d, i) => imported(d, { attempts: 10, dealsWon: values[i] })));
    return newBests(before, submit(before, day, { attempts: 10, dealsWon: 1 }, at(day, 20)), day).day;
  };
  assert.deepEqual(run([0, 0, 0, 0, 0]), [{ metric: "dealsWon", value: 1, previous: null }]);
  assert.deepEqual(run([0, null, 0, null, 0]), []);
  assert.equal(GAME_TEXT.newDayBest("dealsWon", 1), "Neuer Bestwert: 1 Deal an einem Tag.");
});

test("Bestwerte: aufgeteilter Duo-Tag nicht als Tageswert, aber in der Wochensumme", () => {
  const inputs = game(
    [imported("2026-09-21", 100), imported("2026-09-22", 300), imported("2026-09-23", 100)],
    { splitDay: "2026-09-22" },
  );
  const bests = personalBests(inputs);
  assert.deepEqual(bests.day.attempts, { value: 100, day: "2026-09-21", eligible: false });
  assert.deepEqual(bests.week, { value: 500, weekStart: "2026-09-21", eligible: false });
});

test("Bestwerte: Gleichstand ist kein neuer Bestwert, Halter bleibt der früheste Tag", () => {
  const entries = weekdaysBefore("2026-10-02", 5).map((d) => imported(d, 100));
  const before = game(entries);
  const after = submit(before, "2026-10-02", 100, at("2026-10-02", 20));
  assert.deepEqual(newBests(before, after, "2026-10-02").day, []);
  assert.equal(personalBests(after).day.attempts?.day, "2026-09-25");
  assert.equal(personalBests(after).day.attempts?.eligible, false);
});

test("Woche Montag bis Sonntag nach Kalendertag, über ein Monatsende und Sommerzeitende", () => {
  assert.equal(weekStartOf("2026-10-04"), "2026-09-28");
  assert.equal(weekStartOf("2026-09-28"), "2026-09-28");
  assert.equal(weekStartOf("2026-10-05"), "2026-10-05");
  assert.equal(weekStartOf("2026-10-25"), "2026-10-19");
  assert.equal(weekStartOf("2026-10-26"), "2026-10-26");
  const bests = personalBests(
    game([imported("2026-09-30", 100), imported("2026-10-01", 100), imported("2026-10-04", 50)]),
  );
  assert.deepEqual(bests.week, { value: 250, weekStart: "2026-09-28", eligible: false });
  assert.deepEqual(bests.month, { value: 150, month: "2026-10", eligible: true });
});

test("Bestwerte: Korrektur nach unten senkt sofort, Erhöhung nach der Frist zählt nicht", () => {
  const first = submitted(MO, 300, at(MO, 20));
  const other = imported(MI, 150);
  assert.equal(personalBests(game([first, other])).day.attempts?.value, 300);
  const lowered = corrected(first, { attempts: 100 }, at(MI, 12));
  assert.deepEqual(personalBests(game([lowered, other])).day.attempts, { value: 150, day: MI, eligible: false });
  const raised = corrected(first, { attempts: 500 }, at(MI, 12));
  assert.equal(personalBests(game([raised, other])).day.attempts?.value, 300);
});

test("Laufende Woche: Höhepunkt genau beim Überschreiten, nicht erneut an Folgetagen", () => {
  const before = game([imported("2026-09-14", 300), imported("2026-09-21", 400), imported(MO, 200)]);
  const tuesday = submit(before, DI, 250, at(DI, 20));
  assert.deepEqual(newBests(before, tuesday, DI).week, { value: 450, weekStart: MO, previous: 400 });
  const wednesday = submit(tuesday, MI, 100, at(MI, 20));
  assert.equal(newBests(tuesday, wednesday, MI).week, null);
});

test("Mehrere neue Tagesbestwerte ergeben eine Zeile: Deals, Closings, Settings, Anwahlen", () => {
  const day = "2026-10-02";
  const before = game(
    weekdaysBefore(day, 5).map((d) =>
      imported(d, { attempts: 100, settingsBooked: 2, closingsBooked: 1, dealsWon: 0 }),
    ),
  );
  const after = submit(before, day, { attempts: 300, settingsBooked: 4, closingsBooked: 2, dealsWon: 1 }, at(day, 20));
  const found = newBests(before, after, day);
  assert.deepEqual(
    found.day.map((b) => b.metric),
    ["dealsWon", "closingsBooked", "settingsBooked", "attempts"],
  );
  assert.equal(
    GAME_TEXT.newDayBests(found.day),
    "Neue Bestwerte an einem Tag: 1 Deal, 2 Closings, 4 Settings und 300 Anwahlen.",
  );
  assert.equal(
    GAME_TEXT.newDayBests([
      { metric: "closingsBooked", value: 2 },
      { metric: "settingsBooked", value: 4 },
    ]),
    "Neue Bestwerte an einem Tag: 2 Closings und 4 Settings.",
  );
  const moments = gameMoments({ before, after, day, firstSubmission: true, participantId: "me", now: at(day, 21) });
  assert.equal(moments.highlights.filter((h) => h.kind === "best").length, 1);
});

test("Karte Deine Bestwerte: ab dem sechsten Tag mit Meldung, nur Werte über 0, höchstens 6", () => {
  // Mo. 28.09. bis Fr. 02.10. je 100 Anwahlen.
  const five = weekdaysBefore("2026-10-05", 5).map((d) => imported(d, 100));
  assert.equal(personalBests(game(five)).show, false);
  const inputs = game([
    ...five,
    imported("2026-09-21", { attempts: 50, settingsBooked: 4, closingsBooked: 0 }),
    imported("2026-10-05", 214),
  ]);
  const bests = personalBests(inputs);
  assert.equal(bests.show, true);
  assert.deepEqual(
    bestRows(bests, "2026-10-06").map((r) => [r.label, r.valueText, r.date, r.href]),
    [
      ["Anwahlen an einem Tag", "214", "Mo., 05.10.", "/tagesabschluss?tag=2026-10-05"],
      ["Anwahlen in einer Woche", "500", "Woche ab 28.09.", "/zahlen"],
      ["Anwahlen in einem Monat", "414", "Oktober", "/zahlen"],
      ["Settings an einem Tag", "4", "Mo., 21.09.", "/tagesabschluss?tag=2026-09-21"],
    ],
  );
  // Aus einem anderen Jahr mit Jahreszahl.
  assert.equal(bestRows(bests, "2027-01-10")[2].date, "Oktober 2026");
  const view = gameView(inputs, at("2026-10-06", 12));
  assert.deepEqual(view.days.find((d) => d.day === "2026-10-05")?.bestMetrics, ["attempts"]);
});

test("plausibilityHint: Settings über Anwahlen, aber nicht bei 0 Anwahlen", () => {
  const hint = plausibilityHint({ attempts: 8, settingsBooked: 12 }, []);
  assert.deepEqual(hint, {
    kind: "settings",
    field: "settingsBooked",
    text: "Kurz prüfen: 12 Settings bei 8 Anwahlen. Stimmt das so?",
    confirm: "Stimmt so",
    correct: "Korrigieren",
  });
  assert.equal(plausibilityHint({ attempts: 0, settingsBooked: 2 }, []), null);
  assert.equal(plausibilityHint({ attempts: 8, settingsBooked: 8 }, []), null);
});

test("plausibilityHint: Ausreißer erst ab 10 Tagen, ab 150 und über dem Dreifachen des Medians", () => {
  const days = (n: number, attempts: number, from = "2026-10-06") =>
    weekdaysBefore(from, n).map((day) => ({ day, counts: { attempts } }));
  assert.equal(plausibilityHint({ attempts: 450 }, days(9, 120)), null);
  assert.deepEqual(plausibilityHint({ attempts: 450 }, days(10, 120)), {
    kind: "outlier",
    field: "attempts",
    text: "Kurz prüfen: 450 Anwahlen. Sonst sind es bei dir meist etwa 120. Stimmt das so?",
    confirm: "Stimmt so",
    correct: "Korrigieren",
  });
  assert.equal(plausibilityHint({ attempts: 149 }, days(10, 40)), null);
  assert.equal(plausibilityHint({ attempts: 900 }, days(10, 400)), null);
  assert.equal(plausibilityHint({ attempts: 1300 }, days(10, 400))?.kind, "outlier");
  // Keine feste Obergrenze: ein Power-Dialer mit 1.000 am Tag wird bei 2.500 nicht gefragt.
  assert.equal(plausibilityHint({ attempts: 2500 }, days(10, 1000)), null);
  // Es zählen die letzten 20 Tage mit Anwahlen und nur Tage vor dem eingetragenen.
  const mixed = [...days(20, 400), ...days(20, 10, "2026-09-01")];
  assert.equal(plausibilityHint({ attempts: 1000 }, mixed), null);
  assert.equal(plausibilityHint({ attempts: 450 }, days(10, 120), "2026-09-01"), null);
});

// ---------------------------------------------------------------------------
// 5. Deine Woche: Wochenziel-Balken und Tagesreihe

test("Wochenstand: Spielstand und Importe, Wochenende zählt; Kacheln und Balken dieselbe Summe", () => {
  const monday = corrected(submitted(MO, 100, at(MO, 20)), { attempts: 150 }, at(MI, 12));
  const inputs = game([monday, imported(DI, 80), submitted("2026-10-03", 40, at("2026-10-03", 12))], { goal: 500 });
  const week = weekView(inputs, at("2026-10-03", 18));
  assert.equal(week.from, MO);
  assert.equal(week.to, "2026-10-04");
  assert.deepEqual(week.totals, { attempts: 220, settingsBooked: null, closingsBooked: null });
  assert.equal(week.remaining, 280);
  assert.equal(week.reached, false);
  assert.equal(GAME_TEXT.weekProgress(week.totals.attempts ?? 0, week.goal!), "220 von 500 Anwahlen");
  assert.equal(GAME_TEXT.weekRemaining(week.remaining!), "Noch 280 bis zu deinem Wochenziel");
  const reached = weekView({ ...inputs, goal: 200 }, at("2026-10-03", 18));
  assert.equal(reached.reached, true);
  assert.equal(GAME_TEXT.weekReached(220, 200), "Wochenziel geschafft: 220 von 200 Anwahlen");
});

test("Wochenziel: Höhepunkt nur bei vorher < Ziel <= nachher, nicht erneut, nie durch Import", () => {
  const plain = { trackingStart: null, eligibleSince: null, goal: 300 };
  const moments = (before: GameInputs, after: GameInputs, day: string) =>
    gameMoments({ before, after, day, firstSubmission: true, participantId: "me", now: at(day, 21) }).highlights.filter(
      (h) => h.kind === "week",
    );
  const monday = game([submitted("2026-10-05", 200, at("2026-10-05", 20))], plain);
  const tuesday = submit(monday, "2026-10-06", 150, at("2026-10-06", 20));
  assert.deepEqual(moments(monday, tuesday, "2026-10-06"), [
    { kind: "week", title: "Wochenziel geschafft: 350 von 300 Anwahlen.", detail: "" },
  ]);
  const wednesday = submit(tuesday, "2026-10-07", 50, at("2026-10-07", 20));
  assert.deepEqual(moments(tuesday, wednesday, "2026-10-07"), []);
  const viaImport = game([submitted("2026-10-05", 200, at("2026-10-05", 20)), imported("2026-10-06", 150)], plain);
  assert.deepEqual(moments(viaImport, submit(viaImport, "2026-10-07", 50, at("2026-10-07", 20)), "2026-10-07"), []);
});

test("Tagesreihe: Zustand je Status (called mit und ohne Marke, late, Pause, offen)", () => {
  const imports = weekdaysBetween("2026-09-21", FR).map((d) => imported(d, 100));
  const inputs = game(
    [
      ...imports,
      submitted("2026-10-05", 150, at("2026-10-05", 20)),
      submitted("2026-10-06", 60, at("2026-10-06", 20)),
      submitted("2026-10-08", 120, at("2026-10-09", 12)),
    ],
    { pauses: [{ from: "2026-10-07", to: "2026-10-07" }] },
  );
  const week = weekView(inputs, at("2026-10-09", 21));
  assert.deepEqual(
    week.days.map((d) => [d.day, d.state, d.today]),
    [
      ["2026-10-05", "full", false],
      ["2026-10-06", "submitted", false],
      ["2026-10-07", "paused", false],
      ["2026-10-08", "submitted", false],
      ["2026-10-09", "open", true],
    ],
  );
  assert.equal(week.fullRounds, 1);
  assert.equal(GAME_TEXT.fullRounds(week.fullRounds), "1 volle Runde diese Woche");
});

test("Tagesreihe: reflected, imported und missed", () => {
  const imports = weekdaysBetween("2026-09-14", "2026-09-25").map((d) => imported(d, 100));
  const inputs = game([
    ...imports,
    submitted(MO, 0, at(MO, 20)),
    imported(DI, 120),
    submitted(DO, 150, at(DO, 20)),
  ]);
  const week = weekView(inputs, at(FR, 21));
  assert.deepEqual(
    week.days.map((d) => d.state),
    ["submitted", "imported", "open", "full", "open"],
  );
  assert.equal(GAME_TEXT.weekDayAria(MO, "full"), "Montag: volle Runde");
  assert.equal(GAME_TEXT.weekDayAria(DI, "submitted"), "Dienstag: eingereicht");
  assert.equal(GAME_TEXT.weekDayAria(MI, "open"), "Mittwoch: offen");
  assert.equal(GAME_TEXT.weekDayAria(DO, "paused"), "Donnerstag: Pause");
});

test("Vorschlag: Marke mal Call-Tage (höchstens 5), auf 50 gerundet, Grenze bei der Hälfte", () => {
  const D = "2026-10-06";
  const hundred = basis(D, [100, 100, 100]);
  const suggestion = (goal: number | null, days: number[], entries = hundred, now = at(D, 12)) =>
    weekView(game(entries, { goal, days }), now).suggestion;
  assert.deepEqual(suggestion(100, [1, 2, 3, 4, 5]), { value: 500 });
  assert.equal(suggestion(250, [1, 2, 3, 4, 5]), null);
  assert.deepEqual(suggestion(100, [0, 1, 2, 3, 4, 5, 6]), { value: 500 });
  assert.deepEqual(suggestion(100, [1, 3, 5]), { value: 300 });
  assert.equal(suggestion(100, [0, 6]), null);
  assert.equal(suggestion(null, [1, 2, 3, 4, 5]), null);
  // 75 mal 3 = 225, gerundet 250.
  assert.deepEqual(suggestion(100, [1, 2, 3], basis(D, [75, 75, 75])), { value: 250 });
  // Am Wochenende gilt die zuletzt gültige Marke.
  assert.deepEqual(suggestion(100, [1, 2, 3, 4, 5], basis("2026-10-09", [100, 100, 100]), at("2026-10-10", 12)), {
    value: 500,
  });
});

test("Ganz pausierte Woche: kein Balken, nur ein Satz", () => {
  const inputs = game(basis("2026-10-05", [100, 100, 100]), {
    goal: 500,
    pauses: [{ from: "2026-10-05", to: "2026-10-09" }],
  });
  const week = weekView(inputs, at("2026-10-06", 12));
  assert.equal(week.paused, true);
  assert.ok(week.days.every((d) => d.state === "paused"));
  assert.equal(GAME_TEXT.weekPaused, "Diese Woche ist pausiert.");
});

// ---------------------------------------------------------------------------
// 6. Gemeinsames Wochenziel aller Anwahlen

test("communityGoalFor: Teamwert nach from, neuester gültiger Eintrag, gleicher Montag ersetzt", () => {
  const settings = {
    goals: [
      { from: "2026-09-28", attempts: 6000 },
      { from: "2026-10-05", attempts: 7000 },
      { from: "2026-10-05", attempts: 8000 },
      { from: "2026-10-06", attempts: 9000 },
      { from: "2026-10-12", attempts: 300 },
    ],
  };
  assert.deepEqual(communityGoalFor("2026-10-05", settings, []), { goal: 8000, auto: false });
  assert.deepEqual(communityGoalFor("2026-09-28", settings, []), { goal: 6000, auto: false });
  // Ungültige Einträge (kein Montag, unter 500) fallen weg.
  assert.deepEqual(communityGoalFor("2026-10-12", settings, []), { goal: 8000, auto: false });
  assert.deepEqual(communityGoalFor("2026-09-21", settings, []), { goal: 1000, auto: true });
  // Ein leerer Eintrag heißt: ab diesem Montag automatisch; frühere Wochen behalten ihr Ziel.
  const cleared = { goals: [{ from: "2026-09-28", attempts: 6000 }, { from: "2026-10-05", attempts: null }] };
  const sums = [{ weekStart: "2026-09-28", attempts: 4000 }];
  assert.deepEqual(communityGoalFor("2026-09-28", cleared, sums), { goal: 6000, auto: false });
  assert.deepEqual(communityGoalFor("2026-10-05", cleared, sums), { goal: 4000, auto: true });
  assert.deepEqual(communityGoalFor("2026-10-12", cleared, sums), { goal: 4000, auto: true });
});

test("communityGoalFor: Schnitt der 4 Wochen davor, abgerundet auf 500, mindestens 1.000", () => {
  const week = "2026-10-05";
  const sums = (values: number[]) => values.map((attempts, i) => ({ weekStart: addDays(week, -7 * (i + 1)), attempts }));
  assert.deepEqual(communityGoalFor(week, null, sums([5200, 6100, 5900, 4800])), { goal: 5500, auto: true });
  assert.deepEqual(communityGoalFor(week, null, sums([2600, 2700])), { goal: 2500, auto: true });
  assert.deepEqual(communityGoalFor(week, null, sums([1200])), { goal: 1000, auto: true });
  assert.deepEqual(communityGoalFor(week, null, []), { goal: 1000, auto: true });
  // Die fünfte Woche davor zählt nicht mehr.
  assert.deepEqual(communityGoalFor(week, null, sums([5000, 5000, 5000, 5000, 100000])), { goal: 5000, auto: true });
  // Nach einer schwachen Woche bleibt es erreichbar: höchstens das 1,2-Fache
  // der Vorwoche, auf 500 gerundet (Schnitt 3.500 wegen eines Ausreißers).
  assert.deepEqual(communityGoalFor(week, null, sums([1560, 6969, 2895, 4235])), { goal: 2000, auto: true });
  // Ohne Meldungen in der Vorwoche gilt nur der Schnitt.
  assert.deepEqual(
    communityGoalFor(week, null, [{ weekStart: addDays(week, -14), attempts: 3000 }]),
    { goal: 3000, auto: true },
  );
});

test("communityWeek: gemeinsame Meldung genau einmal, Importe zählen, Dabei ohne joint und 0-Tage", () => {
  const rows: CommunityRow[] = [
    { participant: "a", kind: "person", day: "2026-09-30", counts: { attempts: 100 } },
    { participant: "a", kind: "person", day: "2026-10-01", counts: { attempts: 50 } },
    { participant: "b", kind: "person", day: "2026-10-04", counts: { attempts: 0 } },
    { participant: "duo", kind: "joint", day: "2026-10-02", counts: { attempts: 222 } },
    { participant: "c", kind: "person", day: "2026-10-05", counts: { attempts: 999 } },
  ];
  assert.deepEqual(communityWeek(rows, "2026-09-28"), {
    weekStart: "2026-09-28",
    attempts: 372,
    reported: true,
    people: 1,
  });
  assert.deepEqual(communityWeek(rows, "2026-09-21"), {
    weekStart: "2026-09-21",
    attempts: 0,
    reported: false,
    people: 0,
  });
});

test("communityView: Vorwoche nur Montag bis Mittwoch, mit dem Ziel der Vorwoche", () => {
  const rows: CommunityRow[] = [
    { participant: "a", kind: "person", day: "2026-09-29", counts: { attempts: 6140 } },
    { participant: "a", kind: "person", day: "2026-10-06", counts: { attempts: 4230 } },
    { participant: "b", kind: "person", day: "2026-10-07", counts: { attempts: 0 } },
  ];
  const settings = { goals: [{ from: "2026-09-28", attempts: 6000 }, { from: "2026-10-05", attempts: 7000 }] };
  assert.deepEqual(communityView(rows, "2026-10-07", settings), {
    weekStart: "2026-10-05",
    attempts: 4230,
    goal: 7000,
    auto: false,
    reached: false,
    people: 1,
    lastWeek: { attempts: 6140, goal: 6000, reached: true },
  });
  assert.equal(communityView(rows, "2026-10-08", settings).lastWeek, null);
  // Ohne Teamwert: automatisch aus der Woche davor.
  const auto = communityView(rows, "2026-10-06", null);
  assert.equal(auto.goal, 6000);
  assert.equal(auto.auto, true);
  assert.deepEqual(auto.lastWeek, { attempts: 6140, goal: 1000, reached: true });
});

// ---------------------------------------------------------------------------
// Texte: wörtlich aus dem Plan, Sprachregel für alle exportierten Texte

const NOW = at("2026-10-06", 12);
const SAMPLES: Record<string, unknown[][]> = {
  markValue: [[100]],
  closingDue: [[at("2026-10-07", 10).toISOString(), TZ, NOW], [at("2026-10-06", 10).toISOString(), TZ, at("2026-10-06", 8)]],
  markResult: [[120, 100, false], [80, 100, false], [120, 100, true], [null, 100, false]],
  otherDayInTitle: [["Montag"]],
  comebackPauseText: [[7], [0]],
  markToday: [[100]],
  streakShort: [[7]],
  streakAria: [[7], [1]],
  streakDays: [[7], [1]],
  streakAtRisk: [[{ day: FR, deadline: at("2026-10-05", 10).toISOString() }, TZ, at("2026-10-03", 12)]],
  streakPaused: [[7]],
  nextEtappe: [[10, 7], [10, 9]],
  nextEtappeShort: [[10]],
  allEtappen: [[112]],
  streakBest: [[8]],
  levelUp: [[["Anwahlen auf Level 3"]], [["Anwahlen auf Level 3", "Settings auf Level 2"]]],
  weekGoalReached: [[520, 500]],
  placeJump: [["Oktober", 9, 6]],
  placePodium: [["Oktober", 3]],
  placeLead: [["Oktober"]],
  placeNew: [["Oktober", 14]],
  nextWeek: [[180]],
  nextEtappeStep: [[10, 9], [10, 5]],
  numbersLine: [
    [{ attempts: 127, settingsBooked: 4, closingsBooked: 1, dealsWon: 0 }],
    [{ attempts: 1, settingsBooked: 1, closingsBooked: 2, dealsWon: 1 }],
    [{ attempts: null }],
  ],
  announcement: [
    ["Dein Tag ist drin.", { attempts: 214, mark: 100, markReached: true }, 8, [{ title: "Neuer Bestwert: 214 Anwahlen an einem Tag." }]],
    ["Dein Tag ist drin.", { attempts: 80, mark: 100, markReached: false }, 0, []],
  ],
  bestWeekDate: [["2026-09-28"]],
  differs: [["attempts", 80], ["settingsBooked", 1]],
  newDayBest: [["attempts", 214]],
  bestBefore: [[180, "2026-09-22"]],
  bestBeforeValue: [[1980]],
  newDayBests: [[[{ metric: "closingsBooked", value: 2 }, { metric: "settingsBooked", value: 4 }]]],
  newWeekBest: [[612]],
  newMonthBest: [[2140]],
  plausibilitySettings: [[12, 8]],
  plausibilityOutlier: [[450, 120]],
  weekProgress: [[312, 500]],
  weekRemaining: [[188]],
  weekReached: [[540, 500]],
  fullRounds: [[0], [1], [2]],
  weekDayAria: [["2026-10-05", "full"], ["2026-10-06", "imported"]],
  suggestion: [[100, 500]],
  communityProgress: [[4230, 6000]],
  communityRemaining: [[1770]],
  communityReached: [[6140, 6000, 17], [6140, 6000, 1], [6140, 6000, 0]],
  communityLastWeek: [[6140, 6000, true], [5200, 6000, false]],
  communityAria: [[4230, 6000]],
  communityAdminAuto: [[5500]],
};
type TextFn = (...args: unknown[]) => string;
const call = (name: string, args: unknown[]) =>
  ((GAME_TEXT as unknown as Record<string, TextFn>)[name])(...args);

/** Alle Texte aus GAME_TEXT: feste Zeichenketten und jede Funktion mit Beispielen. */
function allTexts() {
  const out: string[] = [];
  const walk = (value: unknown, name: string) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      assert.ok(SAMPLES[name], `Beispiel für GAME_TEXT.${name} fehlt`);
      for (const args of SAMPLES[name]) out.push(call(name, args));
    } else if (value && typeof value === "object")
      for (const inner of Object.values(value)) walk(inner, name);
  };
  for (const [name, value] of Object.entries(GAME_TEXT)) walk(value, name);
  return out;
}

test("Texte wörtlich aus dem Plan", () => {
  const t = GAME_TEXT;
  assert.equal(t.mark, "Tagesmarke");
  assert.equal(t.markValue(100), "100 Anwahlen");
  assert.equal(call("closingDue", SAMPLES.closingDue[0]), "Abschluss bis morgen 10:00 Uhr");
  assert.equal(t.markResult(120, 100, false), "Tagesmarke geschafft: 120 von 100 Anwahlen");
  assert.equal(t.markResult(80, 100, false), "Tagesmarke: 80 von 100 Anwahlen");
  assert.equal(t.markResult(120, 100, true), "Tagesmarke geschafft: 120 von 100 Anwahlen, übernommen");
  assert.equal(t.fullRoundTitle, "Volle Runde. Dein Tag ist drin.");
  assert.equal(t.fullRound, "Volle Runde");
  assert.equal(t.comebackPauseText(7), "Heute reicht: 50 Anwahlen und dein Abschluss. Deine Serie wartet bei 7.");
  assert.equal(t.comebackPauseText(0), "Heute reicht: 50 Anwahlen und dein Abschluss.");
  assert.equal(t.markToday(100), "Tagesmarke heute: 100 Anwahlen");
  assert.equal(t.streakShort(7), "Serie 7");
  assert.equal(t.streakAria(7), "Serie: 7 Tage");
  assert.equal(call("streakAtRisk", SAMPLES.streakAtRisk[0]), "Deine Serie hängt an Freitag. Bis Mo. 10:00 Uhr.");
  assert.equal(t.streakPaused(7), "Pause: deine Serie wartet bei 7.");
  assert.equal(t.nextEtappe(10, 7), "Nächste Etappe: 10 Tage. Noch 3 rechtzeitige Abschlüsse.");
  assert.equal(t.allEtappen(112), "Alle Etappen geschafft. Bestwert 112.");
  assert.equal(`${t.etappe[5][0]} ${t.etappe[5][1]}`, "5 Tage Serie. Eine ganze Calling-Woche, jeder Tag rechtzeitig.");
  assert.equal(`${t.etappe[100][0]} ${t.etappe[100][1]}`, "100 Tage Serie. Das ist Dranbleiben.");
  assert.equal(t.streakBest(8), "Neuer Bestwert in deiner Serie: 8 Tage.");
  assert.equal(t.levelUp(["Anwahlen auf Level 3", "Settings auf Level 2"]), "Neues Leistungslevel: Anwahlen auf Level 3, Settings auf Level 2.");
  assert.equal(t.weekGoalReached(520, 500), "Wochenziel geschafft: 520 von 500 Anwahlen.");
  assert.equal(t.placeJump("Oktober", 9, 6), "Dein Tag hat dich im Oktober von Platz 9 auf Platz 6 gebracht.");
  assert.equal(t.nextWeek(180), "Als Nächstes: Diese Woche noch 180 Anwahlen bis zu deinem Wochenziel.");
  assert.equal(t.numbersLine({ attempts: 127, settingsBooked: 4, closingsBooked: 1, dealsWon: 0 }), "127 Anwahlen · 4 Settings · 1 Closing");
  assert.equal(t.numbersLine({ attempts: 127, settingsBooked: 4, closingsBooked: 1, dealsWon: 1 }), "127 Anwahlen · 4 Settings · 1 Closing · 1 Deal");
  assert.equal(t.numbersLine({ attempts: null, settingsBooked: null }), "");
  assert.equal(call("announcement", SAMPLES.announcement[0]), "Dein Tag ist drin. Tagesmarke geschafft. Serie 8. Neuer Bestwert: 214 Anwahlen an einem Tag.");
  assert.equal(`${t.newDayBest("attempts", 214)} ${t.bestBefore(180, "2026-09-22")}`, "Neuer Bestwert: 214 Anwahlen an einem Tag. Bisher 180 am 22.09.");
  assert.equal(`${t.newWeekBest(612)} ${t.bestBeforeValue(540)}`, "Beste Woche bisher: 612 Anwahlen. Bisher 540.");
  assert.equal(`${t.newMonthBest(2140)} ${t.bestBeforeValue(1980)}`, "Bester Monat bisher: 2.140 Anwahlen. Bisher 1.980.");
  assert.equal(t.differs("attempts", 80), "Nach der Frist erhöht: Für Tagesmarke und Bestwerte zählen 80 Anwahlen.");
  assert.equal(t.plausibilityOutlier(450, 120), "Kurz prüfen: 450 Anwahlen. Sonst sind es bei dir meist etwa 120. Stimmt das so?");
  assert.equal(t.weekProgress(312, 500), "312 von 500 Anwahlen");
  assert.equal(t.fullRounds(2), "2 volle Runden diese Woche");
  assert.equal(t.fullRounds(0), "Noch keine volle Runde diese Woche");
  assert.equal(t.suggestion(100, 500), "Dein Wochenziel liegt bei 100 Anwahlen. Mit deiner Tagesmarke passen eher 500.");
  assert.equal(t.communityProgress(4230, 6000), "4.230 von 6.000 Anwahlen");
  assert.equal(t.communityRemaining(1770), "Noch 1.770 Anwahlen bis Sonntag");
  assert.equal(t.communityReached(6140, 6000, 17), "Geschafft: 6.140 von 6.000 Anwahlen. 17 Caller sind dabei.");
  assert.equal(t.communityLastWeek(6140, 6000, true), "Letzte Woche geschafft: 6.140 von 6.000 Anwahlen.");
  assert.equal(t.communityLastWeek(5200, 6000, false), "Letzte Woche: 5.200 von 6.000 Anwahlen.");
  assert.equal(t.communityAria(4230, 6000), "Gemeinsames Wochenziel: 4.230 von 6.000 Anwahlen, 71 Prozent.");
  assert.equal(t.communityAdminAuto(5500), "Automatisch diese Woche: 5.500");
});

test("Sprachregel: keine Punkte-Sprache, keine Gedankenstriche in allen Texten aus lib/game.ts", () => {
  const D = "2026-10-09";
  const { before, after, now } = weekScenario(D, 300);
  const generated = [
    ...gameMoments({ before, after, day: D, firstSubmission: true, participantId: "me", now }).highlights.flatMap(
      (h) => [h.title, h.detail],
    ),
    ...bestRows(personalBests(after), D).flatMap((r) => [r.label, r.date]),
    plausibilityHint({ attempts: 8, settingsBooked: 12 }, [])!.text,
  ];
  const texts = [...allTexts(), ...generated];
  assert.ok(texts.length > 100);
  for (const text of texts) {
    assert.doesNotMatch(text, /\bXP\b|Erfahrungspunkt|Punkte/, text);
    assert.doesNotMatch(text, /—|–|--/, text);
    assert.doesNotMatch(text, /kostenlos|WhatsApp|DealUno|Wertung|Gewicht/i, text);
  }
  // Etappen-Texte gibt es für jede Etappe.
  for (const n of ETAPPEN) assert.ok(GAME_TEXT.etappe[n][0].startsWith(`${n} Tage Serie.`));
  assert.deepEqual([...BEST_METRICS], ["attempts", "settingsBooked", "closingsBooked", "dealsWon"]);
});

test("Statischer Test: das Formular importiert aus lib/game nur plausibilityHint", async () => {
  const source = await readFile(new URL("../app/features/closing-form.tsx", import.meta.url), "utf8");
  const fromGame = [...source.matchAll(/\b(?:import|export)\s+(?:type\s+)?([^;'"]*?)\s+from\s*["']([^"']+)["']/g)].filter(
    (m) => /(^|\/)lib\/game(\.ts)?$/.test(m[2]),
  );
  const names = fromGame.flatMap((m) =>
    m[1]
      .replace(/[{}]/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
      .filter(Boolean),
  );
  assert.ok(names.every((name) => name === "plausibilityHint"), names.join(", "));
  assert.doesNotMatch(source, /(?:import|require)\(\s*["'][^"']*lib\/game["']/);
});
