import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database";
import type { Actor } from "./auth";
import { AppError, rateLimit } from "./operator";
import { normalisePhone } from "../lib/phone";

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
    .max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(1).max(40),
  hint: z.string().trim().max(300).default(""),
});

export const startSchema = z
  .object({
    kind: z.enum(["claim", "new"]),
    participantId: z.string().trim().max(100).optional(),
    invite: z.string().trim().max(200).optional(),
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
     WHERE owner IS NULL AND searchable=true
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
    "SELECT id,name,company,role,searchable,owner FROM participants WHERE id=$1",
    [id],
  );
  if (!p || p.owner)
    throw new AppError(
      "Dieses Profil steht nicht mehr zur Übernahme bereit. Es wurde bereits einem Konto zugeordnet.",
      409,
    );
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

/**
 * Schritt 1: Kontaktdaten aufnehmen und die Anfrage anlegen, BEVOR die E-Mail
 * bestätigt ist. Die Auswahl überlebt dadurch den Bestätigungslink, ohne dass
 * Kontaktdaten in einer URL stehen.
 */
export async function startRequest(db: Database, raw: unknown) {
  const v = startSchema.parse(raw);
  const phone = normalisePhone(v.phone);
  if (!phone.ok) throw new AppError(phone.reason);
  if (v.kind === "claim" && !v.participantId)
    throw new AppError("Bitte wähle zuerst dein vorbereitetes Profil.");

  // Kein einzelner globaler Zähler: ein Missbrauchsversuch darf nicht den
  // Einstieg für alle anderen sperren.
  await rateLimit(db, `onboarding:${v.email}`, 3, 900);
  if (v.participantId)
    await rateLimit(db, `onboarding-profile:${v.participantId}`, 12, 3600);

  return db.transaction(async (tx) => {
    let participant: string | null = null;
    if (v.kind === "claim") {
      const p = await profileForSelection(tx, v.participantId!, v.invite);
      participant = p.id;
    }
    const [existing] = await tx.query(
      `SELECT id,status FROM onboarding_requests
       WHERE lower(email)=$1 AND COALESCE(participant,'')=COALESCE($2,'')
         AND status IN (${OPEN_LIST}) FOR UPDATE`,
      [v.email, participant],
    );
    if (existing) {
      // Erneutes Absenden aktualisiert die Angaben, statt eine zweite offene
      // Anfrage für dieselbe Person und dasselbe Profil anzulegen.
      await tx.query(
        `UPDATE onboarding_requests
         SET full_name=$2,phone=$3,phone_input=$4,hint=$5,updated_at=now()
         WHERE id=$1`,
        [existing.id, v.fullName, phone.value, v.phone, v.hint],
      );
      await log(tx, existing.id, v.email, "resubmitted", "");
      return { id: existing.id as string, participant, resubmitted: true };
    }
    const id = randomUUID();
    await tx.query(
      `INSERT INTO onboarding_requests(id,kind,participant,email,full_name,phone,phone_input,hint)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, v.kind, participant, v.email, v.fullName, phone.value, v.phone, v.hint],
    );
    await log(tx, id, v.email, "submitted", "");
    return { id, participant, resubmitted: false };
  });
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
export async function bindConfirmedRequest(db: Database, actor: Actor) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `owner:${actor.userId}`,
    ]);
    const [request] = await tx.query(
      `SELECT * FROM onboarding_requests
       WHERE lower(email)=$1 AND status='awaiting_email'
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [actor.email],
    );
    if (!request) return null;
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
    return {
      id: request.id as string,
      kind: request.kind as RequestKind,
      participant: request.participant as string | null,
      fullName: request.full_name as string,
    };
  });
}

/** Status und eigene Angaben für den Antragsteller. Nur die eigene Anfrage. */
export async function requestForActor(db: Database, actor: Actor) {
  const [r] = await db.query(
    `SELECT r.id,r.kind,r.status,r.full_name,r.email,r.phone,r.hint,r.applicant_message,
            r.created_at,r.updated_at,r.decided_at,p.name AS participant_name
     FROM onboarding_requests r
     LEFT JOIN participants p ON p.id=r.participant
     WHERE r.owner=$1 ORDER BY r.created_at DESC LIMIT 1`,
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
    participantName: r.participant_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    decidedAt: r.decided_at,
  };
}

/** Warteschlange für die Verwaltung, mit Abgleichhilfen und Konkurrenzanfragen. */
export async function reviewQueue(db: Database, actor: Actor) {
  if (!actor.admin) throw new AppError("Nur für die Verwaltung.", 403);
  const rows = await db.query(
    `SELECT r.id,r.kind,r.status,r.participant,r.full_name,r.email,r.phone,r.phone_input,
            r.hint,r.internal_note,r.applicant_message,r.owner,r.created_at,r.updated_at,
            r.decided_by,r.decided_at,
            p.name AS participant_name,p.company AS participant_company,
            p.email AS participant_known_email,p.import_key,
            a.phone AS known_phone,
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
  if (!actor.admin)
    throw new AppError("Nur die Verwaltung kann Anfragen entscheiden.", 403);
  const v = decisionSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [request] = await tx.query(
      "SELECT * FROM onboarding_requests WHERE id=$1 FOR UPDATE",
      [v.id],
    );
    if (!request) throw new AppError("Diese Anfrage gibt es nicht.", 404);
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
    if (request.kind !== "claim" || !request.participant)
      throw new AppError(
        "Diese Anfrage betrifft kein vorbereitetes Profil.",
        400,
      );
    if (!request.owner)
      throw new AppError(
        "Diese Anfrage hat noch keine bestätigte E-Mail. Eine Freigabe ist erst danach möglich.",
        409,
      );
    // Sperre auf dem Zielprofil: zwei gleichzeitige Freigaben werden serialisiert.
    const [p] = await tx.query(
      "SELECT id,name,role,owner FROM participants WHERE id=$1 FOR UPDATE",
      [request.participant],
    );
    if (!p) throw new AppError("Dieses Profil gibt es nicht mehr.", 409);
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
