import { getCurrentUser } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { body, errorResponse, json } from "@/server/http";
import { AppError, rateLimit } from "@/server/operator";
import { evidenceDay, evidenceImage, ownMonth, saveEvidence, teamMonth, MAX_IMAGE_BYTES } from "@/server/evidence";

export const dynamic = "force-dynamic";

const LOGIN = "Bitte melde dich mit deiner bestätigten E-Mail an.";

/**
 * GET ?tag=JJJJ-MM-TT            eigener Nachweis des Tages (ohne Bild)
 * GET ?tag=…&bild=1[&profil=ID]  das Bild (eigenes; mit Profil nur fürs Team)
 * GET ?monat=JJJJ-MM[&team=1]    Monatsstand (eigener; fürs Team alle)
 */
export async function GET(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (!actor) return json({ error: LOGIN }, 401);
    if (!databaseReady()) return json({ error: "Die Datenbank ist noch nicht verbunden." }, 503);
    const db = database();
    await rateLimit(db, `evidence-get:${actor.userId}`, 120);
    const q = new URL(request.url).searchParams;
    const day = q.get("tag");
    const month = q.get("monat");
    if (day && q.get("bild")) {
      const image = await evidenceImage(db, actor, day, q.get("profil"));
      return new Response(Buffer.from(image.bytes), {
        headers: {
          "Content-Type": image.type,
          "Cache-Control": "private, no-store",
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
        },
      });
    }
    if (day) return json(await evidenceDay(db, actor, day));
    if (month) return json(q.get("team") ? await teamMonth(db, actor, month) : await ownMonth(db, actor, month));
    throw new AppError("Bitte einen Tag oder Monat angeben.");
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (!actor) return json({ error: LOGIN }, 401);
    // Bild als Base64 im JSON: etwa ein Drittel größer als die Datei.
    const raw = await body(request, Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4_000);
    const db = database();
    await rateLimit(db, `evidence:${actor.userId}`, 30);
    return json(await saveEvidence(db, actor, raw));
  } catch (e) {
    return errorResponse(e);
  }
}
