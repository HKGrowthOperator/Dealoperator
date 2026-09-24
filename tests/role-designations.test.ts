import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../server/database";
import { createMember } from "../server/operator";
import {
  answerInfoRequest,
  bindConfirmedRequest,
  decideRequest,
  requestClaimSignedIn,
  reviewQueue,
  startRequest,
} from "../server/onboarding";
import { designateRole, isTeamMember, listDesignations, teamList } from "../server/roles";

// Fiktive Konten und Profile; keine echten Kontaktdaten.
const admin = { userId: "admin", email: "admin@example.invalid", admin: true };
const ada = { userId: "ada", email: "ada@example.invalid", admin: true };
const mo = { userId: "mo", email: "mo@example.invalid", admin: false, moderator: true };
const alice = { userId: "alice", email: "alice@example.invalid", admin: false };
const bob = { userId: "bob", email: "bob@example.invalid", admin: false };
let pg: PGlite, db: Database;

before(async () => {
  process.env.OPERATOR_ADMIN_IDS = "admin";
  delete process.env.RESEND_API_KEY;
  pg = new PGlite();
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as any, (fn) => pg.transaction((tx) => fn(new Database(tx as any))));
});
beforeEach(async () => {
  await pg.exec(
    `TRUNCATE participants,profiles,account_private,onboarding_requests,onboarding_events,claim_tokens,
      team_inbox,notifications,notification_prefs,rate_limits,sync_outbox,team_roles,app_settings CASCADE`,
  );
  for (const a of [admin, ada, mo])
    await db.query("INSERT INTO account_private(owner,email) VALUES($1,$2)", [a.userId, a.email]);
  await db.query(
    "INSERT INTO team_roles(owner,role,granted_by) VALUES('ada','admin','admin'),('mo','moderator','admin')",
  );
  // Name der vormerkenden Admin für die Anzeige „von wem“.
  await db.query("INSERT INTO participants(id,name,owner,claimed_at) VALUES($1,'Ada V.','ada',now())", [
    randomUUID(),
  ]);
});
after(async () => {
  await pg.close();
});

async function profile(name: string, opts: { owner?: string; kind?: string } = {}) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO participants(id,name,company,owner,kind,claimed_at) VALUES($1,$2,'Beispiel GmbH',$3,$4,$5)",
    [id, name, opts.owner ?? null, opts.kind ?? "person", opts.owner ? new Date() : null],
  );
  return id;
}
const details = (fullName: string, participantId?: string) => ({
  ...(participantId ? { participantId } : {}),
  fullName,
  phone: "+49 170 1234567",
});
const roleOf = async (owner: string) =>
  (await db.query("SELECT role,granted_by FROM team_roles WHERE owner=$1", [owner]))[0] ?? null;
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query(sql, params))[0].n);

test("only admins pre-assign a role, and only for a free personal profile", async () => {
  const p = await profile("Alex B.");
  await assert.rejects(designateRole(db, alice, { participantId: p, role: "moderator" }), /Admin/);
  await assert.rejects(designateRole(db, mo, { participantId: p, role: "moderator" }), /Admin/);
  await assert.rejects(listDesignations(db, mo), /Admin/);

  const owned = await profile("Bea C.", { owner: "bob" });
  await assert.rejects(
    designateRole(db, admin, { participantId: owned, role: "moderator" }),
    /bereits zu einem Konto.*direkt an das Konto/,
  );
  const joint = await profile("Alex & Kim", { kind: "joint" });
  await assert.rejects(designateRole(db, admin, { participantId: joint, role: "moderator" }), /gemeinsam gemeldete/);
  await assert.rejects(designateRole(db, admin, { participantId: randomUUID(), role: "moderator" }), /gibt es nicht/);
  await assert.rejects(designateRole(db, admin, { participantId: p, role: "owner" }));
  assert.deepEqual(await listDesignations(db, admin), []);

  await designateRole(db, ada, { participantId: p, role: "moderator" });
  let [d] = await listDesignations(db, admin);
  assert.equal(d.participantId, p);
  assert.equal(d.name, "Alex B.");
  assert.equal(d.role, "moderator");
  assert.equal(d.designatedBy, "Ada V.");
  assert.equal(d.available, true);
  assert.ok(!Number.isNaN(Date.parse(d.designatedAt)));
  // Admins sehen die Vormerkungen mit der Team-Liste in einer Anfrage.
  assert.deepEqual((await teamList(db, admin)).designations.map((x) => x.participantId), [p]);
  // Erneutes Vormerken ändert die Rolle, statt eine zweite Vormerkung anzulegen.
  await designateRole(db, admin, { participantId: p, role: "admin" });
  const all = await listDesignations(db, admin);
  assert.equal(all.length, 1);
  [d] = all;
  assert.equal(d.role, "admin");
  assert.equal(d.designatedBy, admin.email);
  // Eine Vormerkung allein macht niemanden zum Team-Mitglied.
  assert.equal(await count("SELECT count(*) AS n FROM team_roles"), 2);
});

