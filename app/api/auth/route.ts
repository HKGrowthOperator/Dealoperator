import { z } from "zod";
import { authClient, authReady, getCurrentUser, safeNext, viewerOf } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { homeState } from "@/server/home";
import { AppError, clearRateLimit, rateLimit } from "@/server/operator";
import { body, errorResponse, json } from "@/server/http";
import {
  codeFailure,
  emailCodeEnabled,
  emailRedirect,
  passwordFailure,
  passwordSchema,
  RESEND_SECONDS,
  sendFailure,
  signInFailure,
} from "@/server/email-auth";
import {
  accountOf,
  confirmAccountIn,
  ownMailReady,
  peekLink,
  redeemCode,
  redeemLink,
  sendEmailCode,
  setPasswordIn,
} from "@/server/email-code";
import { bindConfirmedRequest } from "@/server/onboarding";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Bitte prüfe deine E-Mail-Adresse.")
  .max(254);
const codeField = z
  .string()
  .trim()
  .regex(/^[\d ]{6,12}$/, "Bitte gib den Code aus der Mail ein (nur Ziffern).");
const linkKey = z.string().trim().min(20).max(120);
const startNext = (next?: string) => `/start?next=${encodeURIComponent(safeNext(next || null))}`;
const WRONG_CODE = "Dieser Code stimmt nicht. Prüfe die Ziffern; nur der Code aus der neuesten Mail gilt.";
// Sechsstellige Codes: über den Tag höchstens 30 Versuche je Adresse, damit
// Raten auch über Wochen aussichtslos bleibt.
const DAY_LIMIT =
  "Heute gab es für diese Adresse zu viele Codeversuche. Bitte versuche es morgen noch einmal oder melde dich beim Team.";
const NO_CODE =
  "Dieser Code gilt nicht mehr. Codes gelten 30 Minuten und nur einmal, und eine neue Mail ersetzt die vorige. Fordere einfach eine neue Mail an.";

/**
 * Nach einer mit eigenem Code oder Link bestätigten Adresse: die
 * Registrierung aus der Mail an das Konto binden (wie nach dem Supabase-Link).
 */
async function bindAfterConfirm(
  db: ReturnType<typeof database>,
  confirmed: { userId: string; email: string; request: string | null },
) {
  if (!confirmed.request) return;
  await bindConfirmedRequest(
    db,
    { userId: confirmed.userId, email: confirmed.email, admin: false },
    confirmed.request,
  ).catch(() => null);
}

/**
 * Für Kopf und Reiterleiste: angemeldet ja/nein, Rolle, und ob es ein Profil
 * und heute noch etwas einzutragen gibt. Keine Kontaktdaten.
 */
