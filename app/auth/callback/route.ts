import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authClient, authReady, getCurrentUser, safeNext } from "@/server/auth";

/**
 * Rücksprung aus der Bestätigungsmail.
 *
 * Der PKCE-Ablauf verlangt denselben Browser für Anforderung und Öffnen des
 * Links: der code_verifier liegt in einem Cookie dieses Browsers. Wird der Link
 * woanders geöffnet — etwa aus einem In-App-Browser heraus in Safari —, kann
 * der Code nicht eingelöst werden. Das ist kein abgelaufener Link, und die
 * frühere Sammelmeldung „abgelaufen oder bereits verwendet" hat genau diesen
 * Fall falsch beschrieben.
 *
 * Unterschieden wird deshalb:
 *   fehler=browser    — Link in einem anderen Browser geöffnet (kein Verifier)
 *   fehler=abgelaufen — Supabase meldet einen abgelaufenen/ungültigen Link
 *   fehler=verwendet  — Verifier vorhanden, Einlösen scheitert trotzdem
 *   fehler=link       — gar kein Code in der Adresse
 *
 * Die Authentifizierung wird dadurch nicht abgeschwächt: ohne gültigen Code und
 * passenden Verifier entsteht weiterhin keine Sitzung.
 */
function back(base: string, reason: string) {
  const response = NextResponse.redirect(
    new URL(`/starten?fehler=${reason}`, base),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = process.env.APP_URL || url.origin;
  const code = url.searchParams.get("code");

  if (!authReady()) return back(base, "link");

  // Supabase hängt bei abgelaufenem Einmal-Link einen Fehler an die Rückadresse.
  const errorCode = url.searchParams.get("error_code");
  if (errorCode)
    return back(base, errorCode.includes("expired") ? "abgelaufen" : "link");

  if (!code) {
    // Kein Code, aber bereits angemeldet: der Link wurde in diesem Browser
    // schon einmal geöffnet. Dann ist nichts kaputt — einfach weitergehen.
    if (await getCurrentUser()) {
      const target = new URL("/start", base);
      target.searchParams.set("next", safeNext(url.searchParams.get("next")));
      const response = NextResponse.redirect(target);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    return back(base, "link");
  }

  // Fehlt der Verifier, wurde der Link in einem anderen Browser geöffnet.
  const jar = await cookies();
  const hasVerifier = jar
    .getAll()
    .some((c) => c.name.endsWith("-code-verifier") && c.value);

  const client = await authClient();
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (!error) {
    const target = new URL("/start", base);
    target.searchParams.set("next", safeNext(url.searchParams.get("next")));
    const response = NextResponse.redirect(target);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  // Ein bereits eingelöster Link in demselben Browser lässt die Sitzung
  // bestehen. Dann ist der zweite Klick harmlos und führt einfach weiter.
  if (await getCurrentUser()) {
    const target = new URL("/start", base);
    target.searchParams.set("next", safeNext(url.searchParams.get("next")));
    const response = NextResponse.redirect(target);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  return back(base, hasVerifier ? "verwendet" : "browser");
}
