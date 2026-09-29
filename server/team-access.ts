import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import type { Actor } from "./auth";
import { AppError, rateLimit } from "./operator";
import { teamEvent } from "./notify";
import { assignProfile, bindConfirmedRequest, logRequestEvent, OPEN_STATUS } from "./onboarding";
import { passwordSchema } from "./email-auth";
import { nameSlug } from "./sessions";

const OPEN_LIST = OPEN_STATUS.map((s) => `'${s}'`).join(",");

/**
 * Zugang durch das Team. Bestätigungsmails kommen bei manchen Postfächern nicht
 * an; Admins lassen Leute deshalb selbst herein:
 * - Freischalten: eine hängende Registrierung (awaiting_email) bekommt die
 *   bestätigte Adresse. Die Person meldet sich mit ihrem eigenen Passwort an.
 * - Zugang anlegen: Konto mit Passwort, direkt einem Profil zugeordnet.
 *
 * Die App hat keinen service_role-Schlüssel und keine Rechte auf das Schema
 * auth. Beides läuft über zwei eng begrenzte Datenbankfunktionen aus
 * Migration 0006. Fehlen sie, ist die Funktion aus (teamAccessReady); sonst
 * hängt nichts davon ab. Passwörter gehen nur an Supabase, nie in die
 * Datenbank, ins Log oder in eine Antwort.
 */

let cache: { ok: boolean; at: number } | null = null;
/** Gibt es die Funktionen? Einmal vorhanden, bleibt es so; sonst neu nachsehen nach 5 Minuten. */
export async function teamAccessReady(db: Database) {
  if (cache?.ok) return true;
  if (cache && Date.now() - cache.at < 300_000) return false;
  const [row] = await db.query(
    `SELECT to_regprocedure('operator.team_confirm_account(text)') IS NOT NULL
        AND to_regprocedure('operator.team_account_status(text)') IS NOT NULL AS ok`,
  );
  cache = { ok: !!row?.ok, at: Date.now() };
  return cache.ok;
}
/** Nur für Tests. */
export function resetTeamAccessCache() {
  cache = null;
}

async function requireAdminReady(db: Database, actor: Actor, message: string) {
  if (!actor.admin) throw new AppError(message, 403);
  if (!(await teamAccessReady(db)))
    throw new AppError("Diese Funktion wird erst mit Migration 0006 freigeschaltet.", 503);
}

type Status = { user_id: string; confirmed: boolean; has_password: boolean; created_at: Date | string | null };
async function accountStatus(db: Database, email: string): Promise<Status | null> {
  const [row] = await db.query<Status>(
    "SELECT user_id,confirmed,has_password,created_at FROM operator.team_account_status($1)",
    [email],
  );
  return row ?? null;
}
type Confirm = { status: "missing" | "no_password" | "already" | "confirmed"; user_id: string | null };
async function confirmAccount(db: Database, email: string): Promise<Confirm> {
  const [row] = await db.query<Confirm>("SELECT status,user_id FROM operator.team_confirm_account($1)", [email]);
  return row ?? { status: "missing", user_id: null };
}

const NO_PASSWORD =
  "Für diese Adresse gibt es ein Konto ohne Passwort. Die Person soll die Registrierung noch einmal mit Passwort absenden.";

/**
 * Hängende Registrierung freischalten. Nur Admins, nur für Anfragen, die auf
 * die Bestätigung warten, und nur, wenn es ein Konto mit Passwort gibt. Danach
 * wird die Anfrage wie nach dem Klick auf den Link gebunden: „neu“ ist sofort
 * freigegeben, eine Übernahme geht in die Teamprüfung.
 */
