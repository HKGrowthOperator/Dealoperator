import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import type { Database } from "./database";
import { isTeam, type Actor } from "./auth";
import { teamRecipients } from "./roles";
import { AppError } from "./operator";
import { mailConfigIssues, sendMail } from "./mailer";

/**
 * Echte Geräte-Pushs (Web Push mit VAPID) und die Team-Inbox.
 *
 * - Ein Push kommt nur auf Geräte, deren Besitzer ausdrücklich zugestimmt hat
 *   (Browser-Abfrage) — die Anwendung speichert dann das Abonnement.
 * - Jede Meldung entsteht als Zeile in `notifications` mit eindeutigem
 *   `dedupe_key`. Doppelte Worker, Neustarts oder Wiederholungen legen keine
 *   zweite Zeile an und verschicken deshalb nichts doppelt.
 * - Vor dem Versand wird der Zustand erneut geprüft (siehe `recheck`).
 * - Schlüssel liegen nur auf dem Server: aus der Umgebung (VAPID_*) oder,
 *   falls dort nicht gesetzt, einmalig erzeugt im privaten Schema.
 */

// ---------------------------------------------------------------------------
// VAPID

type Vapid = { publicKey: string; privateKey: string; subject: string; source: "env" | "database" };
let cachedVapid: Vapid | null = null;

export async function vapidKeys(db: Database): Promise<Vapid> {
  if (cachedVapid) return cachedVapid;
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    (process.env.APP_URL?.startsWith("https://") ? process.env.APP_URL : "") ||
    "mailto:info@hk-growthoperator.de";
  if (process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim()) {
    cachedVapid = {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
      subject,
      source: "env",
    };
    return cachedVapid;
  }
  // Einmalig erzeugen. ON CONFLICT sorgt dafür, dass zwei gleichzeitige
  // Starts dasselbe Paar verwenden: wer verliert, liest das gespeicherte.
  const generated = webpush.generateVAPIDKeys();
  await db.query(
    `INSERT INTO app_secrets(key,value) VALUES('vapid',$1) ON CONFLICT(key) DO NOTHING`,
    [JSON.stringify(generated)],
  );
  const [row] = await db.query("SELECT value FROM app_secrets WHERE key='vapid'");
  const stored = JSON.parse(row.value) as { publicKey: string; privateKey: string };
  cachedVapid = { ...stored, subject, source: "database" };
  return cachedVapid;
}

// ---------------------------------------------------------------------------
// Abonnements und Einstellungen

// Nur die Push-Dienste der Browser-Hersteller. Ein frei gewähltes Ziel würde
// den Server zu Anfragen an beliebige Adressen bringen.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^web\.push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];
export function allowedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.port === "" || url.port === "443") &&
      PUSH_HOSTS.some((re) => re.test(url.hostname))
    );
  } catch {
    return false;
  }
}

const base64url = (min: number, max: number) =>
  z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+=*$/, "Ungültiger Schlüssel.");

const subscriptionSchema = z
  .object({
    endpoint: z.string().max(1000).refine(allowedPushEndpoint, "Ungültiges Push-Ziel."),
    // p256dh: 65 Byte (87 Zeichen), auth: 16 Byte (22 Zeichen) — mit Spielraum.
    keys: z.object({ p256dh: base64url(80, 100), auth: base64url(16, 32) }),
    expirationTime: z.number().nullable().optional(),
  })
  .passthrough();

export const MAX_DEVICES = 10;