test("approving the takeover of a designated profile grants the role once and uses up the designation", async () => {
  const p = await profile("Alex B.");
  await designateRole(db, ada, { participantId: p, role: "moderator" });
  const r = await requestClaimSignedIn(db, alice, details("Alice Beispiel", p));
  // Die Übernahmeprüfung weist darauf hin, dass die Freigabe die Rolle mitbringt.
  const queued = (await reviewQueue(db, admin)).find((q) => q.id === r.id);
  assert.equal(queued?.designated_role, "moderator");
  assert.equal(await roleOf("alice"), null);

  const done = await decideRequest(db, mo, { id: r.id, decision: "approve" });
  assert.equal(done.status, "approved");
  assert.equal(done.role, "moderator");
  // Wie bei setTeamRole: vergeben von der Admin, die vorgemerkt hat, mit E-Mail-Absicherung.
  assert.deepEqual({ ...(await roleOf("alice")) }, { role: "moderator", granted_by: "ada" });
  const [prefs] = await db.query("SELECT team_alerts,team_email,email FROM notification_prefs WHERE owner='alice'");
  assert.deepEqual({ ...prefs }, { team_alerts: true, team_email: true, email: alice.email });
  assert.equal(await isTeamMember(db, "alice"), true);
  assert.deepEqual(await listDesignations(db, admin), []);
  assert.equal(
    await count("SELECT count(*) AS n FROM onboarding_events WHERE request=$1 AND action='role_granted'", [r.id]),
    1,
  );
  // Ein zweites Entscheiden ändert nichts mehr.
  await assert.rejects(decideRequest(db, admin, { id: r.id, decision: "approve" }), /abschließend/);
  assert.equal(await count("SELECT count(*) AS n FROM team_roles WHERE owner='alice'"), 1);
  // Danach lässt sich für das übernommene Profil nichts mehr vormerken.
  await assert.rejects(designateRole(db, admin, { participantId: p, role: "admin" }), /direkt an das Konto/);
  assert.equal((await reviewQueue(db, admin)).find((q) => q.id === r.id)?.designated_role, null);
});

