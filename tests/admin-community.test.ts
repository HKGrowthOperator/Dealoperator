import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import { AppError } from "../server/operator";
import { communityRules, saveCommunityRules } from "../server/admin";
import { communityWeekState } from "../server/game";
import { emptyCounts } from "../lib/kpis";

// Verwaltung › Gemeinsames Wochenziel: lesen fürs Team, speichern nur für
// Admins (wie alle Einstellungen), gleiche Prüfung wie server/settings.ts.
// Fiktive Konten und Namen; 2026-03-11 ist ein Mittwoch.
const owner = { userId: "owner", email: "owner@example.invalid", admin: true };
const mo = { userId: "mo", email: "mo@example.invalid", admin: false, moderator: true };
const alice = { userId: "alice", email: "alice@example.invalid", admin: false };
const WEDNESDAY = "2026-03-11";
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

async function reported(participant: string, day: string, attempts: number) {
  await db.query(
    "INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,$2,$3::jsonb,'owner-import','import')",
    [participant, day, JSON.stringify({ ...emptyCounts(), attempts })],
  );
}

test("team roles read the shared weekly goal, only admins save it", async () => {
  const refused = (e: unknown) => e instanceof AppError && e.status === 403 && /Team/.test(e.message);
  const adminOnly = (e: unknown) =>
    e instanceof AppError && e.status === 403 && e.message === "Das kann nur ein Admin ändern.";
  await assert.rejects(communityRules(db, alice, WEDNESDAY), refused);
  await assert.rejects(saveCommunityRules(db, alice, { attempts: 6000 }, WEDNESDAY), adminOnly);
  // Moderatoren sehen den Reiter Dranbleiben-Regeln nicht; der Server lehnt auch ab.
  await assert.rejects(saveCommunityRules(db, mo, { attempts: 6000 }, WEDNESDAY), adminOnly);
  await assert.rejects(saveCommunityRules(db, mo, { attempts: null }, WEDNESDAY), adminOnly);
  // Nichts gespeichert.
  assert.equal((await db.query("SELECT 1 FROM app_settings WHERE key='community'")).length, 0);

  assert.deepEqual(await communityRules(db, mo, WEDNESDAY), { weekStart: "2026-03-09", team: null, auto: 1000 });
  assert.deepEqual(await saveCommunityRules(db, owner, { attempts: 6000 }, WEDNESDAY), {
    weekStart: "2026-03-09",
    team: 6000,
    auto: 1000,
  });
  assert.deepEqual(await communityRules(db, mo, WEDNESDAY), { weekStart: "2026-03-09", team: 6000, auto: 1000 });
  const [row] = await db.query("SELECT updated_by FROM app_settings WHERE key='community'");
  assert.equal(row.updated_by, "owner");
});

test("saving: same checks as the settings, empty means automatic again, applies at once", async () => {
  await db.query("INSERT INTO participants(id,name) VALUES('a','Anna Beispiel')");
  // Vier Vorwochen mit 3.000, 2.600, 2.000 und 1.200: automatisch 2.000.
  await reported("a", "2026-03-02", 3000);
  await reported("a", "2026-02-23", 2600);
  await reported("a", "2026-02-16", 2000);
  await reported("a", "2026-02-09", 1200);
  assert.deepEqual(await communityRules(db, owner, WEDNESDAY), { weekStart: "2026-03-09", team: null, auto: 2000 });

  // Ungültig: unter 500, über 200.000, keine ganze Zahl, Text, fremde Felder.
  for (const value of [
    { attempts: 499 },
    { attempts: 200001 },
    { attempts: 6000.5 },
    { attempts: "6000" },
    { attempts: 6000, from: "2026-03-02" },
    {},
  ])
    await assert.rejects(saveCommunityRules(db, owner, value, WEDNESDAY), { name: "ZodError" });
  await assert.rejects(saveCommunityRules(db, owner, { attempts: 499 }, WEDNESDAY), /500 und 200\.000/);
  assert.equal((await db.query("SELECT 1 FROM app_settings WHERE key='community'")).length, 0);

  // Ein Teamwert gilt ab dieser Woche sofort, auch für die öffentliche Fläche.
  await communityWeekState(db, WEDNESDAY);
  assert.equal((await saveCommunityRules(db, owner, { attempts: 6000 }, WEDNESDAY)).team, 6000);
  assert.deepEqual(
    [(await communityWeekState(db, WEDNESDAY)).goal, (await communityWeekState(db, WEDNESDAY)).auto],
    [6000, false],
  );
  // Leer: wieder automatisch.
  assert.deepEqual(await saveCommunityRules(db, owner, { attempts: null }, WEDNESDAY), {
    weekStart: "2026-03-09",
    team: null,
    auto: 2000,
  });
  assert.deepEqual(
    [(await communityWeekState(db, WEDNESDAY)).goal, (await communityWeekState(db, WEDNESDAY)).auto],
    [2000, true],
  );
});

test("the admin route maps both actions to these functions", async () => {
  const source = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
  assert.match(source, /case "communityRules":\s*return json\(await communityRules\(db, actor\)\);/);
  assert.match(source, /case "saveCommunityRules":\s*return json\(await saveCommunityRules\(db, actor, v\)\);/);
});
