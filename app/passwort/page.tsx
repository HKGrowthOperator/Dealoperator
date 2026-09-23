import { redirect } from "next/navigation";
import { getCurrentUser, isTeam } from "@/server/auth";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import PasswordForm from "../features/password-form";
export const dynamic = "force-dynamic";

/**
 * Passwort festlegen oder ändern. Landepunkt des Links aus „Passwort
 * vergessen oder noch keins?“; auch aus dem eigenen Bereich erreichbar.
 */
export default async function Page() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/anmelden?next=%2Fpasswort");
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        <PasswordForm email={actor.email} hasPassword={!!actor.hasPassword} />
      </main>
      <OperatorFooter showAdmin={isTeam(actor)} />
    </div>
  );
}
