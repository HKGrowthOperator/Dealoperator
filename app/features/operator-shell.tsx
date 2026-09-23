import Link from "next/link";
import OperatorWordmark from "./operator-wordmark";
import { DISCORD_INVITE } from "@/lib/discord";

/**
 * Kopf der öffentlichen Seiten. Zwei Hauptaktionen: der eigene
 * Tagesabschluss und die Ergebnisse. Reflexionen und Discord sind bewusst
 * leiser; Discord ist ein Ort für den Austausch, kein Pitch im Kopfbereich.
 */
export function OperatorHeader({
  discordUrl = DISCORD_INVITE,
}: {
  discordUrl?: string;
}) {
  return (
    <header className="operator-header op-shell-header">
      <Link
        className="operator-logo"
        href="/"
        aria-label="Deal Operator – Startseite"
      >
        <OperatorWordmark />
      </Link>
      <nav className="op-shell-nav" aria-label="Hauptnavigation">
        <Link className="op-shell-link op-shell-results" href="/ranking">
          Ergebnisse
        </Link>
        <Link className="op-shell-link op-shell-quiet" href="/reflexionen">
          Reflexionen
        </Link>
        <a
          className="op-shell-link op-shell-quiet"
          href={discordUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Discord
        </a>
      </nav>
      <Link className="btn primary op-shell-primary" href="/tagesabschluss">
        Tagesabschluss
      </Link>
    </header>
  );
}
export function OperatorFooter({
  discordUrl = DISCORD_INVITE,
  showAdmin = false,
}: {
  discordUrl?: string;
  /** Link zur Verwaltung; standardmäßig aus, nur für das Team gedacht. */
  showAdmin?: boolean;
}) {
  return (
    <footer className="operator-footer op-shell-footer">
      <Link
        className="operator-logo"
        href="/"
        aria-label="Deal Operator – Startseite"
      >
        <OperatorWordmark />
      </Link>
      <p>Zusammen callen. Gemeinsam dranbleiben.</p>
      <div>
        <Link href="/tagesabschluss">Tagesabschluss</Link>
        <Link href="/ranking">Ergebnisse</Link>
        <Link href="/reflexionen">Reflexionen</Link>
        <a href={discordUrl} target="_blank" rel="noopener noreferrer">
          Discord
        </a>
        <Link href="/#so-funktionierts">So funktioniert’s</Link>
        {showAdmin && <Link href="/verwaltung">Verwaltung</Link>}
        <Link href="/impressum">Impressum</Link>
        <Link href="/datenschutz">Datenschutz</Link>
      </div>
    </footer>
  );
}
