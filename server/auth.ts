import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export function authReady() {
  return !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    process.env.APP_URL
  );
}
export async function authClient() {
  if (!authReady()) throw Error("Die Anmeldung wird gerade eingerichtet.");
  const jar = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
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
export type Actor = { userId: string; email: string; admin: boolean };
export async function getCurrentUser(): Promise<Actor | null> {
  if (!authReady()) return null;
  const client = await authClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user?.email_confirmed_at || !user.email) return null;
  return {
    userId: user.id,
    email: user.email.toLowerCase(),
    admin: (process.env.OPERATOR_ADMIN_IDS || "")
      .split(",")
      .map((v) => v.trim())
      .includes(user.id),
  };
}
export { safeNext } from "../lib/navigation";
