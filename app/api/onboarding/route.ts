import { z } from "zod";
import { cookies } from "next/headers";
import { authClient, authReady, getCurrentUser } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { body, errorResponse, json } from "@/server/http";
import { AppError } from "@/server/operator";
import {
  profileForSelection,
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

    return json({
      ready: true,
      profiles: await searchProfiles(db, search.get("q") || ""),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const raw = await body(request, 8000);
    if (!authReady() || !databaseReady())
      return json(
        {
          error:
            "Die Anmeldung wird gerade eingerichtet. Die öffentlichen Ergebnisse kannst du schon ansehen.",
        },
        503,
      );
    if (raw?.action !== "start") throw new AppError("Unbekannte Aktion.");

    const db = database();
    const created = await startRequest(db, raw.value);

    // Erst nach erfolgreich gespeicherter Anfrage die Bestätigungsmail
    // auslösen. Die Auswahl liegt damit serverseitig und überlebt den Link,
    // ohne dass Kontaktdaten in einer URL stehen.
    const client = await authClient();
    const redirect = new URL("/auth/callback", process.env.APP_URL!);
    const { error } = await client.auth.signInWithOtp({
      email: z.string().email().parse(raw.value?.email),
      options: {
        emailRedirectTo: redirect.toString(),
        shouldCreateUser: true,
        // Wird in der Vorlage nur angezeigt, nie für Zugriffsentscheidungen
        // verwendet. Die Berechtigung entsteht ausschließlich serverseitig.
        data: created.participant
          ? { onboarding_kind: "claim" }
          : { onboarding_kind: "new" },
      },
    });
    if (error)
      return json(
        {
          error:
            "Der Bestätigungslink konnte gerade nicht versendet werden. Bitte versuche es später erneut.",
        },
        429,
      );
    // Merkt sich in diesem Browser, welche Anfrage gerade gestellt wurde.
    // Damit wird beim Bestätigungslink genau diese Anfrage gebunden.
    (await cookies()).set(ONBOARDING_COOKIE, created.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_URL?.startsWith("https://") ?? false,
      path: "/",
      maxAge: 60 * 60 * 24 * 2,
    });
    return json({ ok: true, resubmitted: created.resubmitted });
  } catch (e) {
    return errorResponse(e);
  }
}
