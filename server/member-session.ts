import { getCurrentUser } from "./auth";
import { database } from "./database";
import { requireMember } from "./member-access";
import { AppError } from "./operator";
/** Authenticate first; missing database configuration never makes admission succeed. */
export async function requireCurrentMember() {
  const actor = await getCurrentUser();
  if (!actor) throw new AppError("Bitte melde dich an.", 401);
  const db = database(),
    access = await requireMember(db, actor);
  return { actor, db, access };
}
