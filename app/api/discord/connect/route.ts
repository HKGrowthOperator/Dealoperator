import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/auth";
import { database } from "@/server/database";
import { body, errorResponse, json } from "@/server/http";
import { rateLimit } from "@/server/operator";
import { authorizeUrl, discordConfig, discordMissing } from "@/server/discord-bridge";
import {
  DISCORD_STATE_COOKIE,
  discordLink,
  newState,
  redirectUri,
  unlinkDiscord,
} from "@/server/discord-admin";

export const dynamic = "force-dynamic";

/** Stand der eigenen Verknüpfung und ob sie überhaupt möglich ist. */
export async function GET() {
  try {
    const actor = await getCurrentUser();
    if (!actor) return json({ error: "Bitte melde dich zuerst an." }, 401);
    const missing = discordMissing("link");
    return json({
      available: missing.length === 0,
      // Ob freigegebene Abschlüsse tatsächlich in den Channel übertragen werden.
      postsAvailable: discordMissing("posts").length === 0,
      link: await discordLink(database(), actor.userId),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Startet die Verknüpfung (action: "start") oder hebt sie auf (action: "unlink"). */
export async function POST(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (!actor) return json({ error: "Bitte melde dich zuerst an." }, 401);
    const raw = await body(request, 2_000);
    const db = database();
    await rateLimit(db, `discord-link:${actor.userId}`, 10, 3600);
    if (raw?.action === "unlink") return json(await unlinkDiscord(db, actor));
    const missing = discordMissing("link");
    if (missing.length)
      return json({ error: "Die Discord-Verknüpfung ist noch nicht eingerichtet." }, 503);
    const state = newState();
    (await cookies()).set(DISCORD_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_URL?.startsWith("https://") ?? false,
      path: "/api/discord",
      maxAge: 600,
    });
    return json({ url: authorizeUrl(discordConfig().clientId!, redirectUri(), state) });
  } catch (e) {
    return errorResponse(e);
  }
}
