import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { authClient, authReady, getCurrentUser, safeNext } from "@/server/auth";
import { linkFailureReason } from "@/server/email-auth";
import { database, databaseReady } from "@/server/database";
import { noteLinkOpened } from "@/server/onboarding";

/**
 * Rücksprung aus der Bestätigungsmail. Zwei Linkformen:
 *
 * - token_hash (Vorlage aus deploy/): die Sitzung entsteht in dem Browser, der
 *   den Link öffnet. Ein Wechsel vom In-App-Browser zu Safari oder Chrome
 *   stört nicht. Der Hash ist einmalig und läuft ab wie der Code.
 * - code (bisherige Vorlage, PKCE): braucht den code_verifier aus dem Browser,
 *   in dem die Mail angefordert wurde.
 *
 * Fehler werden unterschieden, damit die Seite passend helfen kann:
 *   abgelaufen — Supabase meldet einen abgelaufenen Link
 *   verwendet  — Link bereits eingelöst
 *   browser    — PKCE-Link in einem anderen Browser geöffnet (kein Verifier)
 *   bestaetigt — Registrierung, Einlösen gescheitert: Supabase hat die
 *                Adresse bestätigt (sonst gäbe es keinen code), nur dieses
 *                Gerät bekommt keine Sitzung. Das wartende Gerät meldet sich
 *                selbst an, sonst mit E-Mail und Passwort (siehe /starten).
 *   technik    — Supabase gerade nicht erreichbar
 *   link       — unvollständig oder unbekannt
 * Ist bereits eine gültige Sitzung da, gibt es keinen Fehler, sondern es geht
 * einfach weiter.
 */
const LINK_TYPES: EmailOtpType[] = ["email", "magiclink", "signup"];

function go(base: string, path: string) {
  const response = NextResponse.redirect(new URL(path, base));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
function forward(base: string, next: string | null) {
  return go(base, `/start?next=${encodeURIComponent(safeNext(next))}`);
}
function back(base: string, reason: string, next: string | null, via: string | null) {
  // Links aus dem Start (via=starten) führen zurück in den Start; dort stehen
  // Auswahl und Angaben aus diesem Browser noch bereit. Links aus „Anmelden“
  // führen zur Anmeldung mit demselben Ziel.
  if (via === "starten") return go(base, `/starten?fehler=${reason}`);
  return go(
    base,
    `/anmelden?fehler=${reason}${next ? `&next=${encodeURIComponent(safeNext(next))}` : ""}`,
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = process.env.APP_URL || url.origin;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next");
  const via = url.searchParams.get("via");
  const requestId = url.searchParams.get("anfrage");

  if (!authReady()) return back(base, "technik", next, via);

  // Supabase hängt bei abgelaufenem Einmal-Link einen Fehler an die Rückadresse.
  const errorCode = url.searchParams.get("error_code");
  if (errorCode) {
    if (await getCurrentUser()) return forward(base, next);
    return back(base, errorCode.includes("expired") ? "abgelaufen" : "link", next, via);
  }

  const client = await authClient();

  if (tokenHash) {
    if (!type || !LINK_TYPES.includes(type)) return back(base, "link", next, via);
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return forward(base, next);
    // Zweiter Klick auf denselben Link bei bestehender Sitzung: kein Fehler.
    if (await getCurrentUser()) return forward(base, next);
    return back(base, linkFailureReason(error), next, via);
  }

  if (!code) {
    // Kein Code, aber bereits angemeldet: der Link wurde in diesem Browser
    // schon einmal geöffnet. Dann ist nichts kaputt, einfach weitergehen.
    if (await getCurrentUser()) return forward(base, next);
    return back(base, "link", next, via);
  }

  // Fehlt der Verifier, wurde der Link in einem anderen Browser geöffnet.
  // Gemeint ist nur der feste Schlüssel „…-auth-token-code-verifier“, den der
  // Server beim Einlösen liest; die flow-Einträge daneben zählen nicht.
  const jar = await cookies();
  const hasVerifier = jar
    .getAll()
    .some((c) => /-auth-token-code-verifier$/.test(c.name) && c.value);

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (!error) return forward(base, next);

  // Ein bereits eingelöster Link in demselben Browser lässt die Sitzung
  // bestehen. Dann ist der zweite Klick harmlos und führt einfach weiter.
  if (await getCurrentUser()) return forward(base, next);

  if ((error.status || 0) >= 500) return back(base, "technik", next, via);
  // Registrierung: Einen code gibt es nur, wenn Supabase die Adresse gerade
  // bestätigt hat. Scheitert allein das Einlösen (anderes Gerät, ein älterer
  // Schlüssel in diesem Browser, eine vom Team neu geschickte Mail), bleibt
  // die Adresse bestätigt. Dann geht es mit der Anmeldung weiter statt mit
  // einer Fehlermeldung, die zu einer weiteren, nie kommenden Mail rät.
  if (via === "starten") {
    if (databaseReady()) await noteLinkOpened(database(), requestId).catch(() => undefined);
    return go(base, "/starten?bestaetigt=1");
  }
  return back(base, hasVerifier ? "verwendet" : "browser", next, via);
}
