import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import { isTeam, ownerIds, type Actor } from "./auth";
import { AppError, createMember, rateLimit, refusePersonalUse } from "./operator";
import { notifyApplicant, teamEvent, teamPushText, type ApplicantNotice, type Reach } from "./notify";
import { activateDesignation, DESIGNATIONS_KEY } from "./roles";
import { normalisePhone } from "../lib/phone";
import { preparedMemberForEmail, preparedMemberWithoutEmail } from "./member-directory";

/**
 * Gemeinsame Meldungen sind keine persönlichen Konten. Der Text steht an
 * einer Stelle, damit Auswahl, Anfrage und Teamfreigabe dieselbe Auskunft
 * geben.
 */
const JOINT_NOT_CLAIMABLE =
  "Das ist eine gemeinsam gemeldete Leistung von mehreren Personen und kein persönliches Profil. Melde dich bitte mit deinen eigenen Zahlen an; das Team ordnet den gemeinsamen Eintrag anschließend zu.";

// Ein vorbereitetes Profil wird nicht mehr direkt übernommen. Die Person wählt
// das Profil, bestätigt ihre E-Mail und das Deal-Operator-Team gibt die
// Zuordnung nach eigenem Abgleich frei. Weder eine passende E-Mail noch ein
// Einladungscode ersetzen diese Freigabe.
export const OPEN_STATUS = ["awaiting_email", "pending", "info_needed"] as const;
const OPEN_LIST = OPEN_STATUS.map((s) => `'${s}'`).join(",");

export type RequestKind = "claim" | "new";

const contactSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, "Bitte gib deinen vollständigen Vor- und Nachnamen an.")
    .max(120)
    // Ein Spitzname aus dem Ranking reicht dem Team für den Abgleich nicht.
    .refine((v) => /\S\s+\S/.test(v), "Bitte gib Vor- und Nachnamen an."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Bitte prüfe deine E-Mail-Adresse.")
    .max(254),
  phone: z.string().trim().min(1, "Bitte gib deine Telefonnummer an.").max(40),
  hint: z.string().trim().max(300).default(""),
});

export const startSchema = z
  .object({
    kind: z.enum(["claim", "new"]),
    // Bei einer Übernahme ohne gefundenes Profil fehlt die ID: dann sucht das
    // Team das passende Profil heraus („Zuordnung durch das Team“).
    participantId: z.string().trim().max(100).optional(),
    invite: z.string().trim().max(200).optional(),
    phoneCountry: z.string().trim().max(4).optional(),
  })
  .merge(contactSchema)
  .strict();

/**
 * Öffentliche Profilsuche vor der Anmeldung. Liefert ausschließlich Angaben,
 * die ohnehin öffentlich sichtbar sein dürfen — niemals E-Mail, Telefonnummer
 * oder den internen Importschlüssel. Bereits übernommene Profile verschwinden.
 */
export async function searchProfiles(db: Database, rawQuery: string) {
  const query = (rawQuery || "").trim().slice(0, 80);
  if (query.length < 2) return [];
  return db.query(
    `SELECT id,name,company,role FROM participants
     WHERE owner IS NULL AND searchable=true AND kind='person'
       AND (name ILIKE $1 OR company ILIKE $1)
     ORDER BY name LIMIT 25`,
    [`%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`],
  );
}

/** Öffentliche Profilangaben, wie sie die Auswahl zeigt. */
export type SuggestedProfile = { id: string; name: string; company: string; role: string };

/**
 * Konto ohne Profil: Profile aus der Rangliste, die zum Namen der Person
 * passen, damit sie ihr bestehendes Profil erkennt und kein zweites anlegt.
 * Der Name kommt aus der Registrierung (auch einer älteren, unbestätigten)
 * oder aus der laufenden Anfrage. Nur öffentliche Angaben, nie Kontaktdaten;
 * die Zuordnung selbst bleibt die Übernahme mit Teamfreigabe.
 */
export async function suggestProfiles(
  db: Database,
  actor: Actor,
  fullName = "",
): Promise<{ name: string; profiles: SuggestedProfile[] }> {
  // Eine bestätigte Adresse darf ihr eigenes internes Profil finden. Das
  // Mitgliederverzeichnis selbst bleibt unsichtbar und wird nicht aufgezählt.
  const prepared = await preparedMemberForEmail(db, actor.email);
  if (prepared && !("ambiguous" in prepared) && !prepared.owner && !prepared.hasReports)
    return { name: prepared.name, profiles: [] };
  if (prepared && !("ambiguous" in prepared) && !prepared.owner)
    return {
      name: prepared.name,
      profiles: [
        {
          id: prepared.id,
          name: prepared.name,
          company: prepared.company,
          role: prepared.role,
        },
      ],
    };
  let name = fullName.trim();
  if (!name) {
    const [r] = await db.query(
      `SELECT full_name FROM onboarding_requests
        WHERE owner=$1 OR lower(email)=$2
        ORDER BY updated_at DESC LIMIT 1`,
      [actor.userId, actor.email.toLowerCase()],
    );
    name = String(r?.full_name ?? "").trim();
  }
  const words = name.split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return { name, profiles: [] };
  // Erst der volle Name, dann Nachname, dann Vorname (ab drei Zeichen).
  const tries = [...new Set([name, ...(words.length > 1 ? [words[words.length - 1], words[0]] : [])])]
    .filter((q, i) => i === 0 || q.length >= 3);
  for (const q of tries) {
    const found = (await searchProfiles(db, q)).filter((p) => !/^team\b/i.test(String(p.role ?? "")));
    if (found.length)
      return {
        name,
        profiles: found.slice(0, 3).map((p) => ({
          id: String(p.id),
          name: String(p.name),
          company: String(p.company ?? ""),
          role: String(p.role ?? ""),
        })),
      };
  }
  return { name, profiles: [] };
}

/**
 * Ein Profil, das nicht öffentlich auffindbar ist, bleibt über eine persönliche
 * Einladung erreichbar. Der Code schaltet nur die Auswahl frei; die Freigabe
 * trifft weiterhin ausschließlich das Team.
 */
export async function profileForSelection(
  db: Database,
  id: string,
  invite?: string,
  /** Einladung wurde für diese Anfrage schon geprüft (erneutes Senden). */
  inviteChecked = false,
) {
  const [p] = await db.query(
    "SELECT id,name,company,role,kind,searchable,owner FROM participants WHERE id=$1",
    [id],
  );
  if (!p || p.owner)
    throw new AppError(
      "Dieses Profil steht nicht mehr zur Übernahme bereit. Es wurde bereits einem Konto zugeordnet.",
      409,
    );
  // Eine gemeinsame Meldung gehört mehreren Personen. Sie ist kein
  // persönliches Konto und lässt sich auch mit Einladung nicht übernehmen.
  refusePersonalUse(p, JOINT_NOT_CLAIMABLE);
  if (!p.searchable && !inviteChecked) {
    const [token] = invite
      ? await db.query(
          "SELECT hash FROM claim_tokens WHERE hash=$1 AND participant=$2 AND used_at IS NULL AND expires_at>now()",
          [inviteHash(invite), id],
        )
      : [];
    if (!token)
      throw new AppError(
        "Dieses Profil ist nur über eine persönliche Einladung erreichbar.",
        403,
      );
  }
  return { id: p.id, name: p.name, company: p.company, role: p.role };
}

