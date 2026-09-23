import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { body, errorResponse, json } from "@/server/http";
import { AppError, rateLimit } from "@/server/operator";
import {
  closingState,
  discardDraft,
  requestPause,
  saveDraft,
  submitClosing,
  withdrawPause,
} from "@/server/closing";
import { berlinDate } from "@/lib/kpis";

export const dynamic = "force-dynamic";

const LOGIN = "Bitte melde dich mit deiner bestätigten E-Mail an.";

/** Eigener Stand: Berechtigung, Abschlüsse, Entwürfe, Serien, Monatskalender. */
export async function GET(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (!actor) return json({ error: LOGIN }, 401);
    if (!databaseReady()) return json({ error: "Die Datenbank ist noch nicht verbunden." }, 503);
    const month = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .parse(new URL(request.url).searchParams.get("monat") || berlinDate().slice(0, 7));
    return json(await closingState(database(), actor, month));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (!actor) return json({ error: LOGIN }, 401);
    const raw = await body(request, 40_000);
    const db = database();
    switch (raw?.action) {
      case "draft":
        await rateLimit(db, `draft:${actor.userId}`, 120);
        return json(await saveDraft(db, actor, raw.value));
      case "discard":
        await rateLimit(db, `draft:${actor.userId}`, 120);
        return json(await discardDraft(db, actor, raw.value));
      case "submit":
        await rateLimit(db, `submit:${actor.userId}`, 10);
        return json(await submitClosing(db, actor, raw.value));
      case "pause":
        await rateLimit(db, `pause:${actor.userId}`, 10, 3600);
        return json(await requestPause(db, actor, raw.value));
      case "withdrawPause":
        await rateLimit(db, `pause:${actor.userId}`, 10, 3600);
        return json(await withdrawPause(db, actor, raw.value));
      default:
        throw new AppError("Unbekannte Aktion.");
    }
  } catch (e) {
    return errorResponse(e);
  }
}
