import { test } from "node:test";
import assert from "node:assert/strict";
import { activeCaller } from "../lib/active-caller";

// 21.09.2026 ist ein Montag. Calling-Tage Mo bis Fr.
const settings = { callingWeekdays: [1, 2, 3, 4, 5] };
const run = (attempts: Record<string, number>, today: string, pauses: { from: string; to: string }[] = []) =>
  activeCaller({ attempts, today, settings, pauses });

test("five calling days in a row with at least 50 dials unlock the rank", () => {
  const four = { "2026-09-21": 50, "2026-09-22": 80, "2026-09-23": 60, "2026-09-24": 55 };
  assert.equal(run(four, "2026-09-24").active, false);
  assert.equal(run(four, "2026-09-24").run, 4);
  const five = { ...four, "2026-09-25": 50 };
  const r = run(five, "2026-09-25");
  assert.equal(r.active, true);
  assert.equal(r.since, "2026-09-25");
});

test("a calling day below 50 resets the count; weekends and pauses do not break it", () => {
  // 49 am Mittwoch setzt zurück.
  assert.equal(run({ "2026-09-21": 60, "2026-09-22": 60, "2026-09-23": 49, "2026-09-24": 60, "2026-09-25": 60 }, "2026-09-25").run, 2);
  // Do, Fr, (Wochenende frei), Mo, Di, Mi: freigeschaltet.
  const weekend = { "2026-09-24": 50, "2026-09-25": 50, "2026-09-28": 50, "2026-09-29": 50, "2026-09-30": 50 };
  assert.equal(run(weekend, "2026-09-30").active, true);
  // Bestätigte Pause am Mittwoch unterbricht nicht.
  const paused = { "2026-09-21": 50, "2026-09-22": 50, "2026-09-24": 50, "2026-09-25": 50, "2026-09-28": 50 };
  assert.equal(run(paused, "2026-09-28", [{ from: "2026-09-23", to: "2026-09-23" }]).active, true);
  assert.equal(run(paused, "2026-09-28").active, false);
});

test("today never hurts while it is still open", () => {
  const four = { "2026-09-21": 50, "2026-09-22": 50, "2026-09-23": 50, "2026-09-24": 50 };
  const r = run(four, "2026-09-25");
  assert.equal(r.run, 4);
  assert.equal(r.idle, 0);
});

test("three calling days in a row without any dials lose the rank; a few dials keep it", () => {
  const unlocked = { "2026-09-21": 50, "2026-09-22": 50, "2026-09-23": 50, "2026-09-24": 50, "2026-09-25": 50 };
  // Mo, Di ohne Anwahlen, Mi 10 Anwahlen, Do, Fr ohne: nie drei in Folge.
  const kept = run({ ...unlocked, "2026-09-30": 10 }, "2026-10-03");
  assert.equal(kept.active, true);
  assert.equal(kept.idle, 2);
  // Mo, Di, Mi ohne Anwahlen: weg.
  const lost = run(unlocked, "2026-10-01");
  assert.equal(lost.active, false);
  assert.equal(lost.lostAt, "2026-09-30");
  // Danach wieder fünf Tage am Stück nötig.
  const back = { ...unlocked, "2026-10-01": 50, "2026-10-02": 50, "2026-10-05": 50, "2026-10-06": 50 };
  assert.equal(run(back, "2026-10-06").active, false);
  assert.equal(run({ ...back, "2026-10-07": 50 }, "2026-10-07").active, true);
});

test("no numbers at all: nothing unlocked, nothing lost", () => {
  assert.deepEqual(run({}, "2026-09-23"), { active: false, since: null, run: 0, idle: 0, lostAt: null });
});