function inviteHash(value: string) {
  // Einladungscodes liegen gehasht in claim_tokens; dieselbe Funktion wie dort.
  return createHash("sha256").update(value).digest("hex");
}

/** httpOnly-Cookie mit der ID der in diesem Browser gestellten Anfrage. */
export const ONBOARDING_COOKIE = "do_onboarding";

/**
 * Schritt 1: Kontaktdaten aufnehmen und die Anfrage anlegen, BEVOR die E-Mail
 * bestätigt ist. Die Auswahl überlebt dadurch den Bestätigungslink, ohne dass
 * Kontaktdaten in einer URL stehen.
 */
export async function startRequest(
  db: Database,
  raw: unknown,
  /** sha256 des Browser-Geheimnisses aus dem Cookie; siehe pendingForBrowser. */
  browserProof = "",
) {
  const v = startSchema.parse(raw);
  const note = browserProof ? `browser:${browserProof}` : "";
  const phone = normalisePhone(v.phone, v.phoneCountry);
  if (!phone.ok) throw new AppError(phone.reason, 400, undefined, "phone");

  // Kein einzelner globaler Zähler: ein Missbrauchsversuch darf nicht den
  // Einstieg für alle anderen sperren.
  //
  // Fünf Anforderungen je Viertelstunde und Adresse: eng genug, um Mailversand
  // zu begrenzen, aber weit genug für den realen Fall, dass jemand den Link
  // zuerst im falschen Browser geöffnet hat und ihn neu anfordern muss.
  await rateLimit(
    db,
    `onboarding:${v.email}`,
    5,
    900,
    "Du hast in kurzer Zeit mehrere Bestätigungsmails angefordert. Bitte nutze die letzte Mail oder warte, bis die Zeit abgelaufen ist.",
  );
  if (v.participantId)
    await rateLimit(db, `onboarding-profile:${v.participantId}`, 12, 3600);

  return db.transaction(async (tx) => {
    // Dieselbe Adresssperre wie bei der Übernahme mit Konto: gleichzeitige
    // Anfragen derselben Adresse laufen nacheinander statt in den
    // Eindeutigkeitsindex.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`email:${v.email}`]);
    let participant: string | null = null;
    if (v.kind === "claim" && v.participantId) {
      // Erneutes Senden derselben Anfrage (etwa nach einem Link-Fehler) braucht
      // den Einladungscode nicht noch einmal: er wurde beim ersten Absenden
      // geprüft. Vergeben oder gemeinsam bleibt trotzdem ausgeschlossen.
      const [prior] = await tx.query(
        `SELECT 1 FROM onboarding_requests
          WHERE lower(email)=$1 AND participant=$2 AND status IN (${OPEN_LIST}) LIMIT 1`,
        [v.email, v.participantId],
      );
      const p = await profileForSelection(tx, v.participantId, v.invite, Boolean(prior));
      participant = p.id;
    }
    const [existing] = await tx.query(
      `SELECT id,status FROM onboarding_requests
       WHERE lower(email)=$1 AND COALESCE(participant,'')=COALESCE($2,'')
         AND status IN (${OPEN_LIST}) FOR UPDATE`,
      [v.email, participant],
    );
    // Eine bestätigte, laufende Anfrage ändert dieser öffentliche Weg nicht:
    // sonst könnte jeder, der die Adresse kennt, die Angaben überschreiben,
    // die das Team gerade prüft.
    if (existing && existing.status !== "awaiting_email")
      return { id: existing.id as string, email: v.email, kind: v.kind, participant, resubmitted: true };
    if (existing) {
      // Erneutes Absenden aktualisiert die Angaben, statt eine zweite offene
      // Anfrage für dieselbe Person und dasselbe Profil anzulegen.
      // Auch die Art kann wechseln: „Ich starte neu“ und „Zuordnung durch
      // das Team“ haben beide kein vorgewähltes Profil.
      await tx.query(
        `UPDATE onboarding_requests
         SET kind=$6,full_name=$2,phone=$3,phone_input=$4,hint=$5,updated_at=now()
         WHERE id=$1`,
        [existing.id, v.fullName, phone.value, v.phone, v.hint, v.kind],
      );
      await log(tx, existing.id, v.email, "resubmitted", note);
      return { id: existing.id as string, email: v.email, kind: v.kind, participant, resubmitted: true };
    }
    const id = randomUUID();
    await tx.query(
      `INSERT INTO onboarding_requests(id,kind,participant,email,full_name,phone,phone_input,hint)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, v.kind, participant, v.email, v.fullName, phone.value, v.phone, v.hint],
    );
    await log(tx, id, v.email, "submitted", note);
    // Noch kein Team-Eintrag: die E-Mail ist unbestätigt und kann vertippt
    // oder fremd sein. Die Verwaltung sieht unbestätigte Registrierungen
    // gesammelt (siehe unconfirmedRegistrations); Eintrag, Push und E-Mail
    // entstehen erst bei der Bestätigung in bindConfirmedRequest.
    return { id, email: v.email, kind: v.kind, participant, resubmitted: false };
  });
}

/**
 * Cookie-Wert „<Anfrage-ID>.<Geheimnis>“. Die ID bindet beim Bestätigen genau
 * diese Anfrage; das Geheimnis beweist, dass DIESER Browser das letzte
 * Absenden gemacht hat (sein sha256 steht im Ereignis „submitted“ bzw.
 * „resubmitted“). Nur dann zeigt /starten die Angaben wieder an.
 */
export function browserSecret() {
  const secret = randomBytes(24).toString("base64url");
  return { secret, proof: sha256(secret) };
}
export function requestIdFromCookie(value: string | undefined) {
  const id = (value || "").split(".")[0];
  return /^[0-9a-f-]{36}$/i.test(id) ? id : undefined;
}
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Angaben der noch unbestätigten Anfrage aus DIESEM Browser, damit /starten
 * nach Zurück, Neuladen oder einem fehlgeschlagenen Link den Stand wieder
 * zeigt. Nur, wenn dieser Browser zuletzt abgeschickt hat: Wer dieselbe
 * Adresse vorher oder nachher woanders eingibt, sieht hier nichts.
 * mailSent sagt, ob nach dem letzten Absenden eine Mail wirklich an Supabase
 * übergeben wurde (Ereignis „mail_sent“); sonst wird kein Versand behauptet.
 * Ein inzwischen an jemand anderen vergebenes Profil erscheint als
 * profileTaken statt still zu verschwinden.
 */
export async function pendingForBrowser(db: Database, cookie: string | undefined) {
  const [id, secret] = (cookie || "").split(".");
  if (!requestIdFromCookie(id) || !secret || secret.length > 100) return null;
  const [r] = await db.query(
    `SELECT r.kind,r.participant,r.status,r.email,r.full_name,r.phone,r.hint,
            p.name,p.company,p.role,p.owner,
            (SELECT e.note FROM onboarding_events e
              WHERE e.request=r.id AND e.action IN ('submitted','resubmitted')
              ORDER BY e.id DESC LIMIT 1) AS proof,
            (SELECT EXTRACT(EPOCH FROM now()-m.created_at)::float FROM onboarding_events m
              WHERE m.request=r.id AND m.action='mail_sent'
                AND m.id > (SELECT max(e.id) FROM onboarding_events e
                             WHERE e.request=r.id AND e.action IN ('submitted','resubmitted'))
              ORDER BY m.id DESC LIMIT 1) AS mail_age
       FROM onboarding_requests r LEFT JOIN participants p ON p.id=r.participant
      WHERE r.id=$1 AND r.updated_at > now() - interval '2 days'
        AND (r.status='awaiting_email' OR (r.status='superseded' AND p.owner IS NOT NULL))`,
    [id],
  );
  if (!r || r.proof !== `browser:${sha256(secret)}`) return null;
  const taken = Boolean(r.participant && r.owner);
  return {
    kind: r.kind as RequestKind,
    profile: r.participant && !r.owner
      ? { id: r.participant as string, name: r.name as string, company: r.company as string, role: r.role as string }
      : null,
    profileTaken: taken,
    takenName: taken ? (r.name as string) : "",
    email: r.email as string,
    fullName: r.full_name as string,
    phone: r.phone as string,
    hint: r.hint as string,
    mailSent: r.mail_age !== null && r.mail_age !== undefined,
    /** Sekunden seit dem letzten Versand, für die Wartezeit bis „Erneut senden“. */
    secondsAgo: Number(r.mail_age) || 0,
  };
}

/**
 * Für das Gerät, das auf die Bestätigung wartet: ist die Adresse bestätigt?
 * „bestätigt“ heißt: die Anfrage wurde an ein Konto gebunden (Link auf einem
 * anderen Gerät geöffnet und angemeldet) oder der Rücksprung aus der Mail kam
 * mit gültigem Einmalcode an („link_opened“). Das wartende Gerät meldet sich
 * dann mit dem Passwort an, das es noch im Speicher hat; ob die Adresse
 * wirklich bestätigt ist, entscheidet dabei Supabase. Nur mit passendem
 * Browser-Geheimnis, sonst „none“.
 */
export async function browserRequestState(db: Database, cookie: string | undefined) {
  const [id, secret] = (cookie || "").split(".");
  if (!requestIdFromCookie(id) || !secret || secret.length > 100) return "none" as const;
  const [r] = await db.query(
    `SELECT r.status,
            (SELECT e.note FROM onboarding_events e
              WHERE e.request=r.id AND e.action IN ('submitted','resubmitted')
              ORDER BY e.id DESC LIMIT 1) AS proof,
            EXISTS(SELECT 1 FROM onboarding_events e
              WHERE e.request=r.id AND e.action='link_opened'
                AND e.id > (SELECT max(x.id) FROM onboarding_events x
                             WHERE x.request=r.id AND x.action IN ('submitted','resubmitted'))) AS opened
       FROM onboarding_requests r WHERE r.id=$1 AND r.updated_at > now() - interval '2 days'`,
    [id],
  );
  if (!r || r.proof !== `browser:${sha256(secret)}`) return "none" as const;
  if (r.status !== "awaiting_email" || r.opened) return "confirmed" as const;
  return "waiting" as const;
}

/**
 * Rücksprung aus der Bestätigungsmail auf einem anderen Gerät (ohne PKCE-
 * Verifier): Supabase hat die Adresse bestätigt, dieses Gerät bekommt aber
 * keine Sitzung. Der Hinweis weckt das wartende Gerät. Höchstens ein Eintrag
 * je Anfrage und Minute; unbekannte IDs werden still ignoriert.
 */
export async function noteLinkOpened(db: Database, requestId: string | null) {
  if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) return;
  await db.query(
    `INSERT INTO onboarding_events(request,actor,action,note)
     SELECT r.id,'link','link_opened','' FROM onboarding_requests r
      WHERE r.id=$1 AND r.status='awaiting_email'
        AND NOT EXISTS(SELECT 1 FROM onboarding_events e WHERE e.request=r.id
                        AND e.action='link_opened' AND e.created_at > now() - interval '1 minute')`,
    [requestId],
  );
}

/** Nach erfolgreicher Übergabe an Supabase: Beleg für „Mail geschickt“. */
export async function markMailSent(db: Database, id: string, email: string) {
  await log(db, id, email, "mail_sent", "");
}

/** Wie lange eine vom Team neu geschickte Bestätigung die Anfrage bindet. */
export const TEAM_RESEND_DAYS = 7;

/**
 * Das Team schickt die Bestätigungsmail einer Registrierung noch einmal, etwa
 * wenn die erste Mail nie ankam. Die Mail geht nur an die Adresse aus der
 * Anfrage; bestätigen kann also nur, wer dieses Postfach hat. Danach meldet
 * sich die Person mit ihrem Passwort an, und die Anfrage wird wie gewohnt
 * gebunden (Übernahmen gehen in die Teamprüfung). Der Versand selbst ist
 * übergeben (`send`), damit er ohne Browser-Sitzung des Teams läuft.
 */
export async function resendConfirmationByTeam(
  db: Database,
  actor: Actor,
  raw: unknown,
  send: (email: string, request: string) => Promise<void>,
) {
  if (!isTeam(actor)) throw new AppError("Nur für das Team.", 403);
  const { id } = z.object({ id: z.string().uuid() }).strict().parse(raw);
  const [r] = await db.query("SELECT id,email,status FROM onboarding_requests WHERE id=$1", [id]);
  if (!r) throw new AppError("Diese Anfrage gibt es nicht mehr.", 404);
  if (r.status !== "awaiting_email")
    throw new AppError("Die E-Mail dieser Anfrage ist schon bestätigt oder die Anfrage ist erledigt.", 409);
  await rateLimit(
    db,
    `team-resend:${id}`,
    3,
    3600,
    "Für diese Anfrage gingen in der letzten Stunde schon mehrere Mails raus. Bitte später noch einmal.",
  );
  await send(r.email as string, id);
  await log(db, id, actor.userId, "team_resent", "");
  await log(db, id, actor.userId, "mail_sent", "team");
  return { ok: true };
}

/** Hält ein Ereignis zur Anfrage fest und liefert seine ID. */
export async function logRequestEvent(
  tx: Database,
  request: string,
  actor: string,
  action: string,
  note: string,
) {
  const [row] = await tx.query(
    "INSERT INTO onboarding_events(request,actor,action,note) VALUES($1,$2,$3,$4) RETURNING id",
    [request, actor, action, note],
  );
  return String(row.id);
}
const log = logRequestEvent;

/**
 * Schritt 2: Nach bestätigter E-Mail wird die offene Anfrage an das Konto
 * gebunden. Für den Weg „Ich bin neu" entsteht direkt ein eigenes Profil; eine
 * Profilübernahme geht in die Teamprüfung.
 */
export async function bindConfirmedRequest(
  db: Database,
  actor: Actor,
  requestId: string | null | undefined,
  /** Nur eine Anfrage für genau dieses Profil binden (Anmeldung aus der Übernahme). */
  onlyParticipant?: string,
  /**
   * Vom Team freigeschaltet statt per Link bestätigt. Das Postfach hat dann
   * niemand nachgewiesen; festgehalten wird es im selben Schritt, damit die
   * Prüfung es sieht.
   */
  via?: { team: string },
) {
  // Bevorzugt wird die Anfrage aus DIESEM Browser (httpOnly-Cookie aus dem
  // Registrierungsschritt). Öffnet jemand den Link in einem anderen Browser,
  // gilt nur eine frische Anfrage (zwei Stunden, so lange wie der Link). Eine
  // alte, von fremder Hand angelegte Anfrage hängt sich so nicht an den
  // nächsten normalen Login.
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `owner:${actor.userId}`,
    ]);
    const [request] = requestId
      ? await tx.query(
          `SELECT * FROM onboarding_requests
            WHERE id=$2 AND lower(email)=$1 AND status='awaiting_email'
            FOR UPDATE`,
          [actor.email, requestId],
        )
      : await tx.query(
          // Ausnahme: das Team hat die Bestätigung für genau diese Anfrage
          // neu geschickt. Dann zählt sie einige Tage, auch ohne Cookie.
          `SELECT r.* FROM onboarding_requests r
            WHERE lower(r.email)=$1 AND r.status='awaiting_email'
              AND (r.updated_at > now() - interval '2 hours'
                OR EXISTS(SELECT 1 FROM onboarding_events e
                           WHERE e.request=r.id AND e.action='team_resent'
                             AND e.created_at > now() - make_interval(days => $2)))
            ORDER BY r.updated_at DESC LIMIT 1
            FOR UPDATE OF r`,
          [actor.email, TEAM_RESEND_DAYS],
        );
    if (!request) return null;
    if (onlyParticipant !== undefined && request.participant !== onlyParticipant) return null;
    // Wer schon ein eigenes Profil hat, bekommt keine zweite Übernahme.
    const [owned] = await tx.query("SELECT id FROM participants WHERE owner=$1", [
      actor.userId,
    ]);
    if (owned) {
      await tx.query(
        `UPDATE onboarding_requests SET owner=$2,status='superseded',updated_at=now() WHERE id=$1`,
        [request.id, actor.userId],
      );
      await log(tx, request.id, actor.userId, "superseded", "Konto hat bereits ein Profil.");
      return null;
    }
    // Läuft für dieses Konto schon eine Übernahme (z. B. angemeldet gestellt),
    // bleibt es bei dieser einen Anfrage.
    const [running] = await tx.query(
      `SELECT id FROM onboarding_requests
        WHERE owner=$1 AND kind='claim' AND status IN ('pending','info_needed') LIMIT 1`,
      [actor.userId],
    );
    if (running) {
      // Ohne owner: die abgelöste Zeile soll die laufende Anfrage auf der
      // Statusseite nicht verdecken.
      await tx.query(
        `UPDATE onboarding_requests SET status='superseded',updated_at=now() WHERE id=$1`,
        [request.id],
      );
      await log(tx, request.id, actor.userId, "superseded", "Konto hat bereits eine offene Übernahme.");
      return null;
    }
    // Erst nach Mailbestätigung: vorhandene historische Zahlen bleiben eine
    // Profilübernahme mit Teamprüfung, statt ein zweites Profil anzulegen.
    if (request.kind === "new" && !via) {
      const prepared = await preparedMemberForEmail(tx, actor.email);
      if (prepared && "ambiguous" in prepared)
        throw new AppError(
          "Zu deiner E-Mail gibt es mehrere vorbereitete Profile. Bitte lass das Team die Zuordnung prüfen.",
          409,
        );
      const missingAddress = !prepared ? await preparedMemberWithoutEmail(tx, String(request.full_name)) : null;
      if (missingAddress && "ambiguous" in missingAddress)
        throw new AppError("Zu deinem Namen gibt es mehrere vorbereitete Profile. Bitte lass das Team die Zuordnung prüfen.", 409);
      const target = prepared || missingAddress;
      if (target && !("ambiguous" in target) && (missingAddress || target.hasReports || target.owner)) {
        await tx.query(
          `UPDATE onboarding_requests SET status='superseded',updated_at=now()
           WHERE lower(email)=$1 AND status='awaiting_email' AND id<>$2`,
          [actor.email, request.id],
        );
        await tx.query(
          "UPDATE onboarding_requests SET kind='claim',participant=$2 WHERE id=$1",
          [request.id, target.id],
        );
        request.kind = "claim";
        request.participant = target.id;
      }
    }
    // Die Bindung an das Konto ist die Stelle, an der aus einer anonymen
    // Eingabe eine belegte Anfrage wird.
    await tx.query(
      `UPDATE onboarding_requests SET owner=$2,status=$3,updated_at=now() WHERE id=$1`,
      [request.id, actor.userId, request.kind === "new" ? "approved" : "pending"],
    );
    await tx.query(
      `INSERT INTO account_private(owner,email,phone) VALUES($1,$2,$3)
       ON CONFLICT(owner) DO UPDATE SET email=excluded.email,
         phone=CASE WHEN account_private.phone='' THEN excluded.phone ELSE account_private.phone END,
         updated_at=now()`,
      [actor.userId, actor.email, request.phone],
    );
    if (via) await log(tx, request.id, via.team, "team_confirmed", "");
    else await log(tx, request.id, actor.userId, "email_confirmed", "");
    // Andere noch unbestätigte Anfragen dieser Adresse (anderer Weg, anderes
    // Profil) sind damit erledigt. Sie dürften sich sonst später an das Konto
    // hängen oder eine Zuordnung durch das Team blockieren.
    await tx.query(
      `UPDATE onboarding_requests SET status='superseded',updated_at=now()
        WHERE lower(email)=$1 AND status='awaiting_email' AND id<>$2`,
      [actor.email, request.id],
    );
    // Der Übergang awaiting_email → bestätigt passiert unter Sperre genau
    // einmal. Spätere Logins, Magic-Links oder Neuladen finden keine offene
    // awaiting_email-Anfrage mehr und lösen deshalb nichts aus.
    const [wanted] = request.participant
      ? await tx.query("SELECT name FROM participants WHERE id=$1", [request.participant])
      : [];
    await teamEvent(tx, {
      dedupeKey: `registration:${request.id}`,
      kind: "registration",
      ref: request.id,
      state: request.kind === "claim" ? "review_ready" : "confirmed",
      // Eine bestätigte Registrierung braucht keine Entscheidung: nur zur Info.
      done: request.kind !== "claim",
      title:
        request.kind !== "claim"
          ? `Neue Registrierung bestätigt: ${request.full_name}`
          : request.participant
            ? `Profilübernahme prüfbereit: ${request.full_name}`
            : `Zuordnung gesucht: ${request.full_name}`,
      body: via
        ? request.kind !== "claim"
          ? "Adresse vom Team freigeschaltet, nicht per Mail bestätigt. Das eigene Profil kann jetzt angelegt werden."
          : request.participant
            ? "Adresse vom Team freigeschaltet, nicht per Mail bestätigt. Bitte die Übernahme besonders sorgfältig prüfen."
            : "Adresse vom Team freigeschaltet, nicht per Mail bestätigt. Die Person hat ihr Profil nicht gefunden. Bitte besonders sorgfältig prüfen."
        : request.kind !== "claim"
          ? "E-Mail bestätigt. Das eigene Profil kann jetzt angelegt werden."
          : request.participant
            ? "E-Mail bestätigt. Die Übernahme wartet auf eure Prüfung."
            : "E-Mail bestätigt. Die Person hat ihr Profil nicht gefunden. Bitte das passende Profil auswählen und freigeben.",
      // Einmal je Konto, egal wie viele Anfragen es später noch stellt.
      alert:
        request.kind === "claim"
          ? {
              key: `claim:${request.id}`,
              kind: "claim",
              push: teamPushText({
                kind: "claim",
                name: request.full_name,
                profile: request.participant ? ((wanted?.name as string) ?? "") : null,
                request: request.id,
              }),
            }
          : {
              key: `signup:${actor.userId}`,
              kind: "new",
              push: teamPushText({ kind: "new", name: request.full_name }),
            },
    });
    return {
      id: request.id as string,
      kind: request.kind as RequestKind,
      participant: request.participant as string | null,
      fullName: request.full_name as string,
    };
  });
}

/** Interne Profile ohne Zahlen brauchen nach bestätigter Registrierung keine Übernahme. */
export async function finishPreparedRegistration(db: Database, actor: Actor) {
  const [request] = await db.query(
    `SELECT r.full_name,a.phone FROM onboarding_requests r
     JOIN account_private a ON a.owner=r.owner
     WHERE r.owner=$1 AND lower(r.email)=$2 AND r.kind='new' AND r.status='approved'
       AND a.phone<>'' ORDER BY r.updated_at DESC LIMIT 1`,
    [actor.userId, actor.email],
  );
  if (!request) return null;
  const prepared = await preparedMemberForEmail(db, actor.email);
  if (!prepared || "ambiguous" in prepared || prepared.owner || prepared.hasReports) return null;
  return createMember(db, actor, {
    name: String(request.full_name),
    company: prepared.company,
    role: prepared.role,
  });
}

/**
 * Bestätigtes Konto ohne Registrierungsanfrage und ohne Profil (ältere Konten
 * aus der Zeit vor der Registrierung mit Passwort): nur ein Inbox-Eintrag,
 * kein Push. Eine erneute Anmeldung ist keine neue Registrierung; der Push
 * kommt, wenn daraus ein Profil oder eine Übernahme wird.
 */
export async function noteConfirmedAccount(
  db: Database,
  actor: Actor,
  /** Nur Inbox-Eintrag, ohne Push und E-Mail (der Hinweis kommt mit der Übernahme). */
  silent = false,
) {
  const [known] = await db.query(
    `SELECT 1 FROM participants WHERE owner=$1
     UNION ALL SELECT 1 FROM onboarding_requests WHERE owner=$1 LIMIT 1`,
    [actor.userId],
  );
  if (known) return;
  await db.transaction((tx) =>
    teamEvent(tx, {
      dedupeKey: `account:${actor.userId}`,
      kind: "registration",
      ref: actor.userId,
      state: "confirmed",
      done: true,
      title: `Neue Anmeldung bestätigt: ${actor.email}`,
      body: silent
        ? "E-Mail bestätigt, die Übernahme eines Profils wird gerade angefragt."
        : "E-Mail bestätigt, Profil wird gerade eingerichtet.",
      alert: false,
    }),
  );
}

/** Status und eigene Angaben für den Antragsteller. Nur die eigene Anfrage. */
export async function requestForActor(db: Database, actor: Actor) {
  const [r] = await db.query(
    `SELECT r.id,r.kind,r.status,r.full_name,r.email,r.phone,r.hint,r.applicant_message,
            r.created_at,r.updated_at,r.decided_at,p.name AS participant_name,
            (SELECT e.note FROM onboarding_events e
              WHERE e.request=r.id AND e.action='applicant_answered'
              ORDER BY e.created_at DESC LIMIT 1) AS last_answer
     FROM onboarding_requests r
     LEFT JOIN participants p ON p.id=r.participant
     WHERE r.owner=$1
     ORDER BY (r.status IN ('pending','info_needed')) DESC, r.updated_at DESC LIMIT 1`,
    [actor.userId],
  );
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    hint: r.hint,
    // Interne Prüfnotizen bleiben im Team; nur applicant_message ist sichtbar.
    message: r.applicant_message,
    lastAnswer: (r.last_answer as string | null) || "",
    participantName: r.participant_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    decidedAt: r.decided_at,
  };
}

/** Warteschlange für die Verwaltung, mit Abgleichhilfen und Konkurrenzanfragen. */
export async function reviewQueue(db: Database, actor: Actor) {
  if (!isTeam(actor)) throw new AppError("Nur für das Team.", 403);
  const rows = await db.query(
    `SELECT r.id,r.kind,r.status,r.participant,r.full_name,r.email,r.phone,r.phone_input,
            r.hint,r.internal_note,r.applicant_message,r.owner,r.created_at,r.updated_at,
            r.decided_by,r.decided_at,
            p.name AS participant_name,p.company AS participant_company,p.role AS participant_role,
            p.email AS participant_known_email,p.import_key,
            a.phone AS known_phone,
            (SELECT e.note FROM onboarding_events e
              WHERE e.request=r.id AND e.action='applicant_answered'
              ORDER BY e.created_at DESC LIMIT 1) AS applicant_answer,
            (SELECT max(e.created_at) FROM onboarding_events e
              WHERE e.request=r.id AND e.action='mail_sent') AS last_mail_at,
            EXISTS(SELECT 1 FROM onboarding_events e
              WHERE e.request=r.id AND e.action='team_confirmed') AS team_confirmed,
            (SELECT count(*) FROM onboarding_requests o
              WHERE o.participant=r.participant AND o.id<>r.id
                AND o.status IN (${OPEN_LIST})) AS competing,
            (SELECT s.value->r.participant->>'role' FROM app_settings s
              WHERE s.key=$1 AND jsonb_typeof(s.value)='object') AS designated_role
     FROM onboarding_requests r
     LEFT JOIN participants p ON p.id=r.participant
     LEFT JOIN account_private a ON a.owner=p.owner
     WHERE r.status IN (${OPEN_LIST}) OR r.decided_at > now() - interval '30 days'
     ORDER BY (r.status IN ('pending','info_needed')) DESC, r.created_at`,
    [DESIGNATIONS_KEY],
  );
  return rows;
}

export const decisionSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    decision: z.enum(["approve", "reject", "info"]),
    // Nur bei einer Zuordnungsanfrage ohne vorgewähltes Profil.
    participantId: z.string().trim().min(1).max(100).optional(),
    internalNote: z.string().trim().max(2000).default(""),
    applicantMessage: z.string().trim().max(2000).default(""),
  })
  .strict();

/** Bestätigte Anmeldeadresse eines Kontos, wie sie aus der Sitzung übernommen wurde. */
async function verifiedAddress(db: Database, owner: string) {
  const [row] = await db.query("SELECT email FROM account_private WHERE owner=$1", [owner]);
  return (row?.email as string | null | undefined) ?? null;
}

/**
 * Entscheidung des Teams. Die Freigabe ist serverseitig und atomar: das Profil
 * bekommt genau einen Eigentümer, auch wenn zwei Administratoren gleichzeitig
 * entscheiden. Andere offene Anfragen für dasselbe Profil verlieren danach
 * jeden Zugriff.
 *
 * Die anfragende Person bekommt zu jeder Entscheidung einen kurzen Hinweis
 * (Push und E-Mail), ebenso wer dasselbe Profil angefragt hatte und es durch
 * die Freigabe nicht mehr bekommt. Die Hinweise entstehen erst, nachdem die
 * Entscheidung gespeichert ist, und können sie nie aufhalten oder rückgängig
 * machen. `notified` sagt, auf welchem Weg die entschiedene Person
 * voraussichtlich erreicht wird.
 */
export async function decideRequest(db: Database, actor: Actor, raw: unknown) {
  if (!isTeam(actor))
    throw new AppError("Nur das Team kann Anfragen entscheiden.", 403);
  const v = decisionSchema.parse(raw);
  if (v.decision === "info" && v.applicantMessage.length < 3)
    throw new AppError("Bitte schreib die Rückfrage an die Person ins Nachrichtenfeld.");
  // Eine Ablehnung erklärt sich: Die Person liest den Grund auf ihrer Statusseite.
  if (v.decision === "reject" && v.applicantMessage.length < 3)
    throw new AppError("Bitte schreib der Person kurz den Grund der Ablehnung ins Nachrichtenfeld.");
  let primary: ApplicantNotice | null = null;
  const others: ApplicantNotice[] = [];
  const result = await db.transaction(async (tx) => {
    // Feste Sperrreihenfolge: zuerst das Profil, dann die Anfrage. So können
    // sich zwei gleichzeitige Entscheidungen nicht gegenseitig blockieren.
    const [peek] = await tx.query(
      "SELECT participant FROM onboarding_requests WHERE id=$1",
      [v.id],
    );
    const target = peek?.participant ?? (v.decision === "approve" ? v.participantId : undefined);
    if (target)
      await tx.query("SELECT id FROM participants WHERE id=$1 FOR UPDATE", [target]);
    const [request] = await tx.query(
      "SELECT * FROM onboarding_requests WHERE id=$1 FOR UPDATE",
      [v.id],
    );
    if (!request) throw new AppError("Diese Anfrage gibt es nicht.", 404);
    // Über die eigene Anfrage entscheidet jemand anderes im Team. Nur die feste
    // Grundverwaltung darf das selbst, damit sie sich nicht aussperrt.
    if (request.owner === actor.userId && !ownerIds().includes(actor.userId))
      throw new AppError("Über deine eigene Anfrage entscheidet jemand anderes im Team.", 403);
    if (!["pending", "info_needed"].includes(request.status))
      throw new AppError(
        "Diese Anfrage wurde bereits abschließend entschieden.",
        409,
      );
    // Adresse vor der Entscheidung: Die Freigabe schreibt sie unten neu.
    const verifiedEmail = request.owner ? await verifiedAddress(tx, request.owner) : null;
    const notice = (decision: ApplicantNotice["decision"], event: string, profile?: string) => {
      if (request.owner)
        primary = {
          request: request.id,
          recipient: request.owner,
          decision,
          event,
          email: request.email,
          verifiedEmail,
          profile,
        };
    };

    if (v.decision === "info") {
      await tx.query(
        `UPDATE onboarding_requests
         SET status='info_needed',internal_note=$2,applicant_message=$3,updated_at=now()
         WHERE id=$1`,
        [request.id, v.internalNote, v.applicantMessage],
      );
      const asked = await log(tx, request.id, actor.userId, "info_requested", v.internalNote);
      // Ein Hinweis je Rückfrage-Runde: Schärft das Team die Frage nach, bevor
      // die Person geantwortet hat, kommt kein zweiter.
      const [round] = await tx.query(
        `SELECT min(id) AS id FROM onboarding_events
          WHERE request=$1 AND action='info_requested'
            AND id > COALESCE((SELECT max(id) FROM onboarding_events
                                WHERE request=$1 AND action='applicant_answered'),0)`,
        [request.id],
      );
      notice("info", round?.id != null ? String(round.id) : asked);
      return { ok: true, status: "info_needed" };
    }

    if (v.decision === "reject") {
      await tx.query(
        `UPDATE onboarding_requests
         SET status='rejected',internal_note=$2,applicant_message=$3,
             decided_by=$4,decided_at=now(),updated_at=now()
         WHERE id=$1`,
        [request.id, v.internalNote, v.applicantMessage, actor.userId],
      );
      notice("reject", await log(tx, request.id, actor.userId, "rejected", v.internalNote));
      return { ok: true, status: "rejected" };
    }

    // approve
    if (request.kind !== "claim")
      throw new AppError(
        "Diese Anfrage betrifft kein vorbereitetes Profil.",
        400,
      );
    if (!request.participant) {
      // Zuordnungsanfrage: das Team wählt das Profil hier aus.
      if (!v.participantId)
        throw new AppError("Bitte wähle zuerst das passende Profil aus.", 400);
      request.participant = v.participantId;
      // Eine ältere offene Anfrage derselben Adresse für genau dieses Profil
      // würde den Eindeutigkeitsindex verletzen; sie ist mit dieser erledigt.
      await tx.query(
        `UPDATE onboarding_requests SET status='superseded',updated_at=now()
          WHERE lower(email)=lower($1) AND participant=$2 AND id<>$3 AND status IN (${OPEN_LIST})`,
        [request.email, v.participantId, request.id],
      );
      await tx.query("UPDATE onboarding_requests SET participant=$2 WHERE id=$1", [
        request.id,
        v.participantId,
      ]);
    }
    if (!request.owner)
      throw new AppError(
        "Diese Anfrage hat noch keine bestätigte E-Mail. Eine Freigabe ist erst danach möglich.",
        409,
      );
    // Sperre auf dem Zielprofil: zwei gleichzeitige Freigaben werden serialisiert.
    const [p] = await tx.query(
      "SELECT id,name,role,kind,owner FROM participants WHERE id=$1 FOR UPDATE",
      [request.participant],
    );
    if (!p) throw new AppError("Dieses Profil gibt es nicht mehr.", 409);
    // Zweite Sperre unter der Zeilensperre: auch eine Freigabe durch das Team
    // darf eine gemeinsame Meldung nicht in ein persönliches Konto verwandeln.
    refusePersonalUse(p, JOINT_NOT_CLAIMABLE);
    if (p.owner)
      throw new AppError(
        "Dieses Profil ist bereits einem anderen Konto zugeordnet.",
        409,
      );
    const [taken] = await tx.query(
      "SELECT id FROM participants WHERE owner=$1",
      [request.owner],
    );
    if (taken)
      throw new AppError(
        "Dieses Konto hat bereits ein Profil. Bitte zuerst im Team klären.",
        409,
      );

    const { role, superseded } = await assignProfile(
      tx,
      { id: p.id, name: p.name, role: p.role },
      request.owner,
      { email: request.email, phone: request.phone },
      request.id,
      actor.userId,
    );
    await tx.query(
      `UPDATE onboarding_requests
       SET status='approved',internal_note=$2,applicant_message=$3,
           decided_by=$4,decided_at=now(),updated_at=now()
       WHERE id=$1`,
      [request.id, v.internalNote, v.applicantMessage, actor.userId],
    );
    notice("approve", await log(tx, request.id, actor.userId, "approved", v.internalNote), p.name);
    // Wer dasselbe Profil mit einem Konto angefragt hatte, erfährt, dass es
    // vergeben ist. Unbestätigte Anfragen ohne Konto bekommen nichts.
    for (const other of superseded)
      if (other.owner && other.owner !== request.owner)
        others.push({
          request: other.id,
          recipient: other.owner,
          decision: "superseded",
          // Endgültig: je Anfrage genau einmal.
          event: "superseded",
          email: other.email,
          verifiedEmail: await verifiedAddress(tx, other.owner),
        });
    return { ok: true, status: "approved", name: p.name, role };
  });
  return { ...result, notified: await notifyAfterDecision(db, primary, others) };
}

/**
 * Ein freies Personenprofil einem Konto geben: Eigentümer, Profilangaben,
 * private Kontaktdaten, vorgemerkte Rolle, konkurrierende Anfragen und
 * Einladungscodes erledigen, Sync anstoßen. Gemeinsamer Kern der Freigabe
 * (decideRequest) und des vom Team angelegten Zugangs (server/team-access.ts).
 * Erwartet die Zeilensperre auf dem Profil; Prüfungen macht der Aufrufer.
 */
export async function assignProfile(
  tx: Database,
  p: { id: string; name: string; role?: string | null },
  owner: string,
  contact: { email: string; phone: string },
  requestId: string,
  actorId: string,
) {
  await tx.query("UPDATE participants SET owner=$2,claimed_at=now() WHERE id=$1", [p.id, owner]);
  const [oldProfile] = await tx.query("SELECT data FROM profiles WHERE id=$1", [owner]);
  const base = oldProfile
    ? JSON.parse(oldProfile.data)
    : {
        niche: "",
        time: "Flexibel",
        bio: "",
        goal: 200,
        days: [1, 2, 3, 4, 5],
        listed: false,
        channel: "Discord",
      };
  await tx.query(
    "INSERT INTO profiles(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    [owner, JSON.stringify({ ...base, name: p.name, role: p.role || "Sales" })],
  );
  await tx.query(
    `INSERT INTO account_private(owner,email,phone) VALUES($1,$2,$3)
     ON CONFLICT(owner) DO UPDATE SET email=excluded.email,
       phone=CASE WHEN account_private.phone='' THEN excluded.phone ELSE account_private.phone END,
       updated_at=now()`,
    [owner, contact.email, contact.phone],
  );
  // Eine für dieses Profil vorgemerkte Team-Rolle gilt ab jetzt, genau für
  // dieses Konto. Nur hier bekommt ein vorhandenes Profil einen Eigentümer.
  const role = await activateDesignation(tx, p.id, owner);
  if (role) await log(tx, requestId, actorId, "role_granted", role);
  // Konkurrierende offene Anfragen für dasselbe Profil sind damit erledigt.
  const superseded = await tx.query(
    `UPDATE onboarding_requests SET status='superseded',updated_at=now()
     WHERE participant=$1 AND id<>$2 AND status IN (${OPEN_LIST})
     RETURNING id,owner,email`,
    [p.id, requestId],
  );
  // Ein noch offener Einladungscode darf danach nichts mehr tun.
  await tx.query("UPDATE claim_tokens SET used_at=now() WHERE participant=$1 AND used_at IS NULL", [p.id]);
  await tx.query(
    "INSERT INTO sync_outbox(participant) VALUES($1) ON CONFLICT(participant) DO UPDATE SET revision=sync_outbox.revision+1,state='pending',attempts=0,next_attempt_at=now(),updated_at=now()",
    [p.id],
  );
  return { role, superseded };
}

/**
 * Nach der gespeicherten Entscheidung: Hinweise an die anfragenden Personen.
 * Scheitert das Anlegen, bleibt die Entscheidung bestehen; die Person sieht
 * sie auf ihrer Statusseite. Liefert, wie die entschiedene Person
 * voraussichtlich erreicht wird.
 */
async function notifyAfterDecision(
  db: Database,
  primary: ApplicantNotice | null,
  others: ApplicantNotice[],
): Promise<Reach[]> {
  let reach: Reach[] = [];
  for (const notice of [primary, ...others]) {
    if (!notice) continue;
    try {
      const channels = await notifyApplicant(db, notice);
      if (notice === primary) reach = channels;
    } catch (error) {
      // Nur die Meldung, keine Adressen oder Inhalte.
      console.error("Hinweis zur Profilübernahme nicht angelegt:", (error as Error).message);
    }
  }
  return reach;
}

/** Offene Übernahmeanfrage eines Kontos — blockiert ein zweites Profil. */
export async function openClaimRequest(db: Database, userId: string) {
  const [r] = await db.query(
    `SELECT id FROM onboarding_requests
     WHERE owner=$1 AND kind='claim' AND status IN ('pending','info_needed') LIMIT 1`,
    [userId],
  );
  return r ? (r.id as string) : null;
}

export const claimSchema = z
  .object({
    // Fehlt, wenn die Person ihr Profil nicht findet: Zuordnung durch das Team.
    participantId: z.string().trim().min(1).max(100).optional(),
    phoneCountry: z.string().trim().max(4).optional(),
    invite: z.string().trim().max(200).optional(),
    fullName: contactSchema.shape.fullName,
    phone: contactSchema.shape.phone,
    hint: contactSchema.shape.hint,
  })
  .strict();

/**
 * Übernahme mit einem bereits angemeldeten Konto. Die E-Mail ist bestätigt,
 * deshalb gibt es keinen zweiten Bestätigungslink; die Anfrage geht direkt in
 * die Teamprüfung. Wie beim Weg über die Registrierung gilt: Weder die
 * bestätigte E-Mail noch ein Einladungscode geben das Profil frei.
 *
 * Wiederholtes Absenden für dasselbe Profil ändert nur die Angaben derselben
 * Anfrage; es entsteht weder eine zweite Anfrage noch ein zweiter
 * Team-Hinweis.
 */
export async function requestClaimSignedIn(db: Database, actor: Actor, raw: unknown) {
  const v = claimSchema.parse(raw);
  const phone = normalisePhone(v.phone, v.phoneCountry);
  if (!phone.ok) throw new AppError(phone.reason, 400, undefined, "phone");
  const wanted = v.participantId ?? null;
  // Nur das Konto zählt. Der öffentliche Profilzähler des anonymen Starts
  // darf die Anfrage des angemeldeten Inhabers nicht blockieren.
  await rateLimit(
    db,
    `claim-account:${actor.userId}`,
    10,
    3600,
    "Zu viele Anfragen in kurzer Zeit. Bitte versuche es in einer Stunde noch einmal.",
  );

  return db.transaction(async (tx) => {
    // Dieselbe Sperre wie bei Profilanlage und Bindung: pro Konto läuft immer
    // nur einer dieser Schritte. Dazu die Adresssperre aus startRequest.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `owner:${actor.userId}`,
    ]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`email:${actor.email}`]);
    const [owned] = await tx.query("SELECT id FROM participants WHERE owner=$1", [
      actor.userId,
    ]);
    if (owned)
      throw new AppError(
        "Dein Konto hat bereits ein eigenes Profil. Eine zweite Übernahme ist nicht möglich.",
        409,
      );

    const [open] = await tx.query(
      `SELECT id,participant,status FROM onboarding_requests
        WHERE owner=$1 AND kind='claim' AND status IN ('pending','info_needed')
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [actor.userId],
    );
    if (open && open.participant !== wanted)
      throw new AppError(
        "Für dein Konto läuft bereits eine Übernahmeanfrage. Bitte warte die Prüfung durch das Team ab.",
        409,
      );
    if (open) {
      await tx.query(
        `UPDATE onboarding_requests SET full_name=$2,phone=$3,phone_input=$4,hint=$5,updated_at=now()
          WHERE id=$1`,
        [open.id, v.fullName, phone.value, v.phone, v.hint],
      );
      await log(tx, open.id, actor.userId, "resubmitted", "");
      return { id: open.id as string, status: open.status as string, repeated: true };
    }

    let p: { id: string } | null = null;
    if (wanted) {
      // Prüft: noch frei, persönliches Profil, auffindbar oder gültige Einladung.
      const prepared = await preparedMemberForEmail(tx, actor.email);
      const ownDirectorySelection =
        !!prepared && !("ambiguous" in prepared) && prepared.id === wanted;
      p = await profileForSelection(
        tx,
        wanted,
        v.invite,
        ownDirectorySelection,
      );
      // Wartet auf eine gerade laufende Freigabe und sieht danach deren Ergebnis.
      const [still] = await tx.query("SELECT owner FROM participants WHERE id=$1 FOR SHARE", [p.id]);
      if (still?.owner)
        throw new AppError(
          "Dieses Profil steht nicht mehr zur Übernahme bereit. Es wurde bereits einem Konto zugeordnet.",
          409,
        );
    }

    // Eine noch unbestätigte Anfrage derselben Adresse für dasselbe Profil (etwa
    // aus einem anderen Browser) wird zu dieser Anfrage, statt eine zweite
    // anzulegen.
    const [waiting] = await tx.query(
      `SELECT id FROM onboarding_requests
        WHERE lower(email)=$1 AND COALESCE(participant,'')=COALESCE($2,'')
          AND status='awaiting_email' FOR UPDATE`,
      [actor.email, p?.id ?? null],
    );
    const id = (waiting?.id as string | undefined) ?? randomUUID();
    if (waiting)
      await tx.query(
        `UPDATE onboarding_requests
            SET owner=$2,status='pending',kind='claim',full_name=$3,phone=$4,phone_input=$5,
                hint=$6,created_at=now(),updated_at=now()
          WHERE id=$1`,
        [id, actor.userId, v.fullName, phone.value, v.phone, v.hint],
      );
    else
      await tx.query(
        `INSERT INTO onboarding_requests(id,kind,participant,email,full_name,phone,phone_input,hint,status,owner)
         VALUES($1,'claim',$2,$3,$4,$5,$6,$7,'pending',$8)`,
        [id, p?.id ?? null, actor.email, v.fullName, phone.value, v.phone, v.hint, actor.userId],
      );
    // Andere noch unbestätigte Anfragen dieser Adresse dürfen sich später nicht
    // mehr an das Konto hängen.
    await tx.query(
      `UPDATE onboarding_requests SET status='superseded',updated_at=now()
        WHERE lower(email)=$1 AND status='awaiting_email' AND id<>$2`,
      [actor.email, id],
    );
    await log(tx, id, actor.userId, "submitted_signed_in", "");
    await tx.query(
      `INSERT INTO account_private(owner,email,phone) VALUES($1,$2,$3)
       ON CONFLICT(owner) DO UPDATE SET email=excluded.email,
         phone=CASE WHEN account_private.phone='' THEN excluded.phone ELSE account_private.phone END,
         updated_at=now()`,
      [actor.userId, actor.email, phone.value],
    );
    await teamEvent(tx, {
      dedupeKey: `registration:${id}`,
      kind: "registration",
      ref: id,
      state: "review_ready",
      title: p ? `Profilübernahme prüfbereit: ${v.fullName}` : `Zuordnung gesucht: ${v.fullName}`,
      body: p
        ? "Angefragt mit einem angemeldeten Konto, E-Mail bestätigt. Die Übernahme wartet auf eure Prüfung."
        : "Angemeldetes Konto, E-Mail bestätigt. Die Person hat ihr Profil nicht gefunden. Bitte das passende Profil auswählen und freigeben.",
      // Genau einmal je Anfrage, auch bei wiederholtem Absenden.
      alert: {
        key: `claim:${id}`,
        kind: "claim",
        push: teamPushText({
          kind: "claim",
          name: v.fullName,
          profile: p
            ? (((await tx.query("SELECT name FROM participants WHERE id=$1", [p.id]))[0]?.name as string) ?? "")
            : null,
          request: id,
        }),
      },
    });
    return { id, status: "pending", repeated: false };
  });
}

