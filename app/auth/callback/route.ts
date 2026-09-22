import { authClient, authReady, safeNext } from "@/server/auth";
import { NextResponse } from "next/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = process.env.APP_URL || url.origin;
  const code = url.searchParams.get("code");
  if (authReady() && code) {
    const client = await authClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      const target = new URL("/start", base);
      target.searchParams.set("next", safeNext(url.searchParams.get("next")));
      const response = NextResponse.redirect(target);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  }
  const response = NextResponse.redirect(
    new URL("/beitreten?fehler=link", base),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
