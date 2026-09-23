import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCounts, progress, tracks, type Counts } from "../lib/kpis";
import { levelCard, levelGoal, levelName } from "../lib/levels";

const cards = (values: Partial<Counts>) =>
  progress({ ...emptyCounts(), ...values }).map(levelCard);
const byId = (values: Partial<Counts>) =>
  Object.fromEntries(cards(values).map((c) => [c.id, c]));

test("first level thresholds are 100 / 5 / 3 / 1", () => {
  assert.deepEqual(
    tracks.map((t) => [t.id, t.thresholds[0]]),
    [
      ["dialer", 100],
      ["setter", 5],
      ["closer", 3],
      ["deal-maker", 1],
    ],
  );
});

test("no numbers yet: no level, 0 XP, first-level goal per card", () => {
  for (const values of [
    {},
    { attempts: 0, settingsBooked: 0, closingsBooked: 0, dealsWon: 0 },
  ]) {
    const c = byId(values);
    assert.deepEqual(
      Object.values(c).map((x) => [x.title, x.xpText, x.percent]),
      [
        ["Noch kein Level", "0 / 100 XP", 0],
        ["Noch kein Level", "0 / 5 XP", 0],
        ["Noch kein Level", "0 / 3 XP", 0],
        ["Noch kein Level", "0 / 1 XP", 0],
      ],
    );
    assert.equal(c.dialer.goal, "Level 1 ab 100 Anwahlen");
    assert.equal(c.setter.goal, "Level 1 ab 5 gelegten Settings");
    assert.equal(c.closer.goal, "Level 1 ab 3 gelegten Closings");
    assert.equal(c["deal-maker"].goal, "Level 1 nach dem ersten Deal");
  }
});

test("partial progress: XP counts every unit, bar matches the XP ratio", () => {
  const c = byId({ attempts: 40, settingsBooked: 3, closingsBooked: 1 });
  assert.equal(c.dialer.xpText, "40 / 100 XP");
  assert.equal(c.dialer.percent, 40);
  assert.equal(c.dialer.title, "Noch kein Level");
  assert.equal(c.setter.xpText, "3 / 5 XP");
  assert.equal(c.setter.percent, 60);
  assert.equal(c.closer.xpText, "1 / 3 XP");
  assert.equal(c.dialer.barText, "40 von 100 XP");
  assert.equal(c.dialer.barLabel, "Dialer: XP bis Level 1");
});

test("reaching a threshold unlocks the level and names the next one", () => {
  const c = byId({
    attempts: 146,
    settingsBooked: 5,
    closingsBooked: 3,
    dealsWon: 1,
  });
  assert.deepEqual(
    Object.values(c).map((x) => [x.level, x.title, x.goal, x.xpText]),
    [
      [1, "Level 1", "Level 2 ab 500 Anwahlen", "146 / 500 XP"],
      [1, "Level 1", "Level 2 ab 20 gelegten Settings", "5 / 20 XP"],
      [1, "Level 1", "Level 2 ab 10 gelegten Closings", "3 / 10 XP"],
      [1, "Level 1", "Level 2 ab 5 Deals", "1 / 5 XP"],
    ],
  );
  assert.equal(byId({ settingsBooked: 4 }).setter.level, 0);
});

test("every threshold is exactly one level, thousands use German separators", () => {
  for (const t of tracks)
    t.thresholds.forEach((threshold, i) => {
      const at = progress({ ...emptyCounts(), [t.metric]: threshold }).find(
        (x) => x.id === t.id,
      )!;
      const below = progress({
        ...emptyCounts(),
        [t.metric]: threshold - 1,
      }).find((x) => x.id === t.id)!;
      assert.equal(at.level, i + 1, `${t.id} at ${threshold}`);
      assert.equal(below.level, i, `${t.id} below ${threshold}`);
    });
  assert.equal(
    byId({ attempts: 3120 }).dialer.goal,
    "Level 4 ab 5.000 Anwahlen",
  );
  assert.equal(byId({ attempts: 3120 }).dialer.xpText, "3.120 / 5.000 XP");
});

test("highest level: full bar, no next goal", () => {
  const c = byId({ attempts: 15230, dealsWon: 150 });
  assert.equal(c.dialer.level, 5);
  assert.equal(c.dialer.title, "Level 5");
  assert.equal(c.dialer.maxed, true);
  assert.equal(c.dialer.goal, "Höchstes Level erreicht");
  assert.equal(c.dialer.xpText, "15.230 XP");
  assert.equal(c.dialer.percent, 100);
  assert.equal(c["deal-maker"].title, "Level 5");
});

test("names and goals read as whole German phrases", () => {
  assert.equal(levelName(0), "Noch kein Level");
  assert.equal(levelName(2), "Level 2");
  assert.equal(levelGoal("dialer", 1, 100), "Level 1 ab 100 Anwahlen");
  assert.equal(levelGoal("setter", 1, 5), "Level 1 ab 5 gelegten Settings");
  assert.equal(levelGoal("closer", 1, 3), "Level 1 ab 3 gelegten Closings");
  assert.equal(levelGoal("deal-maker", 1, 1), "Level 1 nach dem ersten Deal");
  assert.deepEqual(
    cards({}).map((c) => c.xpUnit),
    [
      "1 XP = 1 Anwahl",
      "1 XP = 1 gelegtes Setting",
      "1 XP = 1 gelegtes Closing",
      "1 XP = 1 Deal",
    ],
  );
});
