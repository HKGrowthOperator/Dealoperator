import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import { isTeam, ownerIds, type Actor } from "./auth";
import { AppError, rateLimit, refusePersonalUse } from "./operator";
import { teamEvent } from "./notify";
import { normalisePhone } from "../lib/phone";

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

/**
 * Ein Profil, das nicht öffentlich auffindbar ist, bleibt über eine persönliche
 * Einladung erreichbar. Der Code schaltet nur die Auswahl frei; die Freigabe
 * trifft weiterhin ausschließlich das Team.
 */
export async function profileForSelection(
  db: Database,
  id: string,
  invite?: string,
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
  if (!p.searchable) {
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
export async function startRequest(db: Database, raw: unknown) {
  const v = startSchema.parse(raw);
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
      const p = await profileForSelection(tx, v.participantId, v.invite);
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
      return { id: existing.id as string, kind: v.kind, participant, resubmitted: true };
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
      await log(tx, existing.id, v.email, "resubmitted", "");
      return { id: existing.id as string, kind: v.kind, participant, resubmitted: true };
    }
    const id = randomUUID();
    await tx.query(
      `INSERT INTO onboarding_requests(id,kind,participant,email,full_name,phone,phone_input,hint)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, v.kind, participant, v.email, v.fullName, phone.value, v.phone, v.hint],
    );
    await log(tx, id, v.email, "submitted", "");
    // Noch kein Team-Eintrag: die E-Mail ist unbestätigt und kann vertippt
    // oder fremd sein. Die Verwaltung sieht unbestätigte Registrierungen
    // gesammelt (siehe unconfirmedRegistrations); Eintrag, Push und E-Mail
    // entstehen erst bei der Bestätigung in bindConfirmedRequest.
    return { id, kind: v.kind, participant, resubmitted: false };
  });
}

/**
 * Angaben der noch unbestätigten Anfrage aus DIESEM Browser (httpOnly-Cookie),
 * damit /starten nach Zurück, Neuladen oder einem fehlgeschlagenen Link den
 * Stand wieder zeigt, statt alles neu abzufragen. Nur solange die E-Mail
 * unbestätigt ist und die Anfrage frisch ist; danach gilt die Anmeldung.
 */
export async function pendingForBrowser(db: Database, id: string | undefined) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db.query(
    `SELECT r.kind,r.participant,r.email,r.full_name,r.phone,r.hint,
            EXTRACT(EPOCH FROM now()-r.updated_at)::float AS age,
            p.name,p.company,p.role,p.owner
       FROM onboarding_requests r LEFT JOIN participants p ON p.id=r.participant
      WHERE r.id=$1 AND r.status='awaiting_email'
        AND r.updated_at > now() - interval '2 days'`,
    [id],
  );
  if (!r) return null;
  return {
    kind: r.kind as RequestKind,
    // Ein inzwischen vergebenes Profil wird nicht wieder angeboten.
    profile:
      r.participant && !r.owner
        ? { id: r.participant as string, name: r.name as string, company: r.company as string, role: r.role as string }
        : null,
    profileTaken: Boolean(r.participant && r.owner),
    email: r.email as string,
    fullName: r.full_name as string,
    phone: r.phone as string,
    hint: r.hint as string,
    /** Sekunden seit dem letzten Absenden, für die Wartezeit bis „Erneut senden“. */
    secondsAgo: Number(r.age) || 0,
  };
}

async function log(
  tx: Database,
  request: string,
  actor: string,
  action: string,
  note: string,
) {
  await tx.query(
    "INSERT INTO onboarding_events(request,actor,action,note) VALUES($1,$2,$3,$4)",
    [request, actor, action, note],
  );
}

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
          `SELECT * FROM onboarding_requests
            WHERE lower(email)=$1 AND status='awaiting_email'
              AND updated_at > now() - interval '2 hours'
            ORDER BY updated_at DESC LIMIT 1
            FOR UPDATE`,
          [actor.email],
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
    await log(tx, request.id, actor.userId, "email_confirmed", "");
    // Der Übergang awaiting_email → bestätigt passiert unter Sperre genau
    // einmal. Spätere Logins, Magic-Links oder Neuladen finden keine offene
    // awaiting_email-Anfrage mehr und lösen deshalb nichts aus.
    await teamEvent(tx, {
      dedupeKey: `registration:${request.id}`,
      kind: "registration",
      ref: request.id,
      state: request.kind === "claim" ? "review_ready" : "confirmed",
      title:
        request.kind !== "claim"
          ? `Neue Registrierung bestätigt: ${request.full_name}`
          : request.participant
            ? `Profilübernahme prüfbereit: ${request.full_name}`
            : `Zuordnung gesucht: ${request.full_name}`,
      body:
        request.kind !== "claim"
          ? "E-Mail bestätigt. Das eigene Profil kann jetzt angelegt werden."
          : request.participant
            ? "E-Mail bestätigt. Die Übernahme wartet auf eure Prüfung."
            : "E-Mail bestätigt. Die Person hat ihr Profil nicht gefunden. Bitte das passende Profil auswählen und freigeben.",
      // Einmal je Konto, egal wie viele Anfragen es später noch stellt.
      alert:
        request.kind === "claim"
          ? { key: `claim:${request.id}`, kind: "claim" }
          : { key: `signup:${actor.userId}`, kind: "new" },
    });
    return {
      id: request.id as string,
      kind: request.kind as RequestKind,
      participant: request.participant as string | null,
      fullName: request.full_name as string,
    };
  });
}

/**
 * Bestätigtes Konto ohne Registrierungsanfrage und ohne Profil (z. B. über
 * „Anmelden“ mit neuer Adresse): das Team erfährt es genau einmal je Konto.
 * Derselbe Schlüssel wie bei der Registrierung, also nie doppelt.
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
      title: `Neue Anmeldung bestätigt: ${actor.email}`,
      body: silent
        ? "E-Mail bestätigt, die Übernahme eines Profils wird gerade angefragt."
        : "E-Mail bestätigt, Profil wird gerade eingerichtet.",
      alert: silent ? false : { key: `signup:${actor.userId}`, kind: "new" },
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
            (SELECT count(*) FROM onboarding_requests o
              WHERE o.participant=r.participant AND o.id<>r.id
                AND o.status IN (${OPEN_LIST})) AS competing
     FROM onboarding_requests r
     LEFT JOIN participants p ON p.id=r.participant
     LEFT JOIN account_private a ON a.owner=p.owner
     WHERE r.status IN (${OPEN_LIST}) OR r.decided_at > now() - interval '30 days'
     ORDER BY (r.status IN ('pending','info_needed')) DESC, r.created_at`,
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

/**
 * Entscheidung des Teams. Die Freigabe ist serverseitig und atomar: das Profil
 * bekommt genau einen Eigentümer, auch wenn zwei Administratoren gleichzeitig
 * entscheiden. Andere offene Anfragen für dasselbe Profil verlieren danach
 * jeden Zugriff.
 */
export async function decideRequest(db: Database, actor: Actor, raw: unknown) {
  if (!isTeam(actor))
    throw new AppError("Nur das Team kann Anfragen entscheiden.", 403);
  const v = decisionSchema.parse(raw);
  if (v.decision === "info" && v.applicantMessage.length < 3)
    throw new AppError("Bitte schreib die Rückfrage an die Person ins Nachrichtenfeld.");
  return db.transaction(async (tx) => {
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

    if (v.decision === "info") {
      await tx.query(
        `UPDATE onboarding_requests
         SET status='info_needed',internal_note=$2,applicant_message=$3,updated_at=now()
         WHERE id=$1`,
        [request.id, v.internalNote, v.applicantMessage],
      );
      await log(tx, request.id, actor.userId, "info_requested", v.internalNote);
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
      await log(tx, request.id, actor.userId, "rejected", v.internalNote);
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

    await tx.query(
      "UPDATE participants SET owner=$2,claimed_at=now() WHERE id=$1",
      [p.id, request.owner],
    );
    const [oldProfile] = await tx.query(
      "SELECT data FROM profiles WHERE id=$1",
      [request.owner],
    );
    const base = oldProfile
      ? JSON.parse(oldProfile.data)
      : {
          niche: "Noch offen",
          time: "Flexibel",
          bio: "",
          goal: 200,
          days: [1, 2, 3, 4, 5],
          listed: false,
          channel: "Discord",
        };
    await tx.query(
      "INSERT INTO profiles(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      [
        request.owner,
        JSON.stringify({ ...base, name: p.name, role: p.role || "Sales" }),
      ],
    );
    await tx.query(
      `INSERT INTO account_private(owner,email,phone) VALUES($1,$2,$3)
       ON CONFLICT(owner) DO UPDATE SET email=excluded.email,
         phone=CASE WHEN account_private.phone='' THEN excluded.phone ELSE account_private.phone END,
         updated_at=now()`,
      [request.owner, request.email, request.phone],
    );
    // Konkurrierende offene Anfragen für dasselbe Profil sind damit erledigt.
    await tx.query(
      `UPDATE onboarding_requests SET status='superseded',updated_at=now()
       WHERE participant=$1 AND id<>$2 AND status IN (${OPEN_LIST})`,
      [p.id, request.id],
    );
    // Ein noch offener Einladungscode darf nach der Freigabe nichts mehr tun.
    await tx.query(
      "UPDATE claim_tokens SET used_at=now() WHERE participant=$1 AND used_at IS NULL",
      [p.id],
    );
    await tx.query(
      `UPDATE onboarding_requests
       SET status='approved',internal_note=$2,applicant_message=$3,
           decided_by=$4,decided_at=now(),updated_at=now()
       WHERE id=$1`,
      [request.id, v.internalNote, v.applicantMessage, actor.userId],
    );
    await tx.query(
      "INSERT INTO sync_outbox(participant) VALUES($1) ON CONFLICT(participant) DO UPDATE SET revision=sync_outbox.revision+1,state='pending',attempts=0,next_attempt_at=now(),updated_at=now()",
      [p.id],
    );
    await log(tx, request.id, actor.userId, "approved", v.internalNote);
    return { ok: true, status: "approved", name: p.name };
  });
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
      p = await profileForSelection(tx, wanted, v.invite);
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
      alert: { key: `claim:${id}`, kind: "claim" },
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
      alert: { key: `answer:${event.id}`, kind: "answer" },
    });
    return { ok: true, status: "pending" };
  });
}
