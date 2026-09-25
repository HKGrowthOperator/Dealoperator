import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCounts, placed, scoreOf, type Counts, type RankingRow } from "../lib/kpis";
import { summarizeRankingMonth } from "../lib/ranking-history";

const counts = (extra: Partial<Counts>): Counts => ({ ...emptyCounts(), ...extra });
const row = (id: string, extra: Partial<Counts>, kind: "person" | "joint" = "person"): RankingRow => ({
  id,
  key: id,
  name: id,
  company: "",
  role: "",
  kind,
  claimed: false,
  counts: counts(extra),
  source: "test",
  updatedAt: "2026-09-25T10:00:00Z",
});

test("the hidden score weighs deals, closings, settings and calls; 100 calls add a bonus", () => {
  assert.equal(scoreOf(counts({})), 0);
  assert.equal(scoreOf(counts({ attempts: 24, closingsBooked: 2 })), 24 + 10);
  assert.equal(scoreOf(counts({ attempts: 30 })), 30);
  assert.equal(scoreOf(counts({ settingsBooked: 3, dealsWon: 1 })), 9 + 10);
  // Der Bonus gilt genau ab 100 Anwahlen, nicht darunter.
  assert.equal(scoreOf(counts({ attempts: 99 })), 99);
  assert.equal(scoreOf(counts({ attempts: 100 })), 115);
  assert.equal(scoreOf(counts({ attempts: 127, settingsBooked: 4 })), 127 + 12 + 15);
  // Nicht gewertete Kennzahlen ändern nichts.
  assert.equal(scoreOf(counts({ settingsHeld: 5, closingsHeld: 2, legacyMeetings: 9 })), 0);
});

test("placement follows the score, shares places on ties, keeps every reporter and leaves joint reports out", () => {
  const rows = [
    row("derrien", { attempts: 30 }),
    row("florian", { attempts: 24, closingsBooked: 2 }),
    row("ben", { attempts: 20 }),
    row("nick", { attempts: 127, settingsBooked: 4 }),
    row("tie-a", { attempts: 10, settingsBooked: 5 }), // 25
    row("tie-b", { attempts: 25 }), // 25
    row("duo", { attempts: 999 }, "joint"),
    row("nothing", {}),
    row("only-held", { settingsHeld: 3 }),
  ];
  const result = placed(rows);
  assert.deepEqual(
    result.map((r) => [r.id, r.rank]),
    [
      ["nick", 1],
      ["florian", 2],
      ["derrien", 3],
      ["tie-a", 4],
      ["tie-b", 4],
      ["ben", 6],
      // Nur durchgeführte Termine gemeldet: dabei, aber mit Wertung 0 am Ende.
      ["only-held", 7],
    ],
  );
  assert.ok(result.every((r) => typeof r.score === "number"));
});

test("a month sums the daily scores, with the bonus per day, and names the day's top by score", () => {
  const records = [
    { ...row("a", { attempts: 100 }), day: "2026-09-21" }, // 115
    { ...row("a", { attempts: 60 }), day: "2026-09-22" }, // 60
    { ...row("b", { attempts: 80, closingsBooked: 4 }), day: "2026-09-21" }, // 100
    { ...row("b", { attempts: 80 }), day: "2026-09-22" }, // 80
    { ...row("duo", { attempts: 500 }, "joint"), day: "2026-09-22" },
  ];
  const month = summarizeRankingMonth(records, "2026-09");
  const a = month.rows.find((r) => r.id === "a")!;
  const b = month.rows.find((r) => r.id === "b")!;
  // 160 Anwahlen über den Monat geben keinen zweiten Bonus: 115 + 60.
  assert.equal(a.score, 175);
  assert.equal(b.score, 180);
  assert.deepEqual(placed(month.rows).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(month.days.map((d) => d.top?.people.map((p) => p.id)), [["a"], ["b"]]);
  // Der Tagessieg nach Anwahlen bleibt getrennt davon.
  assert.deepEqual(month.days[0].leaders.attempts?.people.map((p) => p.id), ["a"]);
  const day = summarizeRankingMonth(records, "2026-09", "2026-09-22");
  assert.equal(day.rows.find((r) => r.id === "a")!.score, 60);
});
