import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle, LayoutDashboard } from "lucide-react";
import { getCurrentUser } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { closingState } from "@/server/closing";
import { discordLink } from "@/server/discord-admin";
import { discordMissing } from "@/server/discord-bridge";
import { berlinDate, daySchema } from "@/lib/kpis";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import ClosingForm, { type ClosingState } from "../features/closing-form";
import CommitmentDashboard from "../features/commitment-dashboard";
import PushSetup from "../features/push-setup";
import DiscordLink from "../features/discord-link";
import "../commitment.css";

export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Der eigene Tagesabschluss: Formular für den gewählten Tag (?tag=…,
 * Standard heute), darunter Serien und Kalender, Push-Einrichtung und die
 * Discord-Verknüpfung. Nur mit Anmeldung.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const today = berlinDate();
  const parsed = daySchema.safeParse(one(search.tag));
  const day = parsed.success ? parsed.data : today;
  const actor = await getCurrentUser();
  if (!actor)
    redirect(
      `/anmelden?next=${encodeURIComponent(day === today ? "/tagesabschluss" : `/tagesabschluss?tag=${day}`)}`,
    );

  // Vorladen erspart dem Browser einen leeren Zwischenstand. Klappt es nicht,
  // laden die Bausteine selbst und zeigen einen ehrlichen Fehler.
  let initial: ClosingState | null = null;
  let link: { available: boolean; link: { name: string; since: string } | null } | null = null;
  if (databaseReady()) {
    const db = database();
    try {
      initial = JSON.parse(
        JSON.stringify(await closingState(db, actor, today.slice(0, 7))),
      ) as ClosingState;
    } catch {
      initial = null;
    }
    try {
      link = {
        available: discordMissing("link").length === 0,
        link: await discordLink(db, actor.userId),
      };
    } catch {
      link = null;
    }
  }

  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="cm-page">
        <div className="cm-page-head">
          <p className="cm-kicker">DEIN BEREICH</p>
          <h1>Tagesabschluss</h1>
          <p>
            Zahlen und Reflexion gehören zusammen. Sobald beides vollständig eingereicht ist,
            zählt dein Tag im Ranking, in der Gruppensumme und in deiner Serie.
          </p>
          <nav className="cm-page-links" aria-label="Weiter">
            <Link href="/reflexionen">
              <MessageCircle size={16} aria-hidden="true" /> Reflexionen der Crew
            </Link>
            <Link href="/heute?modus=eigen">
              <LayoutDashboard size={16} aria-hidden="true" /> Meine Übersicht
            </Link>
          </nav>
        </div>
        <ClosingForm
          key={day}
          day={day}
          initial={initial}
          discordAvailable={databaseReady() ? discordMissing("posts").length === 0 : undefined}
          syncUrl
        />
        <CommitmentDashboard initial={initial} />
        <div className="cm-two">
          <PushSetup settings={initial?.settings} />
          <DiscordLink initial={link} result={one(search.discord)} />
        </div>
      </main>
      <OperatorFooter />
    </div>
  );
}