export async function confirmRegistrationByTeam(db: Database, actor: Actor, raw: unknown) {
  await requireAdminReady(db, actor, "Freischalten können nur Admins.");
  const { id } = z.object({ id: z.string().uuid() }).strict().parse(raw);
  await rateLimit(db, `team-confirm:${actor.userId}`, 30, 3600);
  const [request] = await db.query("SELECT id,kind,email,full_name,status FROM onboarding_requests WHERE id=$1", [id]);
  if (!request) throw new AppError("Diese Anfrage gibt es nicht mehr.", 404);
  if (request.status !== "awaiting_email")
    throw new AppError("Diese Registrierung ist schon bestätigt oder erledigt.", 409);
  const email = String(request.email).toLowerCase();
  const result = await confirmAccount(db, email);
  if (result.status === "missing")
    throw new AppError(
      "Zu dieser Registrierung gibt es noch kein Konto. Die Person soll die Registrierung noch einmal absenden.",
      409,
    );
  if (result.status === "no_password") throw new AppError(NO_PASSWORD, 409);
  // Das Postfach hat dabei niemand nachgewiesen: festgehalten als
  // 'team_confirmed' (nicht 'email_confirmed'), damit die Prüfung es sieht.
  const bound = await bindConfirmedRequest(
    db,
    { userId: result.user_id!, email, admin: false },
    request.id,
    undefined,
    { team: actor.userId },
  );
  // Nicht gebunden (etwa weil das Konto schon ein Profil hat): die Bestätigung
  // durch das Team trotzdem festhalten.
  if (!bound) await logRequestEvent(db, request.id, actor.userId, "team_confirmed", "nicht gebunden");
  return {
    ok: true,
    kind: request.kind as "new" | "claim",
    name: request.full_name as string,
    bound: !!bound,
  };
}

/** Name zum Vergleichen: klein, Leerzeichen zusammengezogen. */
const sameName = (value: string) => value.toLocaleLowerCase("de").replace(/\s+/g, " ").trim();

const accessSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Bitte gib einen Namen an.")
      .max(80, "Bitte nimm höchstens 80 Zeichen."),
    email: z.string().trim().toLowerCase().email("Bitte prüfe die E-Mail-Adresse.").max(254),
    password: passwordSchema,
    participant: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** Konto bei Supabase anlegen; liefert die Konto-ID. In Tests ersetzt. */
export type SignUp = (email: string, password: string, name: string) => Promise<string>;

type Person = { id: string; name: string; role: string | null; kind: string; owner: string | null };

/** Personenprofil für einen Zugang: vorhanden, persönlich, noch ohne Konto. */
function checkProfile(p: Person | undefined) {
  if (!p) throw new AppError("Dieses Profil gibt es nicht.", 404, undefined, "participant");
  if (p.kind !== "person")
    throw new AppError("Gemeinsame Meldungen bekommen kein Konto. Bitte wähle ein Personenprofil.", 409, undefined, "participant");
  if (p.owner) throw new AppError("Dieses Profil hat schon ein Konto.", 409, undefined, "participant");
  return p;
}

/** Gleichnamiges Personenprofil ohne Konto: dann genau dieses auswählen. */
async function refuseDuplicate(db: Database, name: string) {
  const want = sameName(name);
  const twin = (await db.query<{ id: string; name: string }>(
    "SELECT id,name FROM participants WHERE kind='person' AND owner IS NULL",
  )).find((p) => sameName(p.name) === want);
  if (twin)
    throw new AppError(
      `„${twin.name}“ gibt es schon als Profil ohne Konto. Bitte wähle genau dieses Profil aus der Liste unter dem Namen, damit die bisherigen Zahlen dazugehören. Ist es eine andere Person, ergänze den Namen (etwa um den Nachnamen).`,
      409,
      undefined,
      "participant",
    );
}

/**
 * Hat die Person unter dieser Adresse schon ein bestimmtes Profil zur
 * Übernahme angefragt, gehört der Zugang genau dorthin. Sonst entstünde ein
 * zweites Profil, und die Übernahme würde still verworfen.
 */
async function refuseOtherThanClaimed(db: Database, email: string, participant: string | undefined) {
  const claimed = await db.query<{ id: string; name: string }>(
    `SELECT DISTINCT p.id,p.name FROM onboarding_requests r JOIN participants p ON p.id=r.participant
      WHERE lower(r.email)=$1 AND r.status IN (${OPEN_LIST}) AND p.owner IS NULL AND p.kind='person'
      ORDER BY p.name`,
    [email],
  );
  if (claimed.length && !claimed.some((p) => p.id === participant))
    throw new AppError(
      `„${claimed[0].name}“ hat die Person zur Übernahme angefragt. Bitte dieses Profil auswählen.`,
      409,
      undefined,
      "participant",
    );
}

/**
 * Merker für einen Zugang, den das Team gerade anlegt, ohne Passwort. Er
 * entsteht vor dem Konto. Scheitert danach etwas, erkennt ein neuer Versuch
 * daran das Konto als eigenes (Passwort von damals) statt als fremde
 * Registrierung. Nur die App schreibt diesen Status, nie die Person selbst.
 */