test("no role without the team's approval of exactly that profile", async () => {
  const p = await profile("Alex B.");
  const q = await profile("Chris D.");
  await designateRole(db, admin, { participantId: p, role: "moderator" });

  // Freigabe eines anderen, nicht vorgemerkten Profils.
  const other = await requestClaimSignedIn(db, bob, details("Bob Beispiel", q));
  const ok = await decideRequest(db, admin, { id: other.id, decision: "approve" });
  assert.equal(ok.role, null);
  assert.equal(await roleOf("bob"), null);

  // Rückfrage, Antwort und Ablehnung für das vorgemerkte Profil.
  const r = await requestClaimSignedIn(db, alice, details("Alice Beispiel", p));
  await decideRequest(db, admin, { id: r.id, decision: "info", applicantMessage: "Unter welchem Namen callst du?" });
  assert.equal(await roleOf("alice"), null);
  await answerInfoRequest(db, alice, { message: "Als Alex im Gruppenchat" });
  await decideRequest(db, admin, { id: r.id, decision: "reject", applicantMessage: "Wir konnten die Zuordnung nicht bestätigen." });
  assert.equal(await roleOf("alice"), null);
  // Ein selbst angelegtes neues Profil bringt ebenfalls keine Rolle.
  await createMember(db, alice, { name: "Alice", company: "", role: "", publicConsent: false });
  assert.equal(await roleOf("alice"), null);
  // Die Vormerkung bleibt für die richtige Person bestehen.
  assert.deepEqual((await listDesignations(db, admin)).map((d) => d.participantId), [p]);
  assert.equal(await count("SELECT count(*) AS n FROM team_roles"), 2);
});

test("the team picking the profile for an assignment request also activates the role", async () => {
  const p = await profile("Alex B.");
  await designateRole(db, admin, { participantId: p, role: "admin" });
  const r = await startRequest(db, {
    kind: "claim", email: alice.email, fullName: "Alice Beispiel", phone: "+49 170 1234567", hint: "Im Chat als Alex",
  });
  await bindConfirmedRequest(db, alice, r.id);
  // Noch ohne Profil: kein Hinweis an der Anfrage, aber am Profil in der Auswahl.
  assert.equal((await reviewQueue(db, admin)).find((x) => x.id === r.id)?.designated_role, null);
  const done = await decideRequest(db, admin, { id: r.id, decision: "approve", participantId: p });
  assert.equal(done.role, "admin");
  assert.deepEqual({ ...(await roleOf("alice")) }, { role: "admin", granted_by: "admin" });
  assert.deepEqual(await listDesignations(db, admin), []);
});

test("a removed designation grants nothing; fixed owners and existing admins stay as they are", async () => {
  const p = await profile("Alex B.");
  await designateRole(db, admin, { participantId: p, role: "moderator" });
  await assert.rejects(designateRole(db, mo, { participantId: p, role: null }), /Admin/);
  await designateRole(db, admin, { participantId: p, role: null });
  // Wiederholtes Entfernen ist kein Fehler.
  await designateRole(db, admin, { participantId: p, role: null });
  assert.deepEqual(await listDesignations(db, admin), []);
  const r = await requestClaimSignedIn(db, alice, details("Alice Beispiel", p));
  assert.equal((await decideRequest(db, admin, { id: r.id, decision: "approve" })).role, null);
  assert.equal(await roleOf("alice"), null);

  // Die feste Grundverwaltung bekommt keinen Eintrag in team_roles.
  const q = await profile("Dana E.");
  await designateRole(db, ada, { participantId: q, role: "moderator" });
  const own = await requestClaimSignedIn(db, admin, details("Admin Beispiel", q));
  assert.equal((await decideRequest(db, admin, { id: own.id, decision: "approve" })).role, null);
  assert.equal(await roleOf("admin"), null);
  assert.deepEqual(await listDesignations(db, admin), []);

  // Eine bestehende Admin-Rolle wird nicht zur Moderatorrolle.
  const s = await profile("Eli F.");
  await designateRole(db, admin, { participantId: s, role: "moderator" });
  const adas = await requestClaimSignedIn(db, { ...ada, userId: "ada2", email: "ada2@example.invalid" }, details("Ada Zwei", s));
  await db.query("INSERT INTO team_roles(owner,role,granted_by) VALUES('ada2','admin','admin')");
  await decideRequest(db, admin, { id: adas.id, decision: "approve" });
  assert.deepEqual({ ...(await roleOf("ada2")) }, { role: "admin", granted_by: "admin" });
  assert.deepEqual(await listDesignations(db, admin), []);
});
