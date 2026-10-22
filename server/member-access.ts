import type { Actor } from "./auth";
import type { Database } from "./database";
import { AppError } from "./operator";

/** A verified email alone is not admission. Existing owned profiles remain valid. */
export async function memberAccess(db: Database, actor: Actor | null) {
  if (!actor) return { allowed: false, next: "/starten", participant: null };
  const [profile] = await db.query(
    "SELECT id,name,company,role FROM participants WHERE owner=$1 AND kind='person' LIMIT 1",
    [actor.userId],
  );
  if (profile || actor.admin || actor.moderator)
    return { allowed: true, next: "/", participant: profile || null };
  const [request] = await db.query(
    "SELECT status FROM onboarding_requests WHERE owner=$1 ORDER BY (status IN ('pending','info_needed')) DESC,updated_at DESC LIMIT 1",
    [actor.userId],
  );
  return {
    allowed: false,
    next: request ? "/status" : "/start",
    participant: null,
  };
}
export async function requireMember(db: Database, actor: Actor | null) {
  const access = await memberAccess(db, actor);
  if (!actor) throw new AppError("Bitte melde dich an.", 401);
  if (!access.allowed)
    throw new AppError("Dein Zugang ist noch nicht freigegeben.", 403);
  return access;
}
