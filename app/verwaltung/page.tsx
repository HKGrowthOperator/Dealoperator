import { getCurrentUser } from "@/server/auth";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import ImportConsole from "../features/import-console";
import AdminPanels from "../features/admin-panels";
import "../admin.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await getCurrentUser();
  return (
    <div className="operator-site">
      <OperatorHeader />
      {actor?.admin ? (
        <AdminPanels />
      ) : (
        // Ohne Verwaltungskonto bleibt nur die lokale CSV-Vorschau samt
        // Anmeldehinweis. Es wird nichts gespeichert.
        <ImportConsole admin={false} signedIn={!!actor} />
      )}
      <OperatorFooter />
    </div>
  );
}
