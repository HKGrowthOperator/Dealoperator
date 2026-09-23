import { database, databaseReady } from "./database";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export function authReady() {
  return !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    process.env.APP_URL
  );
}
// @supabase/ssr defaults to httpOnly:false and sets no Secure attribute. No
// browser client exists here, so the session cookie is only ever read on the
// server and can carry both flags.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: (process.env.APP_URL || "").startsWith("https://"),
    sameSite: "lax",
  } as const;
}
export async function authClient() {
  if (!authReady()) throw Error("Die Anmeldung wird gerade eingerichtet.");
  const jar = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: sessionCookieOptions(),
      cookies: {
        getAll: () => jar.getAll(),
        setAll(values) {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server components use the refresh proxy. */
          }
        },
      },
    },
  );
}
/**
 * admin: volle Verwaltung (fest über OPERATOR_ADMIN_IDS oder als Rolle
 * vergeben). moderator: Team-Aufgaben ohne Einstellungen, Rollen und
 * Gesamt-Kontaktliste.
 */
export type Actor = {
  userId: string;
  email: string;
  admin: boolean;
  moderator?: boolean;
};

/** Gehört zum Team (Admin oder Moderator). */
export function isTeam<T extends Pick<Actor, "admin" | "moderator">>(
  actor: T | null | undefined,
): actor is T {
  return !!actor && (actor.admin || !!actor.moderator);
}

/** Fest hinterlegte Grundverwaltung aus der Serverumgebung. */
export function ownerIds(env = process.env) {
  return (env.OPERATOR_ADMIN_IDS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
export async function getCurrentUser(): Promise<Actor | null> {
  if (!authReady()) return null;
  const client = await authClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user?.email_confirmed_at || !user.email) return null;
  const actor: Actor = {
    userId: user.id,
    email: user.email.toLowerCase(),
    admin: ownerIds().includes(user.id),
  };
  if (!actor.admin && databaseReady()) {
    // In der Verwaltung vergebene Rolle. Fehlt die Tabelle noch (vor
    // Migration 0004), bleibt es bei der festen Grundverwaltung.
    try {
      const [row] = await database().query(
        "SELECT role FROM team_roles WHERE owner=$1",
        [user.id],
      );
      if (row?.role === "admin") actor.admin = true;
      if (row?.role === "moderator") actor.moderator = true;
    } catch {
      /* ohne Rollen-Tabelle: nur Grundverwaltung */
    }
  }
  return actor;
}
export { safeNext } from "../lib/navigation";
