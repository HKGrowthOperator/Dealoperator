import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import AuthForm from "../features/auth-form";
import { authReady, getCurrentUser, safeNext } from "@/server/auth";
import { databaseReady } from "@/server/database";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const search = await searchParams;
  const next = safeNext(search.next || null);
  if (await getCurrentUser()) redirect(next);
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        <AuthForm
          ready={authReady() && databaseReady()}
          next={next}
          error={search.fehler === "link"}
        />
      </main>
      <OperatorFooter />
    </div>
  );
}
