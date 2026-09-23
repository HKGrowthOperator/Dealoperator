import { z } from "zod";
import { authClient, authReady, getCurrentUser, safeNext } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
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

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Bitte prüfe deine E-Mail-Adresse.")
  .max(254);

/** Für das Kontosymbol im Kopf: angemeldet ja/nein, sonst nichts. */
export async function GET() {
  try {
    const actor = authReady() ? await getCurrentUser() : null;
    return json({ signedIn: !!actor, hasPassword: !!actor?.hasPassword });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Anmeldung. Der Normalfall ist E-Mail und Passwort, ohne Mail. Eine Mail
 * gibt es nur zum Bestätigen der Adresse bei der Registrierung und als
 * Anmeldelink, wenn das Passwort vergessen oder noch nie festgelegt wurde.
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
      if (error) throw signInFailure(error);
      await clearRateLimit(db, `signin:${v.email}`);
      return json({ ok: true, next: `/start?next=${encodeURIComponent(safeNext(v.next || null))}` });
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
      const { error } = await client.auth.verifyOtp({
        email: v.email,
        token: v.code,
        type: "email",
      });
      if (error) throw codeFailure(error);
      return json({ ok: true, next: `/start?next=${encodeURIComponent(safeNext(v.next || null))}` });
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
