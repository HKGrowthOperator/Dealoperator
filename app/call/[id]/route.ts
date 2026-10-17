import { database, databaseReady } from "@/server/database";
import { callEntryDestination } from "@/server/call-entry";

export const dynamic = "force-dynamic";

/** Same-origin push target; no extra sign-in step before opening the public call room. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const fallback = new URL("/sessions?modus=eigen", process.env.APP_URL || request.url).toString();
  if (!databaseReady())
    return new Response("Der Call ist gerade nicht erreichbar. Bitte versuche es noch einmal.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  try {
    const { id } = await context.params;
    const destination = await callEntryDestination(database(), id);
    return new Response(null, {
      status: 307,
      headers: { Location: destination || fallback, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(null, {
      status: 307,
      headers: { Location: fallback, "Cache-Control": "no-store" },
    });
  }
}
