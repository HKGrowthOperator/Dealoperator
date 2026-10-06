import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import {
  communitySettingsSchema,
  loadCommunitySettings,
  saveCommunitySettings,
} from "../server/settings";
import { communityGoalState, communityWeekState } from "../server/game";
import { GET } from "../app/api/ranking/week/route";
import { addDays } from "../lib/commitment";
import { berlinDate, emptyCounts } from "../lib/kpis";
import { weekStartOf } from "../lib/game";

// Gemeinsames Wochenziel: Einstellungen 'community', Summe der Woche und die
// öffentliche Route. Fiktive Namen; 2026-03-11 ist ein Mittwoch.
let pg: PGlite, db: Database;

before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as unknown as Executor, (fn) => pg.transaction((tx) => fn(new Database(tx as unknown as Executor))));
});
beforeEach(async () => {
  await pg.exec("TRUNCATE participants,app_settings CASCADE");
});
after(async () => {
  await pg.close();
});

async function person(id: string, name: string, kind = "person") {
  await db.query("INSERT INTO participants(id,name,kind) VALUES($1,$2,$3)", [id, name, kind]);
}
async function reported(participant: string, day: string, attempts: number | null) {
  await db.query(
    "INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,$2,$3::jsonb,'owner-import','import')",
    [participant, day, JSON.stringify({ ...emptyCounts(), attempts })],
  );
}

test("schema: a Monday, 500 to 200.000 Anwahlen, at most 26 entries, nothing else", () => {
  const ok = (value: unknown) => communitySettingsSchema.safeParse(value).success;
  assert.equal(ok({ goals: [] }), true);
  assert.equal(ok({ goals: [{ from: "2026-09-28", attempts: 6000 }] }), true);
  assert.equal(ok({ goals: [{ from: "2026-09-28", attempts: 500 }] }), true);
  assert.equal(ok({ goals: [{ from: "2026-09-28", attempts: 200000 }] }), true);
  assert.equal(ok({ goals: [{ from: "2026-09-28", attempts: 499 }] }), false);
  assert.equal(ok({ goals: [{ from: "2026-09-28", attempts: 200001 }] }), false);
  assert.equal(ok({ goals: [{ from: "2026-09-28", attempts: 600.5 }] }), false);
  // Leer: ab diesem Montag automatisch.
  assert.equal(ok({ goals: [{ from: "2026-09-28", attempts: 6000 }, { from: "2026-10-05", attempts: null }] }), true);
  assert.equal(ok({ goals: [{ from: "2026-10-05" }] }), false);
  // Dienstag, kein Kalendertag, falsches Format.
  assert.equal(ok({ goals: [{ from: "2026-09-29", attempts: 6000 }] }), false);
  assert.equal(ok({ goals: [{ from: "2026-02-30", attempts: 6000 }] }), false);
  assert.equal(ok({ goals: [{ from: "28.09.2026", attempts: 6000 }] }), false);
  // Strikt: keine weiteren Felder, kein Montag doppelt.
  assert.equal(ok({ goals: [], extra: 1 }), false);
  assert.equal(ok({ goals: [{ from: "2026-09-28", attempts: 6000, name: "x" }] }), false);
  assert.equal(
    ok({ goals: [{ from: "2026-09-28", attempts: 6000 }, { from: "2026-09-28", attempts: 7000 }] }),
    false,
  );
  const weeks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ from: addDays("2026-01-05", 7 * i), attempts: 1000 }));
  assert.equal(ok({ goals: weeks(26) }), true);
  assert.equal(ok({ goals: weeks(27) }), false);
});

