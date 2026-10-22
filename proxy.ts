import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicEntry } from "./lib/member-access";
import { database } from "./server/database";
import { memberAccess } from "./server/member-access";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)
    return isPublicEntry(request.nextUrl.pathname)
      ? response
      : NextResponse.json(
          { error: "Die Anmeldung ist gerade nicht verfügbar." },
          { status: 503, headers: { "Cache-Control": "private, no-store" } },
        );
  const client = createServerClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    {
      // Kept in step with sessionCookieOptions in server/auth.ts. Declared here
      // rather than imported so the middleware bundle stays free of next/headers.
      cookieOptions: {
        httpOnly: true,
        secure: (process.env.APP_URL || "").startsWith("https://"),
        sameSite: "lax",
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          response.headers.set("Cache-Control", "private, no-store");
        },
      },
    },
  );
  const path = request.nextUrl.pathname;
  if (isPublicEntry(path)) {
    await client.auth.getClaims();
    return response;
  }
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  let destination = "/starten";
  let status = 401;
  if (!error && user?.email_confirmed_at && user.email) {
    const db = database();
    const [role] = await db.query(
      "SELECT role FROM team_roles WHERE owner=$1",
      [user.id],
    );
    const admin =
      (process.env.OPERATOR_ADMIN_IDS || "")
        .split(",")
        .map((v) => v.trim())
        .includes(user.id) || role?.role === "admin";
    const access = await memberAccess(db, {
      userId: user.id,
      email: user.email,
      admin,
      moderator: role?.role === "moderator",
    });
    if (access.allowed) {
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    destination = access.next;
    status = 403;
  }
  const blocked = path.startsWith("/api/")
    ? NextResponse.json(
        {
          error:
            status === 401
              ? "Bitte melde dich an."
              : "Dein Zugang ist noch nicht freigegeben.",
        },
        { status },
      )
    : NextResponse.redirect(
        new URL(
          destination === "/starten"
            ? `/starten?next=${encodeURIComponent(path + request.nextUrl.search)}`
            : destination,
          request.url,
        ),
      );
  response.cookies.getAll().forEach((cookie) => blocked.cookies.set(cookie));
  blocked.headers.set("Cache-Control", "private, no-store");
  blocked.headers.set("X-Robots-Tag", "noindex, nofollow");
  return blocked;
}
export const config = { matcher: ["/((?!_next/static).*)"] };