const SETUP = "team_setup";
type Setup = { id: string; updated_at: Date | string };
async function setupFor(db: Database, email: string) {
  const [row] = await db.query<Setup>(
    `SELECT id,updated_at FROM onboarding_requests WHERE lower(email)=$1 AND status='${SETUP}'
      ORDER BY updated_at DESC LIMIT 1`,
    [email],
  );
  return row ?? null;
}
/** Konto aus einem früheren Versuch des Teams: kurz nach dem Merker entstanden. */
function madeByTeam(setup: Setup | null, status: Status) {
  if (!setup || !status.created_at) return false;
  const made = new Date(status.created_at).getTime();
  const marked = new Date(setup.updated_at).getTime();
  // Etwas Spielraum für die Uhr des Anmeldedienstes; danach nur wenige Minuten.
  return made >= marked - 60_000 && made <= marked + 10 * 60_000;
}

const UNCONFIRMED =
  "Für diese Adresse läuft schon eine Registrierung mit einem Passwort, das ihr nicht kennt. Nutze „Freischalten“ in der Team-Inbox (Übernahmen gehen dann in eure Prüfung) oder lass das unbestätigte Konto im Supabase-Dashboard löschen und leg den Zugang danach neu an.";

/**
 * Zugang anlegen: Konto mit Passwort, direkt einem Profil zugeordnet. Nur
 * Admins. Das Profil bekommt den Eigentümer wie bei einer Freigabe
 * (assignProfile). Ein schon bestätigtes Konto ohne Profil behält sein
 * Passwort (passwordSet: false). Ein unbestätigtes fremdes Konto wird nicht
 * angefasst: Sein Passwort stammt von dem, der die Adresse zuerst registriert
 * hat, und das kann das Team nicht wissen.
 */
