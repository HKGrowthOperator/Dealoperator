import { z } from "zod";
import { AppError } from "./operator";
import { safeNext } from "../lib/navigation";

/**
 * Anmeldung per E-Mail: Versand, Code-Bestätigung und die Rückkehr aus dem
 * Mail-Link. Gemeinsam für „Anmelden“ (/api/auth) und den Start unter
 * /starten (/api/onboarding).
 *
 * Zwei Wege führen zur Sitzung:
 * - Link aus der Mail. Mit der bisherigen Vorlage ({{ .ConfirmationURL }},
 *   PKCE) klappt er nur in dem Browser, in dem die Mail angefordert wurde.
 *   Mit der Vorlage aus deploy/ ({{ .RedirectTo }} + token_hash) klappt er in
 *   jedem Browser; /auth/callback verarbeitet beide Formen.
 * - Code aus der Mail ({{ .Token }}), eingegeben dort, wo man begonnen hat.
 *
 * Ob die Vorlagen in Supabase schon Code und token_hash-Link enthalten, weiß
 * der Server nicht von selbst. AUTH_EMAIL_CODE=1 schaltet Code-Eingabe und
 * den Hinweis „geht auch in einem anderen Browser“ ein; ohne den Schalter
 * zeigt die Seite nur, was mit der bisherigen Vorlage sicher funktioniert.
 */
export function emailCodeEnabled(env = process.env) {
  return env.AUTH_EMAIL_CODE === "1";
}

/**
 * Supabase verschickt an dieselbe Adresse höchstens alle 60 Sekunden eine
 * Anmeldemail (Standardeinstellung). So lange zeigt die Seite die Wartezeit.
 */
export const RESEND_SECONDS = 60;

/**
 * Rückkehradresse für den Mail-Link. Immer mit Abfrageteil, damit eine
 * Vorlage mit {{ .RedirectTo }}&token_hash=… einen gültigen Link ergibt.
 * via=starten führt Link-Fehler zurück in den Start statt zur Anmeldung.
 */
export function emailRedirect(
  next: string | null | undefined,
  via?: "starten",
  /** Anfrage aus dem Start: der Rücksprung meldet dem wartenden Gerät „bestätigt“. */
  request?: string,
) {
  const url = new URL("/auth/callback", process.env.APP_URL!);
  url.searchParams.set("next", safeNext(next || null));
  if (via) url.searchParams.set("via", via);
  if (request) url.searchParams.set("anfrage", request);
  return url.toString();
}

/**
 * Passwort für die Anmeldung ohne Mail. Mindestens 8 Zeichen; mehr als 72
 * Byte schneidet das Hashverfahren ab, deshalb die Obergrenze.
 */
export const passwordSchema = z
  .string({ required_error: "Bitte lege ein Passwort fest." })
  .min(8, "Bitte nimm mindestens 8 Zeichen.")
  .max(72, "Bitte nimm höchstens 72 Zeichen.")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "Bitte nimm höchstens 72 Zeichen.");

/** Anmeldung mit Passwort: nie verraten, ob E-Mail oder Passwort falsch war. */
export function signInFailure(error: AuthFailure) {
  const code = error?.code || "";
  const status = error?.status || 0;
  if (code === "email_not_confirmed")
    return new AppError(
      "Bitte bestätige zuerst deine E-Mail-Adresse über den Link aus der Mail.",
      409,
      undefined,
      "email",
    );
  if (code === "invalid_credentials" || code === "invalid_grant" || status === 400)
    return new AppError("E-Mail oder Passwort stimmt nicht.", 400, undefined, "password");
  if (status === 429 || code.startsWith("over_"))
    return new AppError("Zu viele Versuche. Bitte warte einen Moment und versuche es dann erneut.", 429);
  return new AppError("Die Anmeldung klappt gerade nicht. Bitte versuche es gleich noch einmal.", 503);
}

/** Passwort setzen oder ändern. */
export function passwordFailure(error: AuthFailure) {
  const code = error?.code || "";
  const status = error?.status || 0;
  if (code === "weak_password")
    return new AppError(
      "Dieses Passwort ist zu leicht zu erraten. Nimm ein längeres, gern mit Zahlen oder Sonderzeichen.",
      400,
      undefined,
      "password",
    );
  if (code === "same_password")
    return new AppError("Das ist bereits dein Passwort.", 400, undefined, "password");
  if (code === "reauthentication_needed" || code === "session_not_found" || status === 401)
    return new AppError(
      "Bitte melde dich aus Sicherheitsgründen kurz per Link neu an und leg das Passwort danach fest.",
      401,
    );
  return new AppError("Das Passwort konnte gerade nicht gespeichert werden. Bitte versuche es gleich noch einmal.", 503);
}

type AuthFailure = { status?: number; code?: string; message?: string } | null | undefined;

/** Versandfehler von Supabase in eine verständliche Meldung mit Wartezeit. */
export function sendFailure(error: AuthFailure) {
  const code = error?.code || "";
  const status = error?.status || 0;
  if (status === 429 || code.startsWith("over_") || /rate limit|security purposes/i.test(error?.message || "")) {
    // Eine Zahl nur, wenn Supabase sie nennt (Wartezeit je Adresse). Das
    // stündliche Mail-Kontingent des Projekts hat keine feste Restzeit.
    const seconds = Number(/after (\d+) seconds?/i.exec(error?.message || "")?.[1]);
    if (seconds > 0)
      return new AppError(
        `Aus Sicherheitsgründen geht die nächste Mail erst in ${seconds} Sekunden.`,
        429,
        seconds,
      );
    return new AppError(
      "Gerade gehen zu viele Anmeldemails raus. Bitte versuche es etwas später noch einmal; deine Angaben bleiben hier stehen.",
      429,
    );
  }
  if (code === "email_address_invalid" || code === "validation_failed")
    return new AppError("Bitte prüfe deine E-Mail-Adresse.", 400);
  if (code === "signup_disabled" || code === "otp_disabled")
    return new AppError("Die Anmeldung per E-Mail ist gerade nicht freigeschaltet.", 503);
  return new AppError(
    "Die Mail konnte gerade nicht versendet werden. Bitte versuche es gleich noch einmal.",
    503,
  );
}

/** Prüffehler beim Code aus der Mail. */
export function codeFailure(error: AuthFailure) {
  const code = error?.code || "";
  const status = error?.status || 0;
  // Supabase meldet falsche, abgelaufene und schon benutzte Codes gleich.
  if (code === "otp_expired")
    return new AppError(
      "Dieser Code passt nicht oder gilt nicht mehr. Prüfe die Ziffern oder fordere eine neue Mail an; nur der Code aus der neuesten Mail gilt.",
      400,
    );
  if (status === 429 || code.startsWith("over_"))
    return new AppError("Zu viele Versuche. Bitte warte einen Moment und versuche es dann erneut.", 429);
  if (status >= 500) return new AppError("Die Prüfung klappt gerade nicht. Bitte versuche es gleich noch einmal.", 503);
  return new AppError("Dieser Code stimmt nicht. Prüfe ihn oder fordere einen neuen an.", 400);
}

/** Link-Fehler aus Supabase in die Kennungen, die die Seiten kennen. */
export function linkFailureReason(error: AuthFailure) {
  const code = error?.code || "";
  if (code === "otp_expired" || code === "flow_state_expired") return "abgelaufen";
  if (code === "flow_state_not_found" || code === "bad_code_verifier") return "verwendet";
  if ((error?.status || 0) >= 500) return "technik";
  return "link";
}
