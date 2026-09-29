import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Database } from "./database";
import { AppError, rateLimit } from "./operator";
import { mailConfigIssues, sendMail, type MailResult } from "./mailer";

/**
 * Eigene Mails für Bestätigung und neues Passwort. Anmeldemails von Supabase
 * landen bei manchen Postfächern nicht im Posteingang (Link auf supabase.co).
 * Diese Mails gehen über Resend vom eigenen Absender, der Link führt auf die
 * eigene Domain, und Code und Link prüft der Server selbst:
 *
 * - confirm: Adresse einer Registrierung bestätigen (team_confirm_account aus
 *   Migration 0006). Angemeldet wird danach mit dem eigenen Passwort.
 * - reset: neues Passwort festlegen (account_set_password aus Migration 0007).
 *
 * Gespeichert werden nur Hashes von Code und Link. Ein Code gilt 30 Minuten,
 * höchstens 5 Versuche und nur einmal; eine neue Mail macht die vorige
 * ungültig. Der Link trägt sein Geheimnis im Teil nach „#“: Das steht in
 * keinem Serverprotokoll und in keinem Referrer.
 *
 * Fehlt etwas (Resend-Konfiguration, Migration 0006 oder 0007), bleibt es
 * beim bisherigen Weg über Supabase (ownMailReady).
 */
export type CodePurpose = "confirm" | "reset";
export const CODE_MINUTES = 30;
export const CODE_ATTEMPTS = 5;

let cache: { ok: boolean; at: number } | null = null;
/** Eigene Mails möglich? Datenbankteil einmal vorhanden, bleibt es so; sonst nach 5 Minuten neu nachsehen. */
export async function ownMailReady(db: Database, env = process.env) {
  if (mailConfigIssues(env).length || !env.APP_URL) return false;
  if (cache?.ok) return true;
  if (cache && Date.now() - cache.at < 300_000) return false;
  const [row] = await db.query(
    `SELECT to_regclass('operator.email_codes') IS NOT NULL
        AND to_regprocedure('operator.account_set_password(text,text)') IS NOT NULL
        AND to_regprocedure('operator.team_confirm_account(text)') IS NOT NULL
        AND to_regprocedure('operator.team_account_status(text)') IS NOT NULL AS ok`,
  );
  cache = { ok: !!row?.ok, at: Date.now() };
  return cache.ok;
}
/** Nur für Tests. */
export function resetOwnMailCache() {
  cache = null;
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const codeHash = (id: string, code: string) => sha(`code:${id}:${code}`);
const linkHash = (token: string) => sha(`link:${token}`);
function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const normal = (email: string) => email.trim().toLowerCase();

export type SendMail = (message: {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}) => Promise<MailResult>;

function compose(purpose: CodePurpose, code: string, link: string) {
  const shown = `${code.slice(0, 3)} ${code.slice(3)}`;
  if (purpose === "reset")
    return {
      subject: `Dein Code für ein neues Passwort: ${shown}`,
      text: [
        "Hallo,",
        "",
        "hier ist dein Code, um bei Deal Operator ein neues Passwort festzulegen:",
        "",
        shown,
        "",
        "Gib ihn zusammen mit deinem neuen Passwort dort ein, wo du ihn angefordert hast.",
        "Oder leg das Passwort über diesen Link fest:",
        link,
        "",
        `Code und Link gelten ${CODE_MINUTES} Minuten und nur einmal. Hast du das nicht angefordert, ignorier diese Mail einfach; dein Passwort bleibt dann, wie es ist.`,
        "",
        "Deal Operator",
      ].join("\n"),
    };
  return {
    subject: `Dein Bestätigungscode für Deal Operator: ${shown}`,
    text: [
      "Hallo,",
      "",
      "hier ist dein Code, um deine E-Mail-Adresse bei Deal Operator zu bestätigen:",
      "",
      shown,
      "",
      "Gib ihn dort ein, wo du dich gerade registrierst oder anmeldest.",
      "Oder bestätige mit diesem Link:",
      link,
      "",
      `Code und Link gelten ${CODE_MINUTES} Minuten und nur einmal. Hast du das nicht angefordert, ignorier diese Mail einfach.`,
      "",
      "Deal Operator",
    ].join("\n"),
  };
}

/**
 * Neue Mail mit Code und Link. Frühere offene Codes derselben Adresse und
 * desselben Zwecks werden ungültig. Nimmt Resend die Mail nicht an, gilt auch
 * der neue Code nicht, und es gibt eine verständliche Fehlermeldung.
 */
export async function sendEmailCode(
  db: Database,
  input: { email: string; purpose: CodePurpose; request?: string | null },
  send: SendMail = sendMail,
  env = process.env,
) {
  const email = normal(input.email);
  await rateLimit(
    db,
    `code-mail:${input.purpose}:${email}`,
    5,
    900,
    "Du hast in kurzer Zeit mehrere Mails angefordert. Bitte nutze die neueste Mail oder warte ein paar Minuten.",
  );
  await rateLimit(
    db,
    "code-mail-global",
    300,
    3600,
    "Gerade gehen sehr viele Mails raus. Bitte versuche es in ein paar Minuten noch einmal.",
  );
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const token = randomBytes(24).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE email_codes SET used_at=now() WHERE lower(email)=$1 AND purpose=$2 AND used_at IS NULL",
      [email, input.purpose],
    );
    await tx.query(
      `INSERT INTO email_codes(id,email,purpose,code_hash,link_hash,request,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(mins => $7))`,
      [id, email, input.purpose, codeHash(id, code), linkHash(token), input.request ?? null, CODE_MINUTES],
    );
  });
  const link = `${new URL("/bestaetigen", env.APP_URL!).toString()}#${id}.${token}`;
  let result: MailResult;
  try {
    result = await send({ to: email, ...compose(input.purpose, code, link), idempotencyKey: `email-code:${id}` });
  } catch {
    result = { status: "skipped", reason: "Resend nicht erreichbar" };
  }
  if (result.status !== "sent") {
    await db.query("UPDATE email_codes SET used_at=now() WHERE id=$1", [id]);
    throw new AppError("Die Mail konnte gerade nicht verschickt werden. Bitte versuche es gleich noch einmal.", 503);
  }
  await db.query("UPDATE email_codes SET mail_id=$2 WHERE id=$1", [id, result.id.slice(0, 100)]);
  return { id };
}

