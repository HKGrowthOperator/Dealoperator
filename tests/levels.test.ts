import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCounts, progress, tracks, type Counts } from "../lib/kpis";
import { focusTrack, levelCard, levelGoal, levelName } from "../lib/levels";

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

test("no numbers yet: progress in real units towards level 1", () => {
  for (const values of [
    {},
    { attempts: 0, settingsBooked: 0, closingsBooked: 0, dealsWon: 0 },
  ]) {
    const c = byId(values);
    assert.deepEqual(
      Object.values(c).map((x) => [x.title, x.progressText, x.remainingText, x.percent]),
      [
        ["Noch kein Level", "0 von 100 Anwahlen", "Noch 100 Anwahlen bis Level 1", 0],
        ["Noch kein Level", "0 von 5 Settings", "Noch 5 Settings bis Level 1", 0],
        ["Noch kein Level", "0 von 3 Closings", "Noch 3 Closings bis Level 1", 0],
        ["Noch kein Level", "0 von 1 Deal", "Noch 1 Deal bis Level 1", 0],
      ],
    );
    assert.equal(c.dialer.goal, "Level 1 ab 100 Anwahlen");
    assert.equal(c.setter.goal, "Level 1 ab 5 Settings");
    assert.equal(c.closer.goal, "Level 1 ab 3 Closings");
    assert.equal(c["deal-maker"].goal, "Level 1 nach dem ersten Deal");
  }
});

test("partial progress: every unit counts, bar matches the ratio", () => {
  const c = byId({ attempts: 40, settingsBooked: 3, closingsBooked: 1 });
  assert.equal(c.dialer.progressText, "40 von 100 Anwahlen");
  assert.equal(c.dialer.remainingText, "Noch 60 Anwahlen bis Level 1");
  assert.equal(c.dialer.percent, 40);
  assert.equal(c.dialer.title, "Noch kein Level");
  assert.equal(c.setter.progressText, "3 von 5 Settings");
  assert.equal(c.setter.remainingText, "Noch 2 Settings bis Level 1");
  assert.equal(c.setter.percent, 60);
  assert.equal(c.closer.remainingText, "Noch 2 Closings bis Level 1");
  assert.equal(c.dialer.barLabel, "Anwahlen: Fortschritt bis Level 1");
  assert.equal(byId({ attempts: 99 }).dialer.remainingText, "Noch 1 Anwahl bis Level 1");
});

test("reaching a threshold unlocks the level and names the next one", () => {
  const c = byId({
    attempts: 146,
    settingsBooked: 5,
    closingsBooked: 3,
    dealsWon: 1,
  });
  assert.deepEqual(
    Object.values(c).map((x) => [x.level, x.title, x.goal, x.progressText]),
    [
      [1, "Level 1", "Level 2 ab 500 Anwahlen", "146 von 500 Anwahlen"],
      [1, "Level 1", "Level 2 ab 20 Settings", "5 von 20 Settings"],
      [1, "Level 1", "Level 2 ab 10 Closings", "3 von 10 Closings"],
      [1, "Level 1", "Level 2 ab 5 Deals", "1 von 5 Deals"],
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
  assert.equal(byId({ attempts: 3120 }).dialer.goal, "Level 4 ab 5.000 Anwahlen");
  assert.equal(byId({ attempts: 3120 }).dialer.progressText, "3.120 von 5.000 Anwahlen");
  assert.equal(
    byId({ attempts: 3120 }).dialer.remainingText,
    "Noch 1.880 Anwahlen bis Level 4",
  );
});

test("highest level: full bar, no next goal", () => {
  const c = byId({ attempts: 15230, dealsWon: 150 });
  assert.equal(c.dialer.level, 5);
  assert.equal(c.dialer.title, "Level 5");
  assert.equal(c.dialer.maxed, true);
  assert.equal(c.dialer.goal, "Höchstes Level erreicht");
  assert.equal(c.dialer.progressText, "15.230 Anwahlen");
  assert.equal(c.dialer.remainingText, "Höchstes Level erreicht");
  assert.equal(c.dialer.percent, 100);
  assert.equal(c["deal-maker"].title, "Level 5");
});

test("texts never talk about points or XP", () => {
  for (const values of [{}, { attempts: 40, settingsBooked: 3 }, { attempts: 15230 }])
    for (const card of cards(values))
      for (const text of [card.goal, card.progressText, card.remainingText, card.barLabel])
        assert.doesNotMatch(text, /\bXP\b|Erfahrungspunkt|Punkte/);
});

test("the compact view focuses the track closest to its next level", () => {
  assert.equal(focusTrack(cards({ attempts: 40, settingsBooked: 4 })).id, "setter");
  assert.equal(focusTrack(cards({})).id, "dialer");
  assert.equal(focusTrack(cards({ attempts: 90 })).id, "dialer");
});

test("names and goals read as whole German phrases", () => {
  assert.equal(levelName(0), "Noch kein Level");
  assert.equal(levelName(2), "Level 2");
  assert.equal(levelGoal("dialer", 1, 100), "Level 1 ab 100 Anwahlen");
  assert.equal(levelGoal("setter", 1, 5), "Level 1 ab 5 Settings");
  assert.equal(levelGoal("closer", 1, 3), "Level 1 ab 3 Closings");
  assert.equal(levelGoal("deal-maker", 1, 1), "Level 1 nach dem ersten Deal");
});
