import { body, errorResponse, json } from "@/server/http";
import { AppError, rateLimit } from "@/server/operator";
import {
  directory,
  ownMemberProfile,
  saveMemberProfile,
  saveAvatar,
} from "@/server/members";
import { requireCurrentMember } from "@/server/member-session";
export async function GET(request: Request) {
  try {
    const { actor, db } = await requireCurrentMember();
    return json(
      new URL(request.url).searchParams.get("own") === "1"
        ? await ownMemberProfile(db, actor!)
        : { members: await directory(db, actor!) },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const { actor, db } = await requireCurrentMember();
    const input = await body(request, 180000);
    await rateLimit(db, `members:${actor!.userId}`, 30);
    if (input.action === "save")
      return json(await saveMemberProfile(db, actor!, input.value));
    if (input.action === "avatar")
      return json(await saveAvatar(db, actor!, input.value));
    throw new AppError("Unbekannte Aktion.");
  } catch (e) {
    return errorResponse(e);
  }
}