export async function GET() {
  try {
    const actor = authReady() ? await getCurrentUser() : null;
    if (!actor || !databaseReady()) return json(viewerOf(actor));
    try {
      const home = await homeState(database(), actor);
      return json({
        ...viewerOf(actor),
        hasProfile: !!home.participant,
        today: home.today?.status ?? null,
      });
    } catch {
      return json(viewerOf(actor));
    }
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Anmeldung. Der Normalfall ist E-Mail und Passwort, ohne Mail. Eine Mail
 * gibt es nur zum Bestätigen der Adresse und wenn das Passwort vergessen
 * wurde. Diese Mails schickt die App selbst (server/email-code.ts); nur
 * solange das nicht eingerichtet ist, kommen sie von Supabase.
 */
export async function POST(request: Request) {
  try {
    const raw = await body(request, 6000);
    if (!authReady())
      return json(
        {
          error:
            "Die Anmeldung wird gerade eingerichtet. Die öffentlichen Ergebnisse kannst du schon ansehen.",
        },
        503,
      );
    const client = await authClient();
    if (raw.action === "signout") {
      const { error } = await client.auth.signOut();
      if (error) return json({ error: "Abmelden gerade nicht möglich." }, 503);
      return json({ ok: true });
    }
    if (!databaseReady())
      return json({ error: "Die Anmeldung wird gerade eingerichtet." }, 503);
    const db = database();

    // E-Mail und Passwort: keine Mail, die Sitzung bleibt 400 Tage bestehen
    // und wird bei jedem Besuch verlängert.
    if (raw.action === "signin") {
      const v = z
        .object({
          action: z.literal("signin"),
          email,
          password: z.string().min(1, "Bitte gib dein Passwort ein.").max(200),
          next: z.string().max(300).optional(),
        })
        .strict()
        .parse(raw);
      await rateLimit(
        db,
        `signin:${v.email}`,
        10,
        900,
        "Zu viele Anmeldeversuche mit dieser Adresse. Bitte warte ein paar Minuten oder setze dein Passwort über „Passwort vergessen“ neu.",
      );
      const { error } = await client.auth.signInWithPassword({
        email: v.email,
        password: v.password,
      });
      // Passwort stimmt, nur die Adresse ist noch nicht bestätigt (die Mail
      // kam nie an): eigene Mail mit Code schicken. Nach dem Code geht es
      // mit demselben Passwort weiter, ganz ohne Team.
      if (error?.code === "email_not_confirmed" && (await ownMailReady(db))) {
        await sendEmailCode(db, { email: v.email, purpose: "confirm" });
        await clearRateLimit(db, `verify:${v.email}`);
        return json({ ok: false, confirm: true, resendAfter: RESEND_SECONDS });
      }
      if (error) throw signInFailure(error);
      await clearRateLimit(db, `signin:${v.email}`);
      return json({ ok: true, next: startNext(v.next) });
    }

    // Passwort festlegen oder ändern, nur mit bestehender Sitzung.
    if (raw.action === "setPassword") {
      const actor = await getCurrentUser();
      if (!actor) throw new AppError("Bitte melde dich zuerst an.", 401);
      const v = z
        .object({ action: z.literal("setPassword"), password: passwordSchema })
        .strict()
        .parse(raw);
      await rateLimit(db, `password:${actor.userId}`, 10, 3600);
      const { error } = await client.auth.updateUser({
        password: v.password,
        data: { has_password: true },
      });
      if (error) throw passwordFailure(error);
      return json({ ok: true });
    }

    // Code aus der Mail: meldet in diesem Browser an, egal wo die Mail
    // geöffnet wurde. Danach führt /start zum passenden nächsten Schritt.
    if (raw.action === "verify") {
      const v = z
        .object({
          action: z.literal("verify"),
          email,
          code: z
            .string()
            .trim()
            .regex(/^\d{6,10}$/, "Bitte gib den Code aus der Mail ein (nur Ziffern)."),
          next: z.string().max(300).optional(),
        })
        .strict()
        .parse(raw);
      await rateLimit(
        db,
        `verify:${v.email}`,
        10,
        900,
        "Zu viele falsche Codes. Fordere eine neue Mail an; mit ihrem Code geht es sofort weiter. Der Link in der Mail funktioniert weiterhin.",
      );
      await rateLimit(db, `verify-day:${v.email}`, 30, 86400, DAY_LIMIT);
      // Eigener Code (Mail von Deal Operator): bestätigt die Adresse. Eine
      // Sitzung entsteht danach mit dem eigenen Passwort (confirmed).
      if (await ownMailReady(db)) {
        const own = await redeemCode(db, { email: v.email, purpose: "confirm", code: v.code }, async (tx, c) => ({
          ...(await confirmAccountIn(tx, c.email)),
          email: c.email,
          request: c.request,
        }));
        if (own.status === "ok") {
          await bindAfterConfirm(db, own.value);
          await clearRateLimit(db, `verify:${v.email}`);
          return json({
            ok: true,
            confirmed: true,
            next: `/anmelden?bestaetigt=1&next=${encodeURIComponent(safeNext(v.next || null))}`,
          });
        }
        if (!emailCodeEnabled()) throw new AppError(own.status === "wrong" ? WRONG_CODE : NO_CODE, 400);
      }
      const { error } = await client.auth.verifyOtp({
        email: v.email,
        token: v.code,
        type: "email",
      });
      if (error) throw codeFailure(error);
      return json({ ok: true, next: startNext(v.next) });
    }

    // Neues Passwort mit dem Code aus der eigenen Mail „Passwort vergessen“.
    // Danach ist man in diesem Browser angemeldet.
    if (raw.action === "reset") {
      const v = z
        .object({ action: z.literal("reset"), email, code: codeField, password: passwordSchema, next: z.string().max(300).optional() })
        .strict()
        .parse(raw);
      await rateLimit(
        db,
        `verify:${v.email}`,
        10,
        900,
        "Zu viele falsche Codes. Fordere eine neue Mail an; mit ihrem Code geht es sofort weiter.",
      );
      await rateLimit(db, `verify-day:${v.email}`, 30, 86400, DAY_LIMIT);
      if (!(await ownMailReady(db))) throw new AppError(NO_CODE, 400);
      const own = await redeemCode(db, { email: v.email, purpose: "reset", code: v.code }, (tx, c) =>
        setPasswordIn(tx, c.email, v.password),
      );
      if (own.status !== "ok") throw new AppError(own.status === "wrong" ? WRONG_CODE : NO_CODE, 400, undefined, "code");
      await clearRateLimit(db, `verify:${v.email}`);
      await clearRateLimit(db, `signin:${v.email}`);
      const { error } = await client.auth.signInWithPassword({ email: v.email, password: v.password });
      if (error) throw signInFailure(error);
      return json({ ok: true, next: startNext(v.next) });
    }

    // Link aus der eigenen Mail (/bestaetigen): Bestätigung sofort einlösen,
    // beim neuen Passwort erst nachsehen und nach dem Festlegen einlösen.
    if (raw.action === "link") {
      const v = z.object({ action: z.literal("link"), key: linkKey }).strict().parse(raw);
      await rateLimit(db, "email-link", 300, 3600);
      if (!(await ownMailReady(db))) throw new AppError("Dieser Link ist gerade nicht einlösbar. Bitte versuche es gleich noch einmal.", 503);
      const found = await peekLink(db, v.key);
      if (found.purpose === "reset") return json({ ok: true, purpose: "reset", email: found.email });
      const confirmed = await redeemLink(db, v.key, "confirm", async (tx, c) => ({
        ...(await confirmAccountIn(tx, c.email)),
        email: c.email,
        request: c.request,
      }));
      await bindAfterConfirm(db, confirmed);
      return json({ ok: true, purpose: "confirm", email: confirmed.email });
    }
    if (raw.action === "resetLink") {
      const v = z
        .object({ action: z.literal("resetLink"), key: linkKey, password: passwordSchema, next: z.string().max(300).optional() })
        .strict()
        .parse(raw);
      await rateLimit(db, "email-link", 300, 3600);
      if (!(await ownMailReady(db))) throw new AppError("Dieser Link ist gerade nicht einlösbar. Bitte versuche es gleich noch einmal.", 503);
      const done = await redeemLink(db, v.key, "reset", async (tx, c) => ({
        ...(await setPasswordIn(tx, c.email, v.password)),
        email: c.email,
      }));
      await clearRateLimit(db, `signin:${done.email}`);
      const { error } = await client.auth.signInWithPassword({ email: done.email, password: v.password });
      if (error) throw signInFailure(error);
      return json({ ok: true, next: startNext(v.next) });
    }

    // Anmeldelink per Mail: für „Passwort vergessen oder noch keins“. Danach
    // geht es zu /passwort. Neue Konten entstehen hier nicht mehr, sondern
    // über die Registrierung unter /starten.
    if (raw.action && raw.action !== "send") throw new AppError("Unbekannte Aktion.");
    const v = z
      .object({
        action: z.literal("send").optional(),
        email,
        next: z.string().max(300).optional(),
      })
      .strict()
      .parse(raw);
    await rateLimit(
      db,
      `email:${v.email}`,
      3,
      900,
      "Du hast in kurzer Zeit mehrere Anmeldemails angefordert. Bitte nutze die letzte Mail oder warte, bis die Zeit abgelaufen ist.",
    );
    await rateLimit(db, "auth-global", 100, 3600);
    // Eigene Mail mit Code und Link für ein neues Passwort, wenn möglich.
    if (await ownMailReady(db)) {
      if (!(await accountOf(db, v.email)))
        throw new AppError(
          "Für diese Adresse gibt es noch kein Konto. Registriere dich kostenfrei, das dauert eine Minute.",
          404,
          undefined,
          "email",
        );
      await sendEmailCode(db, { email: v.email, purpose: "reset" });
      await clearRateLimit(db, `verify:${v.email}`);
      return json({ ok: true, resendAfter: RESEND_SECONDS, code: true, newPassword: true });
    }
    const { error } = await client.auth.signInWithOtp({
      email: v.email,
      options: { emailRedirectTo: emailRedirect("/passwort"), shouldCreateUser: false },
    });
    if (error?.code === "otp_disabled" || error?.code === "signup_disabled")
      throw new AppError(
        "Für diese Adresse gibt es noch kein Konto. Registriere dich kostenfrei, das dauert eine Minute.",
        404,
        undefined,
        "email",
      );
    if (error) throw sendFailure(error);
    // Neue Mail, neuer Code: frühere Fehlversuche zählen nicht mehr. Eine neue
    // Mail macht den alten Code ungültig, Raten wird dadurch nicht leichter.
    await clearRateLimit(db, `verify:${v.email}`);
    return json({ ok: true, resendAfter: RESEND_SECONDS, code: emailCodeEnabled() });
  } catch (e) {
    return errorResponse(e);
  }
}
