import { database } from "@/server/database";
import { readiness } from "@/server/readiness";
export const dynamic = "force-dynamic";
export async function GET() {
  const state = await readiness(database);
  return Response.json(state, { status: state.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
