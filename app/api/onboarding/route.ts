import { z } from "zod";
import { cookies } from "next/headers";
import { authClient, authReady, getCurrentUser } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { body, errorResponse, json } from "@/server/http";
import { AppError, clearRateLimit } from "@/server/operator";
import { emailCodeEnabled, emailRedirect, RESEND_SECONDS, sendFailure } from "@/server/email-auth";
import {
  answerInfoRequest,
  browserSecret,
  markMailSent,
  profileForSelection,
  requestClaimSignedIn,
  requestForActor,
  ONBOARDING_COOKIE,
  searchProfiles,
  startRequest,
} from "@/server/onboarding";

/**
 * Öffentlich, damit die Profilauswahl VOR der E-Mail-Eingabe möglich ist.
 * Liefert nur Angaben, die ohnehin öffentlich sichtbar sein dürfen.
 */
export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;

    // Der eigene Anfragestatus ist privat: die Sitzung wird zuerst geprüft,
    // damit ein nicht angemeldeter Aufruf immer 401 bekommt — auch solange
    // die Datenbank noch nicht eingerichtet ist.
    if (search.get("status") === "eigen") {
      const actor = await getCurrentUser();
      if (!actor) return json({ error: "Bitte melde dich zuerst an." }, 401);
      if (!databaseReady()) return json({ ready: false, request: null });
      return json({
        ready: true,
        request: await requestForActor(database(), actor),
      });
    }

    if (!databaseReady()) return json({ ready: false, profiles: [] });
    const db = database();

    const profile = search.get("profil");
    if (profile)
      return json({
        ready: true,
        profile: await profileForSelection(
          db,
          z.string().max(100).parse(profile),
          search.get("einladung") || undefined,
        ),
      });

    throw new AppError("Unbekannte Anfrage.");
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const raw = await body(request, 8000);
    // Profilsuche per POST: der gesuchte Name steht so in keiner Adresse und
    // in keinem Zugriffsprotokoll.
    if (raw?.action === "search") {
      if (!databaseReady()) return json({ ready: false, profiles: [] });
      return json({
        ready: true,
        profiles: await searchProfiles(database(), z.string().max(200).parse(raw.q ?? "")),
      });
    }
    if (!authReady() || !databaseReady())
      return json(
        {
          error:
            "Die Anmeldung wird gerade eingerichtet. Die öffentlichen Ergebnisse kannst du schon ansehen.",
        },
        503,
      );
    // Angemeldet: Übernahme mit dem bestehenden Konto anfragen oder auf eine
    // Rückfrage antworten. Keine zweite Bestätigungsmail.
    if (raw?.action === "claim" || raw?.action === "answer") {
      const actor = await getCurrentUser();
      if (!actor) throw new AppError("Bitte melde dich zuerst an.", 401);
      const db = database();
      return json(
        raw.action === "claim"
          ? await requestClaimSignedIn(db, actor, raw.value)
          : await answerInfoRequest(db, actor, raw.value),
      );
    }
    if (raw?.action !== "start") throw new AppError("Unbekannte Aktion.");

    const db = database();
    // Merkt sich in diesem Browser, welche Anfrage gerade gestellt wurde:
    // Der Bestätigungslink bindet genau diese Anfrage, und /starten zeigt ihre
    // Angaben wieder an, aber nur diesem Browser (Geheimnis im Cookie, Beleg
    // am Absenden). Schon vor dem Versand gesetzt, damit die Angaben auch nach
    // einem abgelehnten Versand nicht verloren sind.
    const browser = browserSecret();
    const created = await startRequest(db, raw.value, browser.proof);
    (await cookies()).set(ONBOARDING_COOKIE, `${created.id}.${browser.secret}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_URL?.startsWith("https://") ?? false,
      path: "/",
      maxAge: 60 * 60 * 24 * 2,
    });

    // Erst nach erfolgreich gespeicherter Anfrage die Bestätigungsmail
    // auslösen. Die Auswahl liegt damit serverseitig und überlebt den Link,
    // ohne dass Kontaktdaten in einer URL stehen.
    const client = await authClient();
    const { error } = await client.auth.signInWithOtp({
      email: z.string().trim().toLowerCase().email().parse(raw.value?.email),
      options: {
        // Neue Profile landen nach der Einrichtung beim ersten Tagesabschluss;
        // Übernahmen führt /start zum Prüfstatus.
        emailRedirectTo: emailRedirect("/tagesabschluss", "starten"),
        shouldCreateUser: true,
        // Wird in der Vorlage nur angezeigt, nie für Zugriffsentscheidungen
        // verwendet. Die Berechtigung entsteht ausschließlich serverseitig.
        data: { onboarding_kind: created.kind },
      },
    });
    if (error) throw sendFailure(error);
    // Beleg für „Mail geschickt“ (Übergabe an Supabase), und ein neuer Code
    // hebt die Sperre für Codeversuche auf.
    await markMailSent(db, created.id, created.email);
    await clearRateLimit(db, `verify:${created.email}`);
    return json({
      ok: true,
      resubmitted: created.resubmitted,
      resendAfter: RESEND_SECONDS,
      code: emailCodeEnabled(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
