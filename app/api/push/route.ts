import { getCurrentUser } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { body, errorResponse, json } from "@/server/http";
import { AppError, rateLimit } from "@/server/operator";
import {
  dispatch,
  enqueue,
  notificationPrefs,
  savePrefs,
  subscribe,
  unsubscribe,
  vapidKeys,
} from "@/server/notify";
import { recheck } from "@/server/scheduler";

export const dynamic = "force-dynamic";

const LOGIN = "Bitte melde dich mit deiner bestätigten E-Mail an.";

/** Öffentlicher VAPID-Schlüssel und eigene Einstellungen. Der private bleibt auf dem Server. */
export async function GET() {
  try {
    const actor = await getCurrentUser();
    if (!actor) return json({ error: LOGIN }, 401);
    if (!databaseReady()) return json({ error: "Die Datenbank ist noch nicht verbunden." }, 503);
    const db = database();
    const vapid = await vapidKeys(db);
    return json({
      publicKey: vapid.publicKey,
      admin: actor.admin,
      prefs: await notificationPrefs(db, actor.userId),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (!actor) return json({ error: LOGIN }, 401);
    const raw = await body(request, 8_000);
    const db = database();
    switch (raw?.action) {
      case "subscribe":
        await rateLimit(db, `push-sub:${actor.userId}`, 10, 3600);
        return json(
          await subscribe(db, actor, raw.value, request.headers.get("user-agent") || ""),
        );
      case "unsubscribe":
        await rateLimit(db, `push-sub:${actor.userId}`, 10, 3600);
        return json(await unsubscribe(db, actor, raw.value));
      case "prefs":
        await rateLimit(db, `push-prefs:${actor.userId}`, 30, 3600);
        return json(await savePrefs(db, actor, raw.value));
      case "test": {
        // Testnachricht an die eigenen Geräte — feste Worte, keine Eingaben.
        await rateLimit(db, `push-test:${actor.userId}`, 3, 3600);
        const dedupeKey = `test:${actor.userId}:${crypto.randomUUID()}`;
        await enqueue(db, {
          dedupeKey,
          recipient: actor.userId,
          channel: "push",
          kind: "test",
          ref: "",
          title: "Deal Operator",
          body: "Push funktioniert auf diesem Gerät.",
          url: "/tagesabschluss",
          notAfter: new Date(Date.now() + 10 * 60_000),
        });
        await dispatch(db, recheck);
        // Nur das Ergebnis DIESER Testnachricht, an die eigenen Geräte.
        const [own] = await db.query(
          `SELECT n.status,n.detail,
                  (SELECT count(*)::int FROM notification_deliveries d
                    WHERE d.notification_id=n.id AND d.status='sent') AS devices
             FROM notifications n WHERE n.dedupe_key=$1`,
          [dedupeKey],
        );
        return json({
          ok: true,
          claimed: own ? 1 : 0,
          sent: own?.devices ?? 0,
          status: own?.status ?? "pending",
          detail: own?.detail ?? "",
        });
      }
      default:
        throw new AppError("Unbekannte Aktion.");
    }
  } catch (e) {
    return errorResponse(e);
  }
}
