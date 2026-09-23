import { z } from "zod";
import { authClient, authReady, safeNext } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { AppError, clearRateLimit, rateLimit } from "@/server/operator";
import { body, errorResponse, json } from "@/server/http";
import {
  codeFailure,
  emailCodeEnabled,
  emailRedirect,
  RESEND_SECONDS,
  sendFailure,
} from "@/server/email-auth";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Bitte prüfe deine E-Mail-Adresse.")
  .max(254);

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
    // Auch mit einer neuen Adresse kommt hier eine Mail: wer „Anmelden“ statt
    // „Kostenfrei starten“ erwischt, darf nicht ohne E-Mail hängen bleiben.
    // Nach der Bestätigung führt /start durch die Profileinrichtung, und das
    // Team bekommt dort seinen Hinweis.
    const { error } = await client.auth.signInWithOtp({
      email: v.email,
      options: { emailRedirectTo: emailRedirect(v.next), shouldCreateUser: true },
    });
    if (error) throw sendFailure(error);
    // Neue Mail, neuer Code: frühere Fehlversuche zählen nicht mehr. Eine neue
    // Mail macht den alten Code ungültig, Raten wird dadurch nicht leichter.
    await clearRateLimit(db, `verify:${v.email}`);
    return json({ ok: true, resendAfter: RESEND_SECONDS, code: emailCodeEnabled() });
  } catch (e) {
    return errorResponse(e);
  }
}
