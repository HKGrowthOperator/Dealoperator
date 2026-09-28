import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Reflexionen gehören zu Mein Tag: erst der eigene Tag, dann die anderen,
 * an einem Ort. Ältere Links (Push, Discord, Lesezeichen) bleiben gültig.
 */
export default function Page() {
  redirect("/tagesabschluss#andere");
}
