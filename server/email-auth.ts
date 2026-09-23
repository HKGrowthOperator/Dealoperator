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
export function emailRedirect(next: string | null | undefined, via?: "starten") {
  const url = new URL("/auth/callback", process.env.APP_URL!);
  url.searchParams.set("next", safeNext(next || null));
  if (via) url.searchParams.set("via", via);
  return url.toString();
}

type AuthFailure = { status?: number; code?: string; message?: string } | null | undefined;

/** Versandfehler von Supabase in eine verständliche Meldung mit Wartezeit. */
export function sendFailure(error: AuthFailure) {
  const code = error?.code || "";
  const status = error?.status || 0;
  if (status === 429 || code.startsWith("over_") || /rate limit|security purposes/i.test(error?.message || "")) {
    const seconds = Number(/after (\d+) seconds?/i.exec(error?.message || "")?.[1]) || RESEND_SECONDS;
    return new AppError(
      `Aus Sicherheitsgründen geht die nächste Mail erst in ${seconds} Sekunden.`,
      429,
      seconds,
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
    return new AppError("Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.", 429, 60);
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
