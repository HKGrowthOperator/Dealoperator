import { errorResponse } from "@/server/http";
import { memberAvatar } from "@/server/members";
import { requireCurrentMember } from "@/server/member-session";
export async function GET(request: Request) {
  try {
    const { actor, db } = await requireCurrentMember();
    const id = (new URL(request.url).searchParams.get("id") || "").slice(
      0,
      100,
    );
    const image = await memberAvatar(db, actor!, id);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