export async function subscribe(
  db: Database,
  actor: Actor,
  raw: unknown,
  userAgent: string,
) {
  const sub = subscriptionSchema.parse(raw);
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`push:${actor.userId}`]);
    const [{ n }] = await tx.query(
      "SELECT count(*)::int AS n FROM push_subscriptions WHERE owner=$1 AND disabled_at IS NULL AND endpoint<>$2",
      [actor.userId, sub.endpoint],
    );
    if (n >= MAX_DEVICES)
      throw new AppError(
        `Es sind schon ${MAX_DEVICES} Geräte eingetragen. Bitte zuerst ein altes Gerät entfernen.`,
        409,
      );
    // Ein Endpunkt gehört genau einem Konto. Meldet sich auf demselben Gerät
    // ein anderes Konto an, wandert das Abonnement mit — nie zu beiden.
    // Gespeichert wird auch, zu welchem Server-Schlüssel das Gerät zugestimmt
    // hat; nach einem Schlüsselwechsel muss es neu zustimmen.
    const vapid = await vapidKeys(tx);
    await tx.query(
      `INSERT INTO push_subscriptions(id,owner,endpoint,p256dh,auth,user_agent,vapid_key) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(endpoint) DO UPDATE SET owner=excluded.owner,p256dh=excluded.p256dh,auth=excluded.auth,
         user_agent=excluded.user_agent,vapid_key=excluded.vapid_key,disabled_at=NULL,failures=0`,
      [randomUUID(), actor.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent.slice(0, 200), vapid.publicKey],
    );
    return { ok: true };
  });
}

export async function unsubscribe(db: Database, actor: Actor, raw: unknown) {
  const endpoint = z.string().max(1000).parse((raw as { endpoint?: unknown })?.endpoint);
  await db.query(
    "UPDATE push_subscriptions SET disabled_at=now() WHERE owner=$1 AND endpoint=$2",
    [actor.userId, endpoint],
  );
  return { ok: true };
}

const minutes = z.number().int().min(0).max(1439).nullable();
const prefsSchema = z
  .object({
    reminders: z.boolean(),
    teamAlerts: z.boolean().optional(),
    teamEmail: z.boolean().optional(),
    quietStart: minutes,
    quietEnd: minutes,
  })
  .strict();

export async function notificationPrefs(db: Database, owner: string) {
  const [row] = await db.query("SELECT * FROM notification_prefs WHERE owner=$1", [owner]);
  const subs = await db.query(
    "SELECT endpoint,user_agent,created_at,last_success_at FROM push_subscriptions WHERE owner=$1 AND disabled_at IS NULL ORDER BY created_at DESC",
    [owner],
  );
  return {
    reminders: row ? !!row.reminders : true,
    teamAlerts: row ? !!row.team_alerts : true,
    teamEmail: row ? !!row.team_email : false,
    email: row?.email || null,
    quietStart: row?.quiet_start ?? null,
    quietEnd: row?.quiet_end ?? null,
    devices: subs.map((s) => ({
      endpoint: s.endpoint as string,
      label: deviceLabel(s.user_agent || ""),
      since: new Date(s.created_at).toISOString(),
      lastSuccess: s.last_success_at ? new Date(s.last_success_at).toISOString() : null,
    })),
  };
}

function deviceLabel(ua: string) {
  if (/iPhone|iPad/.test(ua)) return "iPhone / iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Gerät";
}

export async function savePrefs(db: Database, actor: Actor, raw: unknown) {
  const v = prefsSchema.parse(raw);
  if ((v.quietStart === null) !== (v.quietEnd === null))
    throw new AppError("Bitte Beginn und Ende der Ruhezeit angeben oder beide leer lassen.");
  if ((v.teamAlerts !== undefined || v.teamEmail !== undefined) && !isTeam(actor))
    throw new AppError("Team-Benachrichtigungen gibt es nur für das Team.", 403);
  await db.query(
    // Parameter ausdrücklich typisiert: Ohne Typ macht Postgres aus
    // COALESCE($4,…) einen Text, und das Speichern scheitert an der
    // boolean-Spalte. team_email ist standardmäßig an; für Konten ohne
    // Team-Rolle bleibt das folgenlos, weil der Versand die Rolle prüft, und
    // wer später eine Rolle bekommt, hat die Absicherung gleich an.
    `INSERT INTO notification_prefs(owner,reminders,team_alerts,team_email,email,quiet_start,quiet_end)
     VALUES($1,$2::boolean,COALESCE($3::boolean,true),COALESCE($4::boolean,true),$5,$6::integer,$7::integer)
     ON CONFLICT(owner) DO UPDATE SET reminders=excluded.reminders,
       team_alerts=COALESCE($3::boolean,notification_prefs.team_alerts),
       team_email=COALESCE($4::boolean,notification_prefs.team_email),
       email=CASE WHEN $4::boolean IS NULL THEN notification_prefs.email ELSE excluded.email END,
       quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,updated_at=now()`,
    [
      actor.userId,
      v.reminders,
      v.teamAlerts ?? null,
      v.teamEmail ?? null,
      // Die Absicherungs-E-Mail geht an die bestätigte Adresse der Sitzung,
      // nie an eine frei eingetippte. Für die Verwaltung ist sie
      // standardmäßig an.
      (v.teamEmail ?? isTeam(actor)) ? actor.email : null,
      v.quietStart,
      v.quietEnd,
    ],
  );
  return notificationPrefs(db, actor.userId);
}