test("stored values: invalid ones fall back to the automatic goal", async () => {
  assert.deepEqual(await loadCommunitySettings(db), { goals: [] });
  const store = (value: unknown) =>
    db.query(
      `INSERT INTO app_settings(key,value) VALUES('community',$1::jsonb)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [JSON.stringify(value)],
    );
  await store({ goals: [{ from: "2026-09-28", attempts: 100 }] });
  assert.deepEqual(await loadCommunitySettings(db), { goals: [] });
  await store({ goals: [{ from: "2026-09-29", attempts: 6000 }] });
  assert.deepEqual(await loadCommunitySettings(db), { goals: [] });
  await store("6000");
  assert.deepEqual(await loadCommunitySettings(db), { goals: [] });
  await store({ goals: [{ from: "2026-09-28", attempts: 6000 }] });
  assert.deepEqual(await loadCommunitySettings(db), { goals: [{ from: "2026-09-28", attempts: 6000 }] });
});

test("saving: from this Monday on, the same Monday replaces, empty means automatic again", async () => {
  const wednesday = "2026-03-11";
  await saveCommunitySettings(db, "admin", { attempts: 6000 }, wednesday);
  assert.deepEqual(await saveCommunitySettings(db, "admin", { attempts: 7000 }, "2026-03-13"), {
    goals: [{ from: "2026-03-09", attempts: 7000 }],
  });
  const next = await saveCommunitySettings(db, "admin", { attempts: 8000 }, "2026-03-16");
  assert.deepEqual(next.goals, [
    { from: "2026-03-09", attempts: 7000 },
    { from: "2026-03-16", attempts: 8000 },
  ]);
  const [row] = await db.query("SELECT value,updated_by FROM app_settings WHERE key='community'");
  assert.equal(row.updated_by, "admin");
  assert.deepEqual(row.value, next);
  // Leer: ab dieser Woche automatisch, kein älterer Teamwert greift weiter;
  // die Vorwoche behält ihr Ziel.
  assert.deepEqual(await saveCommunitySettings(db, "admin", { attempts: null }, "2026-03-18"), {
    goals: [
      { from: "2026-03-09", attempts: 7000 },
      { from: "2026-03-16", attempts: null },
    ],
  });
  const cleared = await communityWeekState(db, "2026-03-18", { maxAge: 0 });
  assert.equal(cleared.auto, true);
  assert.equal(cleared.lastWeek?.goal, 7000);
  // Ohne Teamwert davor ändert ein leerer Eintrag nichts und fällt weg.
  await db.query("DELETE FROM app_settings WHERE key='community'");
  assert.deepEqual(await saveCommunitySettings(db, "admin", { attempts: null }, wednesday), { goals: [] });
  await assert.rejects(saveCommunitySettings(db, "admin", { attempts: 499 }, wednesday), /500 und 200\.000/);
  await assert.rejects(saveCommunitySettings(db, "admin", { attempts: 1200.5 }, wednesday));
  await assert.rejects(saveCommunitySettings(db, "admin", { attempts: 6000, from: "2026-03-02" }, wednesday));
  // Höchstens 26 Einträge: die ältesten fallen weg.
  for (let i = 0; i < 30; i++)
    await saveCommunitySettings(db, "admin", { attempts: 1000 + i }, addDays("2026-01-07", 7 * i));
  const { goals } = await loadCommunitySettings(db);
  assert.equal(goals.length, 26);
  assert.deepEqual(goals.at(-1), { from: addDays("2026-01-05", 7 * 29), attempts: 1029 });
  assert.equal(goals[0].from, addDays("2026-01-05", 7 * 4));
});

test("week sum: joint reports exactly once, imports count; Dabei only people with Anwahlen", async () => {
  await person("a", "Anna Beispiel");
  await person("b", "Bert Probe");
  await person("z", "Zoe Null");
  await person("j", "Duo Beispiel", "joint");
  await reported("a", "2026-03-09", 120);
  await reported("a", "2026-03-11", 80);
  await reported("b", "2026-03-10", 300);
  await reported("z", "2026-03-10", 0);
  await reported("j", "2026-03-10", 222);
  // Ein späterer Tag zählt nie als diese Woche bis heute.
  await reported("b", "2026-03-12", 999);
  // Vorwochen für das automatische Ziel: 3.000, 2.600, 2.000, 1.200.
  await reported("a", "2026-03-02", 3000);
  await reported("a", "2026-02-23", 2600);
  await reported("a", "2026-02-16", 2000);
  await reported("a", "2026-02-09", 1200);
  // Fünfte Woche davor: nur für das Ziel der Vorwoche.
  await reported("a", "2026-02-02", 4000);
  const week = await communityWeekState(db, "2026-03-11", { maxAge: 0 });
  assert.deepEqual(week, {
    weekStart: "2026-03-09",
    attempts: 722,
    // Schnitt 2.200, abgerundet auf 500.
    goal: 2000,
    auto: true,
    reached: false,
    people: 2,
    // Mittwoch: Ergebnis der Vorwoche mit deren eigenem Ziel (Schnitt
    // 2.600, 2.000, 1.200, 4.000 = 2.450, abgerundet 2.000).
    lastWeek: { attempts: 3000, goal: 2000, reached: true },
  });
  // Ab Donnerstag ohne Vorwoche.
  assert.equal((await communityWeekState(db, "2026-03-12", { maxAge: 0 })).lastWeek, null);
  // Ein Teamwert ab dieser Woche gilt sofort.
  await saveCommunitySettings(db, "admin", { attempts: 700 }, "2026-03-11");
  const team = await communityWeekState(db, "2026-03-11", { maxAge: 0 });
  assert.deepEqual([team.goal, team.auto, team.reached], [700, false, true]);
  assert.deepEqual(await communityGoalState(db, "2026-03-11"), {
    weekStart: "2026-03-09",
    team: 700,
    auto: 2000,
    settings: { goals: [{ from: "2026-03-09", attempts: 700 }] },
  });
});

test("clearing the team value keeps last week's goal for the Vorwoche line", async () => {
  await person("a", "Anna Beispiel");
  // Vier Wochen mit je 10.000 Anwahlen, die Woche ab 28.09. mit 8.000.
  for (const week of ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]) await reported("a", week, 10000);
  await reported("a", "2026-09-28", 8000);
  await saveCommunitySettings(db, "admin", { attempts: 6000 }, "2026-09-28");
  const before = await communityWeekState(db, "2026-10-06", { maxAge: 0 });
  assert.deepEqual(before.lastWeek, { attempts: 8000, goal: 6000, reached: true });
  assert.deepEqual([before.goal, before.auto], [6000, false]);
  // Am Di. 06.10. geleert: diese Woche automatisch, die Vorwoche bleibt bei 6.000.
  await saveCommunitySettings(db, "admin", { attempts: null }, "2026-10-06");
  const after = await communityWeekState(db, "2026-10-06", { maxAge: 0 });
  assert.deepEqual(after.lastWeek, { attempts: 8000, goal: 6000, reached: true });
  assert.equal(after.auto, true);
  // Schnitt aus 10.000, 10.000, 10.000 und 8.000, abgerundet auf 500.
  assert.equal(after.goal, 9500);
  // Eine Woche später gilt weiter die Automatik.
  assert.equal((await communityWeekState(db, "2026-10-13", { maxAge: 0 })).auto, true);
});

test("week sum is cached for a minute, a new team value applies at once", async () => {
  await person("a", "Anna Beispiel");
  await reported("a", "2026-04-08", 100);
  const first = await communityWeekState(db, "2026-04-08");
  assert.equal(first.attempts, 100);
  await reported("a", "2026-04-07", 50);
  assert.equal((await communityWeekState(db, "2026-04-08")).attempts, 100);
  assert.equal((await communityWeekState(db, "2026-04-08", { maxAge: 0 })).attempts, 150);
  await saveCommunitySettings(db, "admin", { attempts: 5000 }, "2026-04-08");
  const fresh = await communityWeekState(db, "2026-04-08");
  assert.deepEqual([fresh.attempts, fresh.goal], [150, 5000]);
});

test("public route: only sums, no names and no IDs", async () => {
  const shared = globalThis as { __dealOperatorDatabase?: Database };
  const url = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    // Ohne Datenbank keine erfundene Summe.
    assert.deepEqual(await (await GET()).json(), { ready: false });
    process.env.DATABASE_URL = "postgres://test.invalid/operator";
    shared.__dealOperatorDatabase = db;
    const today = berlinDate();
    await person("participant-secret-id", "Anna Geheimname");
    await person("joint-secret-id", "Duo Geheimname", "joint");
    await reported("participant-secret-id", today, 140);
    await reported("joint-secret-id", today, 60);
    await reported("participant-secret-id", addDays(weekStartOf(today), -7), 900);
    const response = await GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), [
      "attempts",
      "auto",
      "goal",
      "lastWeek",
      "people",
      "reached",
      "ready",
      "weekStart",
    ]);
    assert.equal(body.weekStart, weekStartOf(today));
    assert.equal(body.attempts, 200);
    assert.equal(body.people, 1);
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /Geheimname|secret-id|Anna|Duo/);
  } finally {
    if (url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = url;
    delete shared.__dealOperatorDatabase;
  }
});
