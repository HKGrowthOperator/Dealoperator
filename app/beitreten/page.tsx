import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/**
 * Frühere Adresse des Starts. Alte Links (Einladungen, Lesezeichen,
 * E-Mail-Fehlerlinks) landen mit allen Angaben unter /starten.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value])
      params.append(key, v);
  const query = params.toString();
  redirect(`/starten${query ? `?${query}` : ""}`);
}
