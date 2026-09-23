import { z } from "zod";
import { authClient, authReady, safeNext } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { rateLimit } from "@/server/operator";
import { body, errorResponse, json } from "@/server/http";
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
    const v = z
      .object({
        email: z.string().trim().email().max(254),
        next: z.string().max(200).optional(),
      })
      .parse(raw);
    await rateLimit(database(), `email:${v.email.toLowerCase()}`, 3, 900);
    await rateLimit(database(), "auth-global", 100, 3600);
    const redirect = new URL("/auth/callback", process.env.APP_URL!);
    redirect.searchParams.set("next", safeNext(v.next || null));
    // Neue Konten entstehen nur über die Registrierung (/beitreten: „Ich bin
    // neu“ oder „Meine Zahlen sind schon auf der Seite“). So läuft jede
    // Neuanmeldung durch denselben Ablauf mit Telefonnummer, Team-Hinweis und
    // Prüfung. Die Anmeldung hier ist nur für bestehende Konten.
    const { error } = await client.auth.signInWithOtp({
      email: v.email,
      options: { emailRedirectTo: redirect.toString(), shouldCreateUser: false },
    });
    // Unbekannte Adresse: dieselbe Antwort wie bei Erfolg, damit sich nicht
    // abfragen lässt, wer ein Konto hat. Die Seite weist auf die Registrierung hin.
    if (error && /signup|not allowed|not found/i.test(`${error.code || ""} ${error.message}`))
      return json({ ok: true });
    if (error)
      return json(
        {
          error:
            "Der Anmeldelink konnte gerade nicht versendet werden. Bitte versuche es später erneut.",
        },
        429,
      );
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