const answerSchema = z
  .object({ message: z.string().trim().min(3, "Bitte schreib kurz deine Antwort.").max(1000) })
  .strict();

/**
 * Antwort auf eine Rückfrage des Teams. Die Anfrage geht damit zurück in die
 * Prüfung; das Team sieht die Antwort unter Übernahmen und bekommt einen
 * Hinweis.
 */
export async function answerInfoRequest(db: Database, actor: Actor, raw: unknown) {
  const v = answerSchema.parse(raw);
  await rateLimit(
    db,
    `claim-answer:${actor.userId}`,
    5,
    3600,
    "Zu viele Antworten in kurzer Zeit. Bitte versuche es in einer Stunde noch einmal.",
  );
  return db.transaction(async (tx) => {
    const [request] = await tx.query(
      `SELECT id,full_name FROM onboarding_requests
        WHERE owner=$1 AND status='info_needed' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [actor.userId],
    );
    if (!request)
      throw new AppError("Zu deiner Anfrage gibt es gerade keine offene Rückfrage.", 409);
    const [event] = await tx.query(
      `INSERT INTO onboarding_events(request,actor,action,note)
       VALUES($1,$2,'applicant_answered',$3) RETURNING id`,
      [request.id, actor.userId, v.message],
    );
    await tx.query(
      "UPDATE onboarding_requests SET status='pending',updated_at=now() WHERE id=$1",
      [request.id],
    );
    await teamEvent(tx, {
      dedupeKey: `answer:${event.id}`,
      kind: "registration",
      ref: request.id,
      state: "review_ready",
      title: `Antwort auf Rückfrage: ${request.full_name}`,
      body: "Die Person hat auf eure Rückfrage geantwortet. Die Antwort steht unter Übernahmen.",
      // Nur Inbox, kein Push: Team-Pushs gibt es nur für neue Registrierungen
      // und neue Übernahmeanfragen.
      alert: false,
    });
    return { ok: true, status: "pending" };
  });
}
