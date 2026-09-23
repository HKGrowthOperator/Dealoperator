import { redirect } from "next/navigation";
import { getCurrentUser, isTeam } from "@/server/auth";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import ImportConsole from "../features/import-console";
import AdminPanels from "../features/admin-panels";
import "../admin.css";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getCurrentUser();
  // Aus einem Team-Push ohne Sitzung auf diesem Gerät: anmelden und danach
  // genau hierher zurück.
  if (!actor) {
    const search = await searchParams;
    const keep = new URLSearchParams();
    for (const key of ["bereich", "eintrag", "anfrage"]) {
      const value = search[key];
      if (typeof value === "string" && /^[a-z0-9-]{1,64}$/i.test(value)) keep.set(key, value);
    }
    if (keep.has("eintrag") || keep.has("anfrage"))
      redirect(`/anmelden?next=${encodeURIComponent(`/verwaltung?${keep}`)}`);
  }
  return (
    <div className="operator-site">
      <OperatorHeader />
      {isTeam(actor) ? (
        <AdminPanels role={actor.admin ? "admin" : "moderator"} />
      ) : (
        // Ohne Verwaltungskonto bleibt nur die lokale CSV-Vorschau samt
        // Anmeldehinweis. Es wird nichts gespeichert.
        <ImportConsole admin={false} signedIn={!!actor} />
      )}
      <OperatorFooter />
    </div>
  );
}
