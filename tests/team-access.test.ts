import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database, type Executor } from "../server/database";
import { reviewQueue, startRequest } from "../server/onboarding";
import {
  accountlessProfiles,
  confirmRegistrationByTeam,
  createAccessByTeam,
  resetTeamAccessCache,
  teamAccessReady,
} from "../server/team-access";
import { ROLEPLAY_ROOM, sessionRoomOf } from "../lib/discord";

// Fiktive Konten und ein nachgebautes Schema auth; keine echten Daten.
let pg: PGlite, db: Database;
const admin = { userId: "admin", email: "admin@example.invalid", admin: true };
const mo = { userId: "mo", email: "mo@example.invalid", admin: false, moderator: true };
const PASSWORD = "Anker-Falke-4711";

const AUTH_STUB = `
CREATE SCHEMA auth;
CREATE TABLE auth.users(
  id uuid PRIMARY KEY,
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}',
  is_sso_user boolean NOT NULL DEFAULT false,
  is_anonymous boolean NOT NULL DEFAULT false,
  deleted_at timestamptz
);
CREATE TABLE auth.identities(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL,
  identity_data jsonb NOT NULL,
  updated_at timestamptz
);`;
const migration = () => readFile(new URL("../database/migrations/0006_team_access.sql", import.meta.url), "utf8");

