import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/auth";
import { database } from "@/server/database";
import { AppError } from "@/server/operator";
import { DISCORD_STATE_COOKIE, linkDiscord } from "@/server/discord-admin";

export const dynamic = "force-dynamic";

function back(result: string) {
  const url = new URL("/tagesabschluss", process.env.APP_URL || "http://localhost:3000");
  url.searchParams.set("discord", result);
  return Response.redirect(url.toString(), 303);
}

export async function GET(request: Request) {
  const jar = await cookies();
  const expected = jar.get(DISCORD_STATE_COOKIE)?.value || "";
  jar.delete({ name: DISCORD_STATE_COOKIE, path: "/api/discord" });
  const search = new URL(request.url).searchParams;
  const state = search.get("state") || "";
  const code = search.get("code") || "";
  const a = Buffer.from(state);
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b) || !code)
    return back("abgebrochen");
  const actor = await getCurrentUser();
  if (!actor) return back("anmelden");
  try {
    await linkDiscord(database(), actor, code.slice(0, 200));
    return back("verbunden");
  } catch (error) {
    return back(error instanceof AppError && error.status === 409 ? "vergeben" : "fehler");
  }
}
