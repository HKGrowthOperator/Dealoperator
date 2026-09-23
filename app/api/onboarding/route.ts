import { z } from "zod";
import { cookies } from "next/headers";
import { authClient, authReady, getCurrentUser } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { body, errorResponse, json } from "@/server/http";
import { AppError, clearRateLimit, rateLimit } from "@/server/operator";
import {
  emailCodeEnabled,
  emailRedirect,
  passwordFailure,
  passwordSchema,
  RESEND_SECONDS,
  sendFailure,
} from "@/server/email-auth";
import {
  answerInfoRequest,
  browserRequestState,
  browserSecret,
  markMailSent,
  pendingForBrowser,
  profileForSelection,
  requestClaimSignedIn,
  requestForActor,
  ONBOARDING_COOKIE,
  requestIdFromCookie,
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

    // Gerät, das nach der Registrierung auf die Bestätigung wartet (auch wenn
    // die Mail auf dem Handy geöffnet wird). Nur „wartet“ oder „bestätigt“.
    if (search.get("status") === "bestaetigung") {
      if (!databaseReady()) return json({ state: "none" });
      return json({
        state: await browserRequestState(
          database(),
          (await cookies()).get(ONBOARDING_COOKIE)?.value,
        ),
      });
    }

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
    const db = database();

    // Bestätigungsmail der Registrierung noch einmal senden. Nur für die
    // Anfrage aus diesem Browser; ein Passwort braucht es dafür nicht.
    if (raw?.action === "resend") {
      const cookie = (await cookies()).get(ONBOARDING_COOKIE)?.value;
      const pending = await pendingForBrowser(db, cookie);
      const id = requestIdFromCookie(cookie);
      if (!pending || !id) throw new AppError("Bitte gib deine Angaben noch einmal ein.", 409);
      await rateLimit(
        db,
        `onboarding:${pending.email}`,
        5,
        900,
        "Du hast in kurzer Zeit mehrere Bestätigungsmails angefordert. Bitte nutze die letzte Mail oder warte, bis die Zeit abgelaufen ist.",
      );
      const client = await authClient();
      const { error } = await client.auth.resend({
        type: "signup",
        email: pending.email,
        options: { emailRedirectTo: emailRedirect("/tagesabschluss", "starten", id) },
      });
      if (error) throw sendFailure(error);
      await markMailSent(db, id, pending.email);
      await clearRateLimit(db, `verify:${pending.email}`);
      return json({ ok: true, resendAfter: RESEND_SECONDS, code: emailCodeEnabled() });
    }

    if (raw?.action !== "start") throw new AppError("Unbekannte Aktion.");

    // Das Passwort geht nur an Supabase und wird hier nirgends gespeichert.
    const { password: rawPassword, ...value } = (raw.value ?? {}) as Record<string, unknown>;
    const password = passwordSchema.safeParse(rawPassword);
    if (!password.success)
      throw new AppError(password.error.issues[0]?.message || "Bitte prüfe dein Passwort.", 400, undefined, "password");
    // Merkt sich in diesem Browser, welche Anfrage gerade gestellt wurde:
    // Der Bestätigungslink bindet genau diese Anfrage, und /starten zeigt ihre
    // Angaben wieder an, aber nur diesem Browser (Geheimnis im Cookie, Beleg
    // am Absenden). Schon vor dem Versand gesetzt, damit die Angaben auch nach
    // einem abgelehnten Versand nicht verloren sind.
    const browser = browserSecret();
    const created = await startRequest(db, value, browser.proof);
    (await cookies()).set(ONBOARDING_COOKIE, `${created.id}.${browser.secret}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_URL?.startsWith("https://") ?? false,
      path: "/",
      maxAge: 60 * 60 * 24 * 2,
    });

    // Erst nach erfolgreich gespeicherter Anfrage das Konto anlegen. Supabase
    // schickt dabei die Bestätigungsmail. Die Auswahl liegt serverseitig und
    // überlebt den Link, ohne dass Kontaktdaten in einer URL stehen.
    const client = await authClient();
    const { data, error } = await client.auth.signUp({
      email: created.email,
      password: password.data,
      options: {
        // Neue Profile landen nach der Einrichtung beim ersten Tagesabschluss;
        // Übernahmen führt /start zum Prüfstatus.
        emailRedirectTo: emailRedirect("/tagesabschluss", "starten", created.id),
        // Wird in der Vorlage nur angezeigt, nie für Zugriffsentscheidungen
        // verwendet. Die Berechtigung entsteht ausschließlich serverseitig.
        data: { onboarding_kind: created.kind, has_password: true },
      },
    });
    if (error?.code === "weak_password" || error?.code === "same_password") throw passwordFailure(error);
    if (error) throw sendFailure(error);
    // Adresse gehört schon zu einem bestätigten Konto: Supabase verrät das
    // bewusst nicht per Fehler, sondern mit einem Nutzer ohne Identitäten.
    // Die Anfrage bleibt in diesem Browser gespeichert; nach der Anmeldung
    // bindet /start sie an das Konto.
    if (data.user && !data.session && (data.user.identities ?? []).length === 0)
      throw new AppError(
        "Für diese Adresse gibt es schon ein Konto. Melde dich mit deinem Passwort an; noch keins festgelegt? Dann über „Passwort vergessen“.",
        409,
        undefined,
        "email",
      );
    // Ohne Bestätigungspflicht ist die Sitzung sofort da.
    if (data.session)
      return json({ ok: true, signedIn: true, next: "/start?next=%2Ftagesabschluss" });
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