type Redeemed = { id: string; email: string; purpose: CodePurpose; request: string | null };

/** Einlösen und Aktion in einer Transaktion: scheitert die Aktion, bleibt der Code gültig. */
async function consume<T>(db: Database, id: string, then: (tx: Database, c: Redeemed) => Promise<T>) {
  return db.transaction(async (tx) => {
    const [c] = await tx.query(
      `UPDATE email_codes SET used_at=now()
        WHERE id=$1 AND used_at IS NULL AND expires_at > now()
        RETURNING id,email,purpose,request`,
      [id],
    );
    if (!c) throw new AppError("Dieser Code wurde gerade schon verwendet. Fordere bei Bedarf eine neue Mail an.", 409);
    return then(tx, c as Redeemed);
  });
}

/**
 * Code aus der Mail prüfen. „none“: für diese Adresse gibt es keinen offenen
 * eigenen Code (dann kann der Aufrufer den Supabase-Code prüfen). „wrong“:
 * falscher Code, der Versuch zählt.
 */
export async function redeemCode<T>(
  db: Database,
  input: { email: string; purpose: CodePurpose; code: string },
  then: (tx: Database, c: Redeemed) => Promise<T>,
): Promise<{ status: "none" } | { status: "wrong" } | { status: "ok"; value: T }> {
  const email = normal(input.email);
  const [row] = await db.query(
    `SELECT id,code_hash,attempts FROM email_codes
      WHERE lower(email)=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [email, input.purpose],
  );
  if (!row) return { status: "none" };
  if (row.attempts >= CODE_ATTEMPTS)
    throw new AppError(
      "Zu viele falsche Versuche mit diesem Code. Fordere eine neue Mail an; mit ihrem Code geht es sofort weiter.",
      429,
    );
  const digits = input.code.replace(/\D/g, "");
  if (!same(codeHash(row.id, digits), row.code_hash)) {
    await db.query("UPDATE email_codes SET attempts=attempts+1 WHERE id=$1", [row.id]);
    return { status: "wrong" };
  }
  return { status: "ok", value: await consume(db, row.id, then) };
}

const LINK_KEY = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,64})$/;
const LINK_INVALID =
  "Dieser Link gilt nicht mehr. Links aus der Mail gelten nur einmal und nur 30 Minuten, und eine neue Mail ersetzt die vorige. Fordere einfach eine neue Mail an.";

/** Link aus der Mail nachsehen, ohne ihn einzulösen (für die Seite /bestaetigen). */
export async function peekLink(db: Database, key: string) {
  const m = LINK_KEY.exec(key.trim());
  if (!m) throw new AppError("Dieser Link ist unvollständig. Öffne ihn bitte direkt aus der Mail.", 400);
  const [row] = await db.query(
    "SELECT id,email,purpose,request,link_hash,used_at,expires_at > now() AS fresh FROM email_codes WHERE id=$1",
    [m[1]],
  );
  if (!row || !same(linkHash(m[2]), row.link_hash) || row.used_at || !row.fresh)
    throw new AppError(LINK_INVALID, 410);
  return { id: row.id as string, email: row.email as string, purpose: row.purpose as CodePurpose };
}

/** Link aus der Mail einlösen und die Aktion ausführen. */
export async function redeemLink<T>(
  db: Database,
  key: string,
  purpose: CodePurpose,
  then: (tx: Database, c: Redeemed) => Promise<T>,
) {
  const found = await peekLink(db, key);
  if (found.purpose !== purpose) throw new AppError(LINK_INVALID, 410);
  return consume(db, found.id, then);
}

/** Adresse einer Registrierung bestätigen (Migration 0006). Nur in einer Transaktion aus redeem*. */
export async function confirmAccountIn(tx: Database, email: string) {
  const [row] = await tx.query<{ status: string; user_id: string | null }>(
    "SELECT status,user_id FROM operator.team_confirm_account($1)",
    [email],
  );
  if (!row || row.status === "missing")
    throw new AppError(
      "Zu dieser Adresse gibt es kein Konto. Registriere dich bitte noch einmal; deine Angaben kannst du übernehmen.",
      404,
    );
  if (row.status === "no_password")
    throw new AppError(
      "Für diese Adresse ist noch kein Passwort festgelegt. Nutze bei der Anmeldung „Passwort vergessen?“.",
      409,
    );
  return { userId: row.user_id!, confirmed: row.status === "confirmed" };
}

/** Neues Passwort setzen (Migration 0007). Nur in einer Transaktion aus redeem*. */
export async function setPasswordIn(tx: Database, email: string, password: string) {
  const [row] = await tx.query<{ status: string; user_id: string | null }>(
    "SELECT status,user_id FROM operator.account_set_password($1,$2)",
    [email, password],
  );
  if (!row || row.status !== "set")
    throw new AppError(
      "Zu dieser Adresse gibt es kein Konto. Registriere dich kostenfrei, das dauert eine Minute.",
      404,
    );
  return { userId: row.user_id! };
}

/** Gibt es ein Konto zu dieser Adresse, und ist es bestätigt? (Migration 0006) */
export async function accountOf(db: Database, email: string) {
  const [row] = await db.query<{ user_id: string; confirmed: boolean; has_password: boolean }>(
    "SELECT user_id,confirmed,has_password FROM operator.team_account_status($1)",
    [normal(email)],
  );
  return row ?? null;
}
