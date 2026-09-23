import { getCurrentUser } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { errorResponse, json } from "@/server/http";
import { rateLimit } from "@/server/operator";
import { reflectionFeed } from "@/server/reflections";

export const dynamic = "force-dynamic";

/**
 * Austausch der Reflexionen. Nur für verifizierte Mitglieder; die Prüfung
 * steckt in reflectionFeed. Ohne Berechtigung kommt nur, was noch fehlt.
 */
export async function GET(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (!actor)
      return json({ allowed: false, missing: ["login"], cards: [], people: [] }, 401);
    if (!databaseReady()) return json({ error: "Die Datenbank ist noch nicht verbunden." }, 503);
    const db = database();
    await rateLimit(db, `feed:${actor.userId}`, 60);
    const search = new URL(request.url).searchParams;
    return json(
      await reflectionFeed(db, actor, {
        day: search.get("tag") || undefined,
        person: search.get("person") || undefined,
        before: search.get("vor") || undefined,
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