export async function createAccessByTeam(db: Database, actor: Actor, raw: unknown, signUp: SignUp) {
  await requireAdminReady(db, actor, "Zugänge anlegen können nur Admins.");
  const v = accessSchema.parse(raw);
  await rateLimit(db, `team-access:${actor.userId}`, 30, 3600);

  // a) Konto nachsehen, noch ohne etwas zu ändern.
  const status = await accountStatus(db, v.email);
  let setup = await setupFor(db, v.email);
  const earlier = !!status && madeByTeam(setup, status);
  if (status) {
    const [owned] = await db.query("SELECT 1 FROM participants WHERE owner=$1", [status.user_id]);
    if (owned) throw new AppError("Für diese Adresse gibt es schon einen Zugang.", 409, undefined, "email");
    if (!status.has_password) throw new AppError(NO_PASSWORD, 409, undefined, "email");
    if (!status.confirmed && !earlier) throw new AppError(UNCONFIRMED, 409, undefined, "email");
  }

  // b) Profil klären, bevor ein Konto entsteht.
  if (v.participant)
    checkProfile(
      (await db.query<Person>("SELECT id,name,role,kind,owner FROM participants WHERE id=$1", [v.participant]))[0],
    );
  else await refuseDuplicate(db, v.name);
  await refuseOtherThanClaimed(db, v.email, v.participant);

  // c) Neues Konto: erst der Merker, dann signUp. Das Passwort geht nur an Supabase.
  let created: string | null = null;
  if (!status) {
    if (setup)
      await db.query(
        "UPDATE onboarding_requests SET full_name=$2,participant=$3,decided_by=$4,updated_at=now() WHERE id=$1",
        [setup.id, v.name, v.participant ?? null, actor.userId],
      );
    else {
      const id = randomUUID();
      await db.query(
        `INSERT INTO onboarding_requests(id,kind,participant,email,full_name,phone,status,decided_by,internal_note)
         VALUES($1,$2,$3,$4,$5,'','${SETUP}',$6,'Zugang vom Team wird angelegt.')`,
        [id, v.participant ? "claim" : "new", v.participant ?? null, v.email, v.name, actor.userId],
      );
      setup = { id, updated_at: new Date() };
    }
    await logRequestEvent(db, setup!.id, actor.userId, "team_signup", "");
    created = await signUp(v.email, v.password, v.name);
  }
  const userId = created ?? status!.user_id;
  const passwordSet = !!created || earlier;

  // d) Bestätigen und Profil zuordnen, in einem Schritt wie bei der Freigabe.
  let result: { participant: string; created: boolean };
  try {
    result = await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`owner:${userId}`]);
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`email:${v.email}`]);
      const confirmed = await confirmAccount(tx, v.email);
      if (confirmed.status === "no_password") throw new AppError(NO_PASSWORD, 409, undefined, "email");
      if ((confirmed.status !== "confirmed" && confirmed.status !== "already") || confirmed.user_id !== userId)
        throw new AppError("Das Konto ließ sich gerade nicht bestätigen.", 503);
      let p: Person;
      let fresh = false;
      if (v.participant) {
        p = checkProfile(
          (await tx.query<Person>("SELECT id,name,role,kind,owner FROM participants WHERE id=$1 FOR UPDATE", [v.participant]))[0],
        );
      } else {
        await refuseDuplicate(tx, v.name);
        p = await newProfile(tx, v.name);
        fresh = true;
      }
      const [taken] = await tx.query("SELECT 1 FROM participants WHERE owner=$1", [userId]);
      if (taken) throw new AppError("Für diese Adresse gibt es schon einen Zugang.", 409, undefined, "email");

      // Offene Anfragen dieser Adresse sind damit erledigt (etwa eine alte
      // Registrierung ohne Konto).
      await tx.query(
        `UPDATE onboarding_requests SET status='superseded',updated_at=now()
          WHERE lower(email)=$1 AND status IN (${OPEN_LIST})`,
        [v.email],
      );
      const requestId = setup?.id ?? randomUUID();
      const values = [requestId, fresh ? "new" : "claim", p.id, v.email, v.name, userId, actor.userId];
      if (setup)
        await tx.query(
          `UPDATE onboarding_requests SET kind=$2,participant=$3,email=$4,full_name=$5,status='approved',owner=$6,
             internal_note='Zugang vom Team angelegt.',decided_by=$7,decided_at=now(),updated_at=now()
           WHERE id=$1`,
          values,
        );
      else
        await tx.query(
          `INSERT INTO onboarding_requests(id,kind,participant,email,full_name,phone,status,owner,
             internal_note,decided_by,decided_at)
           VALUES($1,$2,$3,$4,$5,'','approved',$6,'Zugang vom Team angelegt.',$7,now())`,
          values,
        );
      await assignProfile(tx, p, userId, { email: v.email, phone: "" }, requestId, actor.userId);
      await logRequestEvent(tx, requestId, actor.userId, "team_access", fresh ? "neues Profil" : "vorhandenes Profil");
      await teamEvent(tx, {
        dedupeKey: `team-access:${requestId}`,
        kind: "registration",
        ref: requestId,
        state: "confirmed",
        done: true,
        title: `Zugang angelegt: ${v.name}`,
        body: "Vom Team angelegt. Die Person meldet sich mit E-Mail und Passwort an.",
        alert: false,
      });
      return { participant: p.id, created: fresh };
    });
  } catch (error) {
    // Das Konto steht schon mit dem eingegebenen Passwort. Ein neuer Versuch
    // erkennt es am Merker; das Passwort gilt aber nur, wenn es dasselbe bleibt.
    if (!created) throw error;
    const hint = "Das Konto ist schon mit dem eingegebenen Passwort angelegt. Bitte versuche es mit demselben Passwort erneut.";
    if (error instanceof AppError) throw new AppError(`${error.message} ${hint}`, error.status, undefined, error.field);
    throw new AppError(`Die Zuordnung zum Profil ist fehlgeschlagen. ${hint}`, 503);
  }
  return {
    ok: true,
    name: v.name,
    email: v.email,
    ...result,
    passwordSet,
    /** Konto aus einem früheren, abgebrochenen Versuch: es gilt das Passwort von damals. */
    earlier,
    /** Neues Konto: Supabase hat seine Bestätigungsmail geschickt. */
    newAccount: passwordSet,
  };
}

/** Neues Personenprofil; import_key „team-name“, bei Kollision mit Zufallsendung. */
async function newProfile(tx: Database, name: string): Promise<Person> {
  const base = `team-${nameSlug(name)}`;
  for (let key = base; ; key = `${base}-${randomBytes(3).toString("hex")}`) {
    const [p] = await tx.query<Person>(
      `INSERT INTO participants(id,import_key,name,company,role,public_consent,searchable,kind)
       VALUES($1,$2,$3,'','',true,true,'person') ON CONFLICT(import_key) DO NOTHING
       RETURNING id,name,role,kind,owner`,
      [randomUUID(), key, name],
    );
    if (p) return p;
  }
}

/** Personenprofile ohne Konto für die Auswahl beim Anlegen. Nur Admins. */
export async function accountlessProfiles(db: Database, actor: Actor) {
  if (!actor.admin) throw new AppError("Nur für Admins.", 403);
  return db.query<{ id: string; name: string }>(
    "SELECT id,name FROM participants WHERE kind='person' AND owner IS NULL ORDER BY name",
  );
}
