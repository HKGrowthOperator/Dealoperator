import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import EmailLink from "../features/email-link";
export const dynamic = "force-dynamic";

/**
 * Landepunkt des Links aus den eigenen Mails (Bestätigung und neues
 * Passwort). Der Schlüssel steht nach „#“ und wird nur im Browser gelesen.
 */
export default function Page() {
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="auth-layout">
        <EmailLink />
      </main>
      <OperatorFooter />
    </div>
  );
}