before(async () => {
  process.env.OPERATOR_ADMIN_IDS = "admin";
  delete process.env.RESEND_API_KEY;
  pg = new PGlite();
  await pg.exec(AUTH_STUB);
  await pg.exec(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"));
  await pg.exec(await migration());
  await pg.exec("SET search_path=operator,pg_catalog");
  db = new Database(pg as unknown as Executor, (fn) => pg.transaction((tx) => fn(new Database(tx as unknown as Executor))));
});
beforeEach(async () => {
  resetTeamAccessCache();
  await pg.exec(
    `TRUNCATE participants,profiles,account_private,onboarding_requests,onboarding_events,claim_tokens,
      team_inbox,notifications,notification_prefs,rate_limits,sync_outbox,team_roles CASCADE;
     TRUNCATE auth.identities, auth.users CASCADE;`,
  );
});
after(async () => pg.close());

/** Konto im nachgebauten auth-Schema. Das Passwort steht dort nur als Platzhalter-Hash. */
async function account(email: string, opts: { password?: boolean; confirmed?: boolean; sso?: boolean } = {}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at,is_sso_user,raw_user_meta_data)
     VALUES($1,$2,$3,$4,$5,'{"has_password":true}')`,
    [id, email, opts.password === false ? "" : "$2a$10$platzhalter", opts.confirmed ? new Date("2026-09-01T10:00:00Z") : null, !!opts.sso],
  );
  await db.query(
    `INSERT INTO auth.identities(user_id,provider,identity_data) VALUES($1::uuid,'email',jsonb_build_object('sub',$3::text,'email',$2::text,'email_verified',false))`,
    [id, email, id],
  );
  return id;
}
const userRow = async (id: string) => (await db.query("SELECT * FROM auth.users WHERE id=$1", [id]))[0];
const identity = async (id: string) =>
  (await db.query("SELECT identity_data FROM auth.identities WHERE user_id=$1", [id]))[0].identity_data;

async function profile(name: string, opts: { owner?: string; kind?: string } = {}) {
  const id = randomUUID();
  await db.query("INSERT INTO participants(id,name,owner,kind,public_consent) VALUES($1,$2,$3,$4,true)", [
    id,
    name,
    opts.owner ?? null,
    opts.kind ?? "person",
  ]);
  return id;
}
async function registration(email: string, kind: "new" | "claim", participantId?: string) {
  const r = await startRequest(db, {
    kind,
    ...(participantId ? { participantId } : {}),
    fullName: "Lena Beispiel",
    email,
    phone: "+49 170 1234567",
  });
  return r.id;
}
/** Nachgebautes signUp: legt ein unbestätigtes Konto an und merkt sich nur die Adresse. */
function stubSignUp() {
  const calls: string[] = [];
  const signUp = async (email: string) => {
    calls.push(email);
    return account(email);
  };
  return { calls, signUp };
}

test("Status und Bestätigen: missing, no_password ändert nichts, confirmed nur Adresse, danach already", async () => {
  assert.deepEqual(await db.query("SELECT * FROM operator.team_account_status('niemand@example.invalid')"), []);
  assert.deepEqual(
    { ...(await db.query("SELECT * FROM operator.team_confirm_account('niemand@example.invalid')"))[0] },
    { status: "missing", user_id: null },
  );

  const bare = await account("ohne@example.invalid", { password: false });
  const beforeBare = await userRow(bare);
  const [np] = await db.query("SELECT * FROM operator.team_confirm_account('OHNE@example.invalid')");
  assert.deepEqual({ ...np }, { status: "no_password", user_id: bare });
  assert.deepEqual(await userRow(bare), beforeBare);
  assert.equal((await identity(bare)).email_verified, false);

  const id = await account("lena@example.invalid");
  const [st] = await db.query("SELECT * FROM operator.team_account_status('Lena@Example.invalid')");
  assert.deepEqual({ ...st, created_at: undefined }, { user_id: id, confirmed: false, has_password: true, created_at: undefined });
  assert.ok(st.created_at instanceof Date);
  const before = await userRow(id);
  const [c] = await db.query("SELECT * FROM operator.team_confirm_account('lena@example.invalid')");
  assert.deepEqual({ ...c }, { status: "confirmed", user_id: id });
  const after = await userRow(id);
  assert.ok(after.email_confirmed_at);
  for (const k of Object.keys(before))
    if (!["email_confirmed_at", "updated_at"].includes(k)) assert.deepEqual(after[k], before[k], k);
  const data = await identity(id);
  assert.equal(data.email_verified, true);
  assert.equal(data.email, "lena@example.invalid");
  const [again] = await db.query("SELECT * FROM operator.team_confirm_account('lena@example.invalid')");
  assert.equal(again.status, "already");

  // SSO-Konten und gelöschte Konten zählen nicht.
  await account("sso@example.invalid", { sso: true });
  assert.equal((await db.query("SELECT * FROM operator.team_confirm_account('sso@example.invalid')"))[0].status, "missing");
  const gone = await account("weg@example.invalid");
  await db.query("UPDATE auth.users SET deleted_at=now() WHERE id=$1", [gone]);
  assert.deepEqual(await db.query("SELECT * FROM operator.team_account_status('weg@example.invalid')"), []);
});

test("Freischalten: nur Admins, nur wartende Registrierungen; neu wird freigegeben, Übernahme geht in die Prüfung", async () => {
  const email = "lena@example.invalid";
  const request = await registration(email, "new");
  await assert.rejects(confirmRegistrationByTeam(db, mo, { id: request }), (e: { status?: number; message: string }) => e.status === 403 && /nur Admins/.test(e.message));
  // Ohne Konto: verständlicher Hinweis, nichts passiert.
  await assert.rejects(confirmRegistrationByTeam(db, admin, { id: request }), /noch kein Konto/);
  const user = await account(email);
  const r = await confirmRegistrationByTeam(db, admin, { id: request });
  assert.deepEqual(r, { ok: true, kind: "new", name: "Lena Beispiel", bound: true });
  const [row] = await db.query("SELECT status,owner FROM onboarding_requests WHERE id=$1", [request]);
  assert.deepEqual({ ...row }, { status: "approved", owner: user });
  assert.equal((await db.query("SELECT email FROM account_private WHERE owner=$1", [user]))[0].email, email);
  assert.ok((await userRow(user)).email_confirmed_at);
  const [event] = await db.query("SELECT actor FROM onboarding_events WHERE request=$1 AND action='team_confirmed'", [request]);
  assert.equal(event.actor, "admin");
  // Schon erledigt: kein zweites Mal.
  await assert.rejects(confirmRegistrationByTeam(db, admin, { id: request }), /schon bestätigt oder erledigt/);

  const p = await profile("Tom Muster");
  const claim = await registration("tom@example.invalid", "claim", p);
  const tom = await account("tom@example.invalid");
  const c = await confirmRegistrationByTeam(db, admin, { id: claim });
  assert.equal(c.kind, "claim");
  const [cr] = await db.query("SELECT status,owner FROM onboarding_requests WHERE id=$1", [claim]);
  assert.deepEqual({ ...cr }, { status: "pending", owner: tom });
  // Freigeben bleibt Sache der Prüfung; dort ist sichtbar, dass das Postfach nicht nachgewiesen ist.
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [p]))[0].owner, null);
  const queued = (await reviewQueue(db, admin)).find((x) => x.id === claim);
  assert.equal(queued?.team_confirmed, true);
  assert.equal(
    Number((await db.query("SELECT count(*) AS n FROM onboarding_events WHERE request=$1 AND action='email_confirmed'", [claim]))[0].n),
    0,
  );
  const [inboxEntry] = await db.query("SELECT body FROM team_inbox WHERE ref=$1", [claim]);
  assert.match(inboxEntry.body, /vom Team freigeschaltet, nicht per Mail bestätigt/);

  // Konto ohne Passwort: nichts ändern.
  const other = await registration("ohne@example.invalid", "new");
  await account("ohne@example.invalid", { password: false });
  await assert.rejects(confirmRegistrationByTeam(db, admin, { id: other }), /ohne Passwort/);
  assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [other]))[0].status, "awaiting_email");
});

test("Zugang anlegen: neues Profil, Konto bestätigt, Eintrag erledigt, Passwort nirgends gespeichert", async () => {
  const { calls, signUp } = stubSignUp();
  await assert.rejects(
    createAccessByTeam(db, mo, { name: "Kai Neu", email: "kai@example.invalid", password: PASSWORD }, signUp),
    /nur Admins/,
  );
  const r = await createAccessByTeam(
    db,
    admin,
    { name: " Kai Neu ", email: " Kai@Example.invalid ", password: PASSWORD },
    signUp,
  );
  assert.deepEqual(calls, ["kai@example.invalid"]);
  assert.equal(r.created, true);
  assert.equal(r.passwordSet, true);
  assert.equal(r.email, "kai@example.invalid");
  assert.ok(!JSON.stringify(r).includes(PASSWORD));
  const [p] = await db.query("SELECT name,owner,import_key,kind,claimed_at FROM participants WHERE id=$1", [r.participant]);
  assert.equal(p.name, "Kai Neu");
  assert.match(p.import_key, /^team-kai-neu/);
  const [st] = await db.query("SELECT * FROM operator.team_account_status('kai@example.invalid')");
  assert.equal(st.confirmed, true);
  assert.equal(p.owner, st.user_id);
  assert.ok(p.claimed_at);
  const [req] = await db.query("SELECT kind,status,decided_by,internal_note,phone FROM onboarding_requests WHERE owner=$1", [p.owner]);
  assert.deepEqual({ ...req }, { kind: "new", status: "approved", decided_by: "admin", internal_note: "Zugang vom Team angelegt.", phone: "" });
  assert.equal(JSON.parse((await db.query("SELECT data FROM profiles WHERE id=$1", [p.owner]))[0].data).name, "Kai Neu");
  assert.equal((await db.query("SELECT email FROM account_private WHERE owner=$1", [p.owner]))[0].email, "kai@example.invalid");
  const [inbox] = await db.query("SELECT title,resolved_at FROM team_inbox");
  assert.equal(inbox.title, "Zugang angelegt: Kai Neu");
  assert.ok(inbox.resolved_at);
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM notifications"))[0].n), 0, "kein Push");
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM onboarding_events WHERE action='team_access'"))[0].n), 1);
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM sync_outbox WHERE participant=$1", [r.participant]))[0].n), 1);

  // Das Passwort steht in keiner Tabelle des Schemas operator.
  for (const { tablename } of await db.query("SELECT tablename FROM pg_tables WHERE schemaname='operator'")) {
    const [hit] = await db.query(`SELECT count(*) AS n FROM operator.${tablename} t WHERE t::text LIKE $1`, [`%${PASSWORD}%`]);
    assert.equal(Number(hit.n), 0, tablename);
  }

  // Dieselbe Adresse noch einmal: es gibt schon einen Zugang.
  await assert.rejects(
    createAccessByTeam(db, admin, { name: "Kai Anders", email: "kai@example.invalid", password: PASSWORD }, signUp),
    /schon einen Zugang/,
  );
  assert.equal(calls.length, 1);
});

test("Zugang anlegen: vorhandenes Profil binden; gleichnamiges Profil ohne Auswahl wird abgelehnt", async () => {
  const { calls, signUp } = stubSignUp();
  const p = await profile("Linus  Zornig");
  await db.query("INSERT INTO checkins(participant,day,counts,source,origin) VALUES($1,'2026-09-20','{\"attempts\":80}','import','import')", [p]);
  await assert.rejects(
    createAccessByTeam(db, admin, { name: "linus zornig", email: "linus@example.invalid", password: PASSWORD }, signUp),
    (e: { status?: number; field?: string; message: string }) =>
      e.status === 409 && e.field === "participant" && /genau dieses Profil/.test(e.message),
  );
  assert.equal(calls.length, 0, "ohne Klärung kein Konto");
  assert.deepEqual(
    (await accountlessProfiles(db, admin)).map((x) => x.name),
    ["Linus  Zornig"],
  );
  await assert.rejects(accountlessProfiles(db, mo), /Nur für Admins/);

  const r = await createAccessByTeam(
    db,
    admin,
    { name: "Linus Zornig", email: "linus@example.invalid", password: PASSWORD, participant: p },
    signUp,
  );
  assert.equal(r.participant, p);
  assert.equal(r.created, false);
  const [row] = await db.query("SELECT owner FROM participants WHERE id=$1", [p]);
  assert.ok(row.owner);
  assert.equal((await db.query("SELECT kind FROM onboarding_requests WHERE owner=$1", [row.owner]))[0].kind, "claim");
  // Historie bleibt am Profil.
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM checkins WHERE participant=$1", [p]))[0].n), 1);
  // Profil schon vergeben, gemeinsame Meldung: nein.
  await assert.rejects(
    createAccessByTeam(db, admin, { name: "Jemand", email: "x@example.invalid", password: PASSWORD, participant: p }, signUp),
    /hat schon ein Konto/,
  );
  const joint = await profile("Team Nord", { kind: "joint" });
  await assert.rejects(
    createAccessByTeam(db, admin, { name: "Team Nord", email: "y@example.invalid", password: PASSWORD, participant: joint }, signUp),
    /Gemeinsame Meldungen/,
  );
});

test("Zugang anlegen: unbestätigtes fremdes Konto wird nicht angefasst, bestätigtes ohne Profil behält sein Passwort", async () => {
  const { calls, signUp } = stubSignUp();
  // Jemand hat die Adresse zuerst registriert; dessen Passwort kennt das Team nicht.
  const request = await registration("kevin@example.invalid", "new");
  const stranger = await account("kevin@example.invalid");
  const p = await profile("Kevin Antwi");
  await assert.rejects(
    createAccessByTeam(
      db,
      admin,
      { name: "Kevin Antwi", email: "kevin@example.invalid", password: PASSWORD, participant: p },
      signUp,
    ),
    (e: { status?: number; field?: string; message: string }) =>
      e.status === 409 && e.field === "email" && /Freischalten/.test(e.message),
  );
  assert.equal(calls.length, 0, "kein signUp");
  assert.equal((await userRow(stranger)).email_confirmed_at, null, "nicht bestätigt");
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [p]))[0].owner, null, "nicht gebunden");
  assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [request]))[0].status, "awaiting_email");

  // Bestätigtes Konto ohne Profil: wird gebunden, das Passwort bleibt das eigene.
  const user = await account("lea@example.invalid", { confirmed: true });
  const r = await createAccessByTeam(
    db,
    admin,
    { name: "Lea Beispiel", email: "lea@example.invalid", password: PASSWORD },
    signUp,
  );
  assert.equal(calls.length, 0, "kein signUp");
  assert.equal(r.passwordSet, false);
  assert.equal(r.newAccount, false);
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [r.participant]))[0].owner, user);
  assert.equal((await userRow(user)).encrypted_password, "$2a$10$platzhalter");

  // Bestätigtes Konto mit Profil: schon ein Zugang.
  const owner = await account("mia@example.invalid", { confirmed: true });
  await profile("Mia Muster", { owner });
  await assert.rejects(
    createAccessByTeam(db, admin, { name: "Mia Neu", email: "mia@example.invalid", password: PASSWORD }, signUp),
    /schon einen Zugang/,
  );
  assert.equal(calls.length, 0);
});

test("Zugang anlegen: nach einem Teilfehler erkennt der neue Versuch das eigene Konto", async () => {
  const p = await profile("Nora Beispiel");
  const calls: string[] = [];
  // Konto entsteht, aber das Profil wird zwischendurch vergeben.
  const signUp = async (email: string) => {
    calls.push(email);
    const id = await account(email);
    await db.query("UPDATE participants SET owner='jemand' WHERE id=$1", [p]);
    return id;
  };
  await assert.rejects(
    createAccessByTeam(db, admin, { name: "Nora Beispiel", email: "nora@example.invalid", password: PASSWORD, participant: p }, signUp),
    (e: { message: string }) => /hat schon ein Konto/.test(e.message) && /demselben Passwort/.test(e.message),
  );
  const [st] = await db.query("SELECT * FROM operator.team_account_status('nora@example.invalid')");
  assert.equal(st.confirmed, false, "Bestätigung liegt in der Transaktion");

  await db.query("UPDATE participants SET owner=NULL WHERE id=$1", [p]);
  const again = await createAccessByTeam(
    db,
    admin,
    { name: "Nora Beispiel", email: "nora@example.invalid", password: PASSWORD, participant: p },
    signUp,
  );
  assert.equal(calls.length, 1, "kein zweites signUp");
  assert.equal(again.passwordSet, true);
  assert.equal(again.earlier, true);
  assert.equal((await db.query("SELECT owner FROM participants WHERE id=$1", [p]))[0].owner, st.user_id);
  const reqs = await db.query("SELECT status FROM onboarding_requests WHERE lower(email)='nora@example.invalid'");
  assert.deepEqual(reqs.map((x) => x.status), ["approved"], "der Merker wird zur Anfrage");
  for (const { tablename } of await db.query("SELECT tablename FROM pg_tables WHERE schemaname='operator'")) {
    const [hit] = await db.query(`SELECT count(*) AS n FROM operator.${tablename} t WHERE t::text LIKE $1`, [`%${PASSWORD}%`]);
    assert.equal(Number(hit.n), 0, tablename);
  }
});

test("Zugang anlegen: angefragte Übernahme bestimmt das Profil", async () => {
  const { calls, signUp } = stubSignUp();
  const p = await profile("Kevin Antwi");
  await registration("kevin@example.invalid", "claim", p);
  await assert.rejects(
    createAccessByTeam(db, admin, { name: "Kevin A.", email: "kevin@example.invalid", password: PASSWORD }, signUp),
    (e: { status?: number; field?: string; message: string }) =>
      e.status === 409 && e.field === "participant" && /„Kevin Antwi“ hat die Person zur Übernahme angefragt/.test(e.message),
  );
  assert.equal(calls.length, 0);
  const r = await createAccessByTeam(
    db,
    admin,
    { name: "Kevin Antwi", email: "kevin@example.invalid", password: PASSWORD, participant: p },
    signUp,
  );
  assert.equal(r.participant, p);
});

test("Ohne Migration 0006: verständlicher Hinweis, nichts ändert sich", async () => {
  await pg.exec("DROP FUNCTION operator.team_confirm_account(text); DROP FUNCTION operator.team_account_status(text);");
  try {
    resetTeamAccessCache();
    assert.equal(await teamAccessReady(db), false);
    const request = await registration("lena@example.invalid", "new");
    await account("lena@example.invalid");
    const { calls, signUp } = stubSignUp();
    await assert.rejects(confirmRegistrationByTeam(db, admin, { id: request }), /Migration 0006/);
    await assert.rejects(
      createAccessByTeam(db, admin, { name: "Kai Neu", email: "kai@example.invalid", password: PASSWORD }, signUp),
      /Migration 0006/,
    );
    assert.equal(calls.length, 0);
    assert.equal((await db.query("SELECT status FROM onboarding_requests WHERE id=$1", [request]))[0].status, "awaiting_email");
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM participants"))[0].n), 0);
  } finally {
    await pg.exec(await migration());
    await pg.exec("SET search_path=operator,pg_catalog");
    resetTeamAccessCache();
  }
  assert.equal(await teamAccessReady(db), true);
});

test("Roleplay läuft immer im festen Raum, andere Sessions wie bisher", () => {
  assert.equal(ROLEPLAY_ROOM, "https://discord.gg/sp75ZrWahH");
  assert.deepEqual(sessionRoomOf("Roleplay", { url: "https://discord.com/channels/g1/c1" }, "https://discord.gg/eigen"), {
    room: ROLEPLAY_ROOM,
    roomManual: false,
  });
  assert.deepEqual(sessionRoomOf("Roleplay", null, undefined), { room: ROLEPLAY_ROOM, roomManual: false });
  assert.deepEqual(sessionRoomOf("Call-Block", null, "https://discord.gg/eigen"), {
    room: "https://discord.gg/eigen",
    roomManual: true,
  });
  assert.deepEqual(sessionRoomOf("Call-Block", { url: "https://discord.com/channels/g1/c1" }, "https://discord.gg/eigen"), {
    room: "https://discord.com/channels/g1/c1",
    roomManual: false,
  });
  assert.deepEqual(sessionRoomOf("Reflexion", { url: "https://discord.com/channels/g1/c1", closed: true }, ""), {
    room: "",
    roomManual: false,
  });
});
