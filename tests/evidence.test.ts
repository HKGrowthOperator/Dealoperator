import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import {
  evidenceDay,
  evidenceImage,
  ownMonth,
  pruneEvidence,
  resetEvidenceCache,
  saveEvidence,
  sniffImage,
  teamMonth,
} from "../server/evidence";
import { berlinDate } from "../lib/kpis";

// Fiktive Konten; keine echten Screenshots.
let pg: PGlite, db: Database;
const lena = { userId: "lena", email: "lena@example.invalid", admin: false };
const tom = { userId: "tom", email: "tom@example.invalid", admin: false };
const team = { userId: "team", email: "team@example.invalid", admin: true };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const today = berlinDate();
const shift = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as unknown as Executor, (fn) => pg.transaction((tx) => fn(new Database(tx as unknown as Executor))));
});
beforeEach(async () => {
  resetEvidenceCache();
  await pg.exec("TRUNCATE participants,checkins,day_evidence CASCADE");
  await db.query(
    "INSERT INTO participants(id,name,owner,kind) VALUES('p-lena','Lena','lena','person'),('p-tom','Tom','tom','person')",
  );
});
after(async () => pg.close());

async function closing(participant: string, day: string, attempts: number, origin: "closing" | "import" = "closing") {
  await db.query(
    `INSERT INTO checkins(participant,day,counts,source,origin,first_submitted_at,submitted_at,shared)
     VALUES($1,$2,$3::jsonb,'website',$4,${origin === "closing" ? "now(),now(),true" : "NULL,NULL,false"})`,
    [participant, day, JSON.stringify({ attempts }), origin],
  );
}

test("Bildtyp nur aus den Bytes", () => {
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(Buffer.from("RIFF1234WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>")), null);
  assert.equal(sniffImage(Buffer.from("GIF89a")), null);
});

test("Gesprächszeit und Screenshot: speichern, lesen, Felder einzeln ändern", async () => {
  const day = shift(-1);
  assert.deepEqual(await evidenceDay(db, lena, day), { enabled: true, talkMinutes: null, hasImage: false, imageAt: null });
  const a = await saveEvidence(db, lena, { day, talkMinutes: 95 });
  assert.equal(a.talkMinutes, 95);
  assert.equal(a.hasImage, false);
  const b = await saveEvidence(db, lena, { day, image: JPEG.toString("base64") });
  assert.equal(b.talkMinutes, 95, "Bild ändert die Gesprächszeit nicht");
  assert.equal(b.hasImage, true);
  const own = await evidenceImage(db, lena, day);
  assert.equal(own.type, "image/jpeg");
  assert.deepEqual(Buffer.from(own.bytes), JPEG);
  const c = await saveEvidence(db, lena, { day, removeImage: true });
  assert.equal(c.hasImage, false);
  assert.equal(c.talkMinutes, 95);
  await assert.rejects(evidenceImage(db, lena, day), /keinen Screenshot/);
});

test("Nur eigene Tage, keine künftigen, nur echte Bilder", async () => {
  await assert.rejects(saveEvidence(db, lena, { day: shift(1), talkMinutes: 10 }), /künftigen/);
  await assert.rejects(saveEvidence(db, lena, { day: today, image: Buffer.from("kein bild").toString("base64") }), /JPG, PNG oder WebP/);
  await assert.rejects(saveEvidence(db, lena, { day: today, talkMinutes: 2000 }));
  await assert.rejects(saveEvidence(db, { userId: "ohne", email: "x@example.invalid", admin: false }, { day: today, talkMinutes: 5 }), /Profil an/);
});

test("Den Screenshot sehen nur die Person und das Team", async () => {
  const day = shift(-2);
  await saveEvidence(db, lena, { day, image: PNG.toString("base64") });
  await assert.rejects(evidenceImage(db, tom, day, "p-lena"), /nur das Team/);
  const seen = await evidenceImage(db, team, day, "p-lena");
  assert.equal(seen.type, "image/png");
  await assert.rejects(teamMonth(db, tom, today.slice(0, 7)), /nur das Team/);
});

test("Monatsstand: starke Tage mit Screenshot, eigene Abschlüsse ab 50 Anwahlen", async () => {
  const month = today.slice(0, 7);
  const days = [1, 2, 3, 4].map((n) => `${month}-0${n}`).filter((d) => d <= today);
  if (days.length < 3) return; // Monatsanfang: nicht genug vergangene Tage im Monat
  await closing("p-lena", days[0], 120);
  await saveEvidence(db, lena, { day: days[0], talkMinutes: 90, image: JPEG.toString("base64") });
  await closing("p-lena", days[1], 130);
  await saveEvidence(db, lena, { day: days[1], talkMinutes: 89, image: JPEG.toString("base64") }); // zu kurz
  await closing("p-lena", days[2], 60);
  await closing("p-tom", days[0], 150, "import"); // übernommen, kein eigener Abschluss
  const own = await ownMonth(db, lena, month);
  assert.ok(own.enabled);
  if (own.enabled) {
    assert.deepEqual(own.strongDays, [days[0]]);
    assert.equal(own.reports, 3);
    assert.equal(own.target, 3);
  }
  const all = await teamMonth(db, team, month);
  assert.ok(all.enabled);
  if (all.enabled) {
    assert.deepEqual(all.people.map((p) => p.name), ["Lena"]);
    assert.equal(all.people[0].shots.length, 2);
  }
});

test("Alte Screenshots werden gelöscht, die Gesprächszeit bleibt", async () => {
  await db.query(
    "INSERT INTO day_evidence(participant,day,talk_minutes,image,image_type,image_at,updated_by) VALUES('p-lena',$1,100,$2,'image/jpeg',now(),'lena'),('p-lena',$3,100,$2,'image/jpeg',now(),'lena')",
    [shift(-70), JPEG, shift(-10)],
  );
  assert.equal(await pruneEvidence(db), 1);
  const rows = await db.query("SELECT day,talk_minutes,image IS NOT NULL AS img FROM day_evidence ORDER BY day");
  assert.deepEqual(rows.map((r) => [r.talk_minutes, r.img]), [[100, false], [100, true]]);
});

test("Ohne Migration 0005 ist alles aus, ohne Fehler für den Rest", async () => {
  await pg.exec("ALTER TABLE day_evidence RENAME TO day_evidence_off");
  resetEvidenceCache();
  try {
    assert.deepEqual(await evidenceDay(db, lena, today), { enabled: false });
    assert.deepEqual(await ownMonth(db, lena, today.slice(0, 7)), { enabled: false });
    assert.deepEqual(await teamMonth(db, team, today.slice(0, 7)), { enabled: false });
    await assert.rejects(saveEvidence(db, lena, { day: today, talkMinutes: 5 }), /noch nicht freigeschaltet/);
    assert.equal(await pruneEvidence(db), 0);
  } finally {
    await pg.exec("ALTER TABLE day_evidence_off RENAME TO day_evidence");
    resetEvidenceCache();
  }
});