// ---------------------------------------------------------------------------
// Meldungen anlegen

export type NotificationInput = {
  dedupeKey: string;
  recipient: string;
  channel: "push" | "email";
  kind: string;
  ref?: string;
  title: string;
  body: string;
  url?: string;
  /** Nach diesem Zeitpunkt wird nicht mehr zugestellt (z. B. Frist vorbei). */
  notAfter?: Date | null;
};

/** Legt eine Meldung an, falls es sie noch nicht gibt. true = neu angelegt. */
export async function enqueue(db: Database, n: NotificationInput): Promise<boolean> {
  const rows = await db.query(
    `INSERT INTO notifications(dedupe_key,recipient,channel,kind,ref,title,body,url,not_after)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,
    [
      n.dedupeKey,
      n.recipient,
      n.channel,
      n.kind,
      n.ref || "",
      n.title,
      n.body,
      n.url || "/",
      n.notAfter ? n.notAfter.toISOString() : null,
    ],
  );
  return rows.length > 0;
}

export { ownerIds as adminIds } from "./auth";

/**
 * Feste Texte für Team-Meldungen auf Gerät und per E-Mail. Sie enthalten
 * bewusst keine Namen, Kontaktdaten oder Eingaben — die stehen nur in der
 * geschützten Team-Inbox. So landet auf dem Sperrbildschirm und im
 * Postfach nichts Persönliches.
 */
export const TEAM_ALERTS = {
  new: {
    title: "Neue Registrierung bei Deal Operator",
    body: "Jemand hat sich neu registriert und die E-Mail bestätigt. Details in der Verwaltung.",
  },
  claim: {
    title: "Profilübernahme prüfbereit",
    body: "Eine bestätigte Profilübernahme wartet auf eure Prüfung. Details in der Verwaltung.",
  },
  answer: {
    title: "Antwort auf eine Rückfrage",
    body: "Jemand hat auf eure Rückfrage zur Profilübernahme geantwortet. Details in der Verwaltung.",
  },
} as const;
export type TeamAlert = keyof typeof TEAM_ALERTS;

/**
 * Ein Team-Ereignis: genau ein Inbox-Eintrag je dedupeKey. Optional ein Push
 * und eine E-Mail an jedes Verwaltungskonto — genau einmal je `alert.key`
 * (für Registrierungen: einmal je Konto, egal wie oft sich jemand später
 * anmeldet, einen neuen Link anfordert oder die Seite neu lädt).
 * Wird innerhalb der auslösenden Transaktion aufgerufen, damit Ereignis und
 * Meldung gemeinsam entstehen oder gemeinsam entfallen.
 */
export async function teamEvent(
  tx: Database,
  e: {
    dedupeKey: string;
    kind: string;
    ref: string;
    state: string;
    title: string;
    body: string;
    alert: false | { key: string; kind: TeamAlert };
  },
) {
  await tx.query(
    `INSERT INTO team_inbox(dedupe_key,kind,ref,state,title,body) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(dedupe_key) DO UPDATE SET state=excluded.state,title=excluded.title,
       body=excluded.body,updated_at=now()
     WHERE team_inbox.resolved_at IS NULL`,
    [e.dedupeKey, e.kind, e.ref, e.state, e.title, e.body],
  );
  if (!e.alert) return;
  const text = TEAM_ALERTS[e.alert.kind];
  // Grundverwaltung, Admins und Moderatoren — jede Person genau einmal.
  for (const admin of await teamRecipients(tx)) {
    for (const channel of ["push", "email"] as const)
      await enqueue(tx, {
        dedupeKey: `${e.alert.key}:${channel}:${admin}`,
        recipient: admin,
        channel,
        kind: `team:${e.alert.kind}`,
        // Verweist auf den Inbox-Eintrag, damit die Verwaltung dort den
        // Zustellstand zeigen kann.
        ref: e.dedupeKey,
        title: text.title,
        body: text.body,
        url: "/verwaltung",
        // Wartet bis zu 48 Stunden auf ein Gerät bzw. die E-Mail-Einrichtung.
        notAfter: new Date(Date.now() + 48 * 3600_000),
      });
  }
}

/**
 * Team-Konten (Admins, Moderatoren) bekommen die kurze E-Mail-Absicherung standardmäßig an
 * die bestätigte Adresse ihrer Sitzung. Legt die Einstellung beim ersten
 * Besuch der Verwaltung an und ändert eine bestehende Wahl nicht.
 */
export async function ensureAdminPrefs(db: Database, actor: Actor) {
  if (!isTeam(actor)) return;
  await db.query(
    `INSERT INTO notification_prefs(owner,reminders,team_alerts,team_email,email)
     VALUES($1,true,true,true,$2)
     ON CONFLICT(owner) DO UPDATE SET email=CASE WHEN notification_prefs.team_email THEN excluded.email ELSE notification_prefs.email END`,
    [actor.userId, actor.email],
  );
}

// ---------------------------------------------------------------------------
// Versand

export type Recheck = (
  db: Database,
  n: { kind: string; recipient: string; ref: string; channel?: string },
) => Promise<string | null>;

type Row = {
  id: number;
  dedupe_key: string;
  recipient: string;
  channel: "push" | "email";
  kind: string;
  ref: string;
  title: string;
  body: string;
  url: string;
  not_after: string | null;
  attempts: number;
  claimed_at: string;
  created_at: string;
};

const DEFER_MINUTES = 15;

/**
 * Beansprucht offene Meldungen (FOR UPDATE SKIP LOCKED — zwei Worker greifen
 * nie dieselbe Zeile) und stellt sie zu.
 *
 * Doppelte Zustellung wird auf drei Ebenen verhindert: eindeutiger
 * dedupe_key je Meldung, höchstens eine Zustellung je Meldung und Gerät
 * (notification_deliveries, vor dem Senden festgeschrieben) und für E-Mails
 * ein Idempotenzschlüssel bei Resend. Eine nach Absturz hängengebliebene
 * Meldung wird deshalb höchstens an Geräte geschickt, die sie noch nie
 * bekommen haben — lieber selten ein Hinweis zu wenig als doppelt.
 */
export async function dispatch(
  db: Database,
  recheck: Recheck,
  now = new Date(),
  send: typeof webpush.sendNotification = webpush.sendNotification.bind(webpush),
) {
  const claimed = (await db.query(
    `UPDATE notifications SET status='sending',claimed_at=now(),attempts=attempts+1
      WHERE id IN (
        SELECT id FROM notifications
         WHERE ((status='pending' AND next_attempt_at<=now())
             OR (status='sending' AND claimed_at < now()-interval '10 minutes'))
           AND attempts < 5
         ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
      RETURNING id,dedupe_key,recipient,channel,kind,ref,title,body,url,not_after,attempts,claimed_at,created_at`,
  )) as Row[];
  let sent = 0;
  for (const n of claimed) {
    const finish = (status: "sent" | "skipped" | "failed", detail: string) =>
      db.query(
        `UPDATE notifications SET status=$2,detail=$3,sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END WHERE id=$1`,
        [n.id, status, detail.slice(0, 500)],
      );
    // Zurückstellen, ohne einen Versuch zu verbrauchen.
    const defer = (detail: string) =>
      db.query(
        `UPDATE notifications SET status='pending',attempts=GREATEST(attempts-1,0),detail=$2,
           next_attempt_at=now()+make_interval(mins => $3) WHERE id=$1`,
        [n.id, detail.slice(0, 500), DEFER_MINUTES],
      );
    const team = n.kind.startsWith("team:");
    try {
      if (n.not_after && new Date(n.not_after) < now) {
        await finish("skipped", "Zu spät für diesen Hinweis — nicht mehr zugestellt.");
        continue;
      }
      const reason = await recheck(db, n);
      if (reason) {
        await finish("skipped", reason);
        continue;
      }
      if (n.channel === "email") {
        const to = await teamMailAddress(db, n.recipient);
        if (to === false) {
          await finish("skipped", "E-Mail-Absicherung für dieses Konto ausgeschaltet.");
          continue;
        }
        if (!to || mailConfigIssues().length) {
          await defer(to ? mailConfigIssues().join(" ") : "Noch keine bestätigte Adresse für dieses Verwaltungskonto.");
          continue;
        }
        const result = await sendMail({
          to,
          subject: n.title,
          text: `${n.body}\n\n${absolute(n.url)}`,
          idempotencyKey: n.dedupe_key,
        });
        if (result.status === "sent") {
          await finish("sent", "");
          sent++;
        } else await defer(result.reason);
        continue;
      }
      const outcome = await pushToOwner(db, n, send, now);
      if (outcome.delivered) {
        await finish("sent", outcome.detail);
        sent++;
      } else if (team && outcome.noDevice) await defer(outcome.detail);
      else await finish("skipped", outcome.detail);
    } catch (error) {
      const message = (error as Error).message;
      if (n.attempts >= 5) await finish("failed", message);
      else
        await db.query(
          `UPDATE notifications SET status='pending',detail=$2,
             next_attempt_at=now()+make_interval(mins => LEAST(60, power(2, attempts)::int)) WHERE id=$1`,
          [n.id, message.slice(0, 500)],
        );
    }
  }
  return { claimed: claimed.length, sent };
}

/**
 * Adresse für die Team-E-Mail. Verwaltungskonten haben sie standardmäßig an
 * (bestätigte Adresse aus der Sitzung, gespeichert in notification_prefs bzw.
 * account_private). false = ausdrücklich ausgeschaltet.
 */
async function teamMailAddress(db: Database, owner: string): Promise<string | null | false> {
  const [prefs] = await db.query(
    "SELECT team_email,email FROM notification_prefs WHERE owner=$1",
    [owner],
  );
  if (prefs && !prefs.team_email) return false;
  if (prefs?.email) return prefs.email as string;
  const [contact] = await db.query("SELECT email FROM account_private WHERE owner=$1", [owner]);
  return (contact?.email as string | undefined) || null;
}

function absolute(url: string) {
  try {
    return new URL(url, process.env.APP_URL || "https://dealoperator.hk-growthoperator.de").toString();
  } catch {
    return url;
  }
}

async function pushToOwner(
  db: Database,
  n: Row,
  send: typeof webpush.sendNotification,
  now: Date,
) {
  const vapid = await vapidKeys(db);
  const subs = await db.query(
    `SELECT id,endpoint,p256dh,auth FROM push_subscriptions
      WHERE owner=$1 AND disabled_at IS NULL AND (vapid_key=$2 OR vapid_key='')`,
    [n.recipient, vapid.publicKey],
  );
  if (!subs.length)
    return { delivered: false, noDevice: true, detail: "Kein Gerät mit Push-Zustimmung hinterlegt." };
  // Nicht länger beim Push-Dienst liegen lassen, als der Hinweis sinnvoll ist.
  const ttl = Math.max(
    60,
    Math.min(6 * 3600, n.not_after ? Math.floor((new Date(n.not_after).getTime() - now.getTime()) / 1000) : 6 * 3600),
  );
  let delivered = 0,
    already = 0;
  const errors: string[] = [];
  for (const s of subs) {
    // Vor dem Senden festschreiben. Gibt es die Zeile schon, wurde an dieses
    // Gerät bereits gesendet (oder es wurde versucht) — dann nicht noch einmal.
    const fresh = await db.query(
      `INSERT INTO notification_deliveries(notification_id,subscription_id) VALUES($1,$2)
       ON CONFLICT DO NOTHING RETURNING subscription_id`,
      [n.id, s.id],
    );
    if (!fresh.length) {
      already++;
      continue;
    }
    try {
      await send(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        // Der Tag ist je Anlass eindeutig: verschiedene Hinweise ersetzen sich
        // nicht, ein doppelter desselben Anlasses schon.
        JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.dedupe_key.slice(0, 120) }),
        {
          vapidDetails: vapid,
          TTL: ttl,
          urgency: "normal",
          timeout: 10_000,
          topic: `n${n.id}`.slice(0, 32),
        },
      );
      delivered++;
      await db.query(
        "UPDATE notification_deliveries SET status='sent' WHERE notification_id=$1 AND subscription_id=$2",
        [n.id, s.id],
      );
      await db.query(
        "UPDATE push_subscriptions SET last_success_at=now(),failures=0 WHERE id=$1",
        [s.id],
      );
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      const gone = status === 404 || status === 410;
      await db.query(
        "UPDATE notification_deliveries SET status=$3 WHERE notification_id=$1 AND subscription_id=$2",
        [n.id, s.id, gone ? "gone" : "failed"],
      );
      // 404/410: das Gerät hat das Abonnement beendet.
      if (gone)
        await db.query("UPDATE push_subscriptions SET disabled_at=now() WHERE id=$1", [s.id]);
      else
        await db.query(
          "UPDATE push_subscriptions SET failures=failures+1, disabled_at=CASE WHEN failures+1>=10 THEN now() ELSE disabled_at END WHERE id=$1",
          [s.id],
        );
      errors.push(String(status || (error as Error).message).slice(0, 60));
    }
  }
  return {
    delivered: delivered > 0 || already > 0,
    noDevice: false,
    detail: delivered
      ? `${delivered} Gerät(e)`
      : already
        ? "Bereits zugestellt; kein zweiter Versand."
        : `Zustellung fehlgeschlagen: ${errors.join(", ")}`,
  };
}

// ---------------------------------------------------------------------------
// Diagnose für die Verwaltung

/**
 * Genauer Zustand eines Hinweises. „Übergeben“ heißt: der Push-Dienst bzw.
 * Resend hat angenommen. Mehr lässt sich nicht bestätigen; gelesen oder auf
 * dem Gerät angezeigt meldet uns niemand.
 */
export type DeliveryState =
  | "delivered"
  | "waiting_config"
  | "waiting_device"
  | "waiting_address"
  | "retrying"
  | "queued"
  | "expired"
  | "skipped"
  | "failed";

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  delivered: "übergeben",
  waiting_config: "wartet, E-Mail-Versand nicht eingerichtet",
  waiting_device: "wartet, kein Gerät mit Push eingerichtet",
  waiting_address: "wartet, keine bestätigte Adresse",
  retrying: "wartet auf erneuten Versuch",
  queued: "in der Warteschlange",
  expired: "abgelaufen, nicht zugestellt",
  skipped: "nicht gesendet",
  failed: "fehlgeschlagen",
};

type DeliveryRow = {
  status: string;
  channel: string;
  detail: string;
  attempts: number;
  recipient: string;
};

export async function deliveryStates<T extends DeliveryRow>(db: Database, rows: T[]) {
  const recipients = [...new Set(rows.filter((r) => r.channel === "push").map((r) => r.recipient))];
  const withDevice = new Set(
    recipients.length
      ? (
          await db.query(
            `SELECT DISTINCT owner FROM push_subscriptions
              WHERE disabled_at IS NULL AND owner = ANY($1::text[])`,
            [recipients],
          )
        ).map((r) => r.owner as string)
      : [],
  );
  const mailMissing = mailConfigIssues().length > 0;
  return rows.map((r) => {
    let state: DeliveryState;
    if (r.status === "sent") state = "delivered";
    else if (r.status === "failed") state = "failed";
    else if (r.status === "skipped")
      state = (r.detail || "").startsWith("Zu spät") ? "expired" : "skipped";
    else if (r.channel === "email")
      state = mailMissing
        ? "waiting_config"
        : (r.detail || "").startsWith("Noch keine bestätigte Adresse")
          ? "waiting_address"
          : Number(r.attempts) > 0
            ? "retrying"
            : "queued";
    else
      state = !withDevice.has(r.recipient)
        ? "waiting_device"
        : Number(r.attempts) > 0
          ? "retrying"
          : "queued";
    return { ...r, state };
  });
}

export async function notificationStatus(db: Database) {
  const [raw] = await db.query(
    `SELECT count(*) FILTER (WHERE status='sent') AS sent,
            count(*) FILTER (WHERE status='skipped') AS skipped,
            count(*) FILTER (WHERE status IN ('pending','sending')) AS open,
            count(*) FILTER (WHERE status IN ('pending','sending') AND channel='email') AS open_email,
            count(*) FILTER (WHERE status IN ('pending','sending') AND channel='push'
              AND NOT EXISTS (SELECT 1 FROM push_subscriptions s
                               WHERE s.owner=notifications.recipient AND s.disabled_at IS NULL)) AS no_device,
            count(*) FILTER (WHERE status='failed') AS failed
       FROM notifications WHERE created_at > now()-interval '14 days'`,
  );
  // Wartende getrennt nach Grund, damit „offen“ nicht nach Versand aussieht.
  const waitingConfig = mailConfigIssues().length ? Number(raw.open_email) : 0;
  const waitingDevice = Number(raw.no_device);
  const counts = {
    sent: Number(raw.sent),
    waitingConfig,
    waitingDevice,
    open: Math.max(0, Number(raw.open) - waitingConfig - waitingDevice),
    skipped: Number(raw.skipped),
    failed: Number(raw.failed),
  };
  const recent = await deliveryStates(
    db,
    (await db.query(
      `SELECT kind,channel,status,detail,attempts,recipient,created_at,sent_at FROM notifications
        ORDER BY created_at DESC LIMIT 20`,
    )) as (DeliveryRow & { kind: string; created_at: string; sent_at: string | null })[],
  );
  const [secret] = await db.query("SELECT 1 FROM app_secrets WHERE key='vapid'");
  const fromEnv = !!(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
  const current = fromEnv || secret ? (await vapidKeys(db)).publicKey : "";
  const [devices] = await db.query(
    `SELECT count(*) FILTER (WHERE vapid_key=$1 OR vapid_key='') AS n,
            count(*) FILTER (WHERE vapid_key<>$1 AND vapid_key<>'') AS stale
       FROM push_subscriptions WHERE disabled_at IS NULL`,
    [current],
  );
  return {
    push: {
      keys: fromEnv ? "env" : secret ? "database" : "noch nicht erzeugt",
      devices: Number(devices.n),
      // Geräte, die einem früheren Server-Schlüssel zugestimmt haben und neu
      // zustimmen müssen (nach einem Wechsel der VAPID-Schlüssel).
      needsReconsent: Number(devices.stale),
    },
    email: { issues: mailConfigIssues() },
    counts,
    recent: recent.map((r) => ({
      kind: r.kind,
      channel: r.channel,
      status: r.status,
      state: r.state,
      label: DELIVERY_LABEL[r.state],
      detail: r.detail,
      createdAt: new Date(r.created_at).toISOString(),
      sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    })),
  };
}

/**
 * Zeitkonstanter Vergleich für das Cron-Geheimnis. Über Hashes, damit auch
 * die Länge nichts verrät. Zu kurze Geheimnisse gelten als nicht gesetzt.
 */
export function secretMatches(given: string | null, expected: string | undefined) {
  if (!given || !expected || expected.length < 32) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
