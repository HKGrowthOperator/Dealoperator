import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/**
 * Altbestand: die direkte Profilübernahme gibt es nicht mehr. Alte Links —
 * auch aus früheren Einladungen — führen in den geprüften Ablauf unter
 * /starten, damit niemand die Teamfreigabe umgeht.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const search = await searchParams;
  const params = new URLSearchParams();
  if (search.profil && search.profil !== "beispiel")
    params.set("profil", search.profil);
  if (search.einladung) params.set("einladung", search.einladung);
  const query = params.toString();
  redirect(`/starten${query ? `?${query}` : ""}`);
}
