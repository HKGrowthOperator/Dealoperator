import Link from "next/link";
import { Headphones } from "lucide-react";
import OperatorWordmark from "./operator-wordmark";
export function OperatorHeader() {
  return (
    <header className="operator-header">
      <Link
        className="operator-logo"
        href="/"
        aria-label="Deal Operator – Startseite"
      >
        <OperatorWordmark />
      </Link>
      <nav aria-label="Hauptnavigation">
        <Link href="/ranking">Ranking</Link>
        <Link href="/heute?modus=eigen">Community entdecken</Link>
        <Link className="btn primary" href="/beitreten">
          Kostenfrei mitmachen
        </Link>
      </nav>
    </header>
  );
}
export function OperatorFooter() {
  return (
    <footer className="operator-footer">
      <Link
        className="operator-logo"
        href="/"
        aria-label="Deal Operator – Startseite"
      >
        <OperatorWordmark />
      </Link>
      <p>Gemeinsam callen. Ehrlich reflektieren. Weiterkommen.</p>
      <div>
        <Link href="/community?modus=eigen">So funktioniert’s</Link>
        <Link href="/verwaltung">Verwaltung</Link>
        <Link href="/impressum">Impressum</Link>
        <Link href="/datenschutz">Datenschutz</Link>
      </div>
    </footer>
  );
}
export function DiscordCard({ url }: { url?: string }) {
  return (
    <aside className="discord-card">
      <span className="section-kicker">
        <Headphones size={17} /> DEINE CREW WARTET
      </span>
      <h2>
        Der nächste Call
        <br />
        fällt zusammen leichter.
      </h2>
      <p>
        Finde deinen Call-Buddy, verabrede dich zu Fokusblöcken und teile, was
        heute funktioniert hat.
      </p>
      {url ? (
        <a
          className="btn lime"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Discord öffnen
        </a>
      ) : (
        <Link className="btn lime" href="/crew?modus=eigen">
          Buddys & Community entdecken
        </Link>
      )}
      <small>
        {url
          ? "Call-Buddys finden und den nächsten Fokusblock verabreden."
          : "Der direkte Discord-Einstieg folgt mit der Freischaltung."}
      </small>
    </aside>
  );
}
