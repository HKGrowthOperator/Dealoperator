"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartColumn,
  CircleUserRound,
  ClipboardCheck,
  LogIn,
  MessagesSquare,
} from "lucide-react";
import OperatorWordmark from "./operator-wordmark";
import AccountMenu from "./account-menu";
import { DISCORD_INVITE } from "@/lib/discord";

/** Anmeldestand für Kopf und Tableiste. */
export type Viewer = { signedIn: boolean; hasPassword: boolean; team: boolean };

// Ein Abruf je Seitenaufruf, geteilt von Kopf, Tableiste und Kontomenü.
let pending: Promise<Viewer | null> | null = null;
export function loadViewer(): Promise<Viewer | null> {
  pending ??= fetch("/api/auth", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) =>
      data
        ? { signedIn: !!data.signedIn, hasPassword: !!data.hasPassword, team: !!data.team }
        : null,
    )
    .catch(() => null);
  return pending;
}
function useViewer(initial?: Viewer | null) {
  const [viewer, setViewer] = useState<Viewer | null>(initial ?? null);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    void loadViewer().then((v) => alive && v && setViewer(v));
    return () => {
      alive = false;
    };
  }, [initial]);
  return viewer;
}

/**
 * Bereiche der Seite. Ergebnisse ist die gemeinsame Startseite; „Mein Tag“
 * umfasst Tagesabschluss, Fortschritt und eigene Zahlen; der Austausch hängt
 * an den Reflexionen.
 */
type Area = "results" | "day" | "exchange" | "profile" | "";
function areaOf(path: string): Area {
  if (path === "/" || path.startsWith("/ranking")) return "results";
  if (/^\/(tagesabschluss|heute|zahlen|reflexion)(\/|$)/.test(path)) return "day";
  if (/^\/(reflexionen|partner|sessions|wissen)(\/|$)/.test(path)) return "exchange";
  if (/^\/(profil|passwort)(\/|$)/.test(path)) return "profile";
  return "";
}

const MAIN = [
  { area: "results", href: "/", label: "Ergebnisse", icon: ChartColumn },
  { area: "day", href: "/tagesabschluss", label: "Mein Tag", icon: ClipboardCheck },
  { area: "exchange", href: "/reflexionen", label: "Reflexionen", icon: MessagesSquare },
] as const;

/**
 * Ein Kopf für alle Seiten: Logo zur Startseite, drei Bereiche, Konto.
 * Auf dem Handy stehen die Bereiche unten in einer festen Leiste; oben
 * bleiben nur Logo und Konto.
 */
export function OperatorHeader({
  viewer: initial,
}: {
  /** Discord steht nur noch dort, wo es passt; der Parameter bleibt kompatibel. */
  discordUrl?: string;
  /** Bereits bekannter Anmeldestand (vermeidet ein kurzes Umspringen). */
  viewer?: Viewer | null;
}) {
  const path = usePathname() || "/";
  const area = areaOf(path);
  const viewer = useViewer(initial);
  // Kein Banner „Zum Startbildschirm hinzufügen“: Deal Operator bittet nie
  // darum, die Website zu installieren.
  useEffect(() => {
    const quiet = (event: Event) => event.preventDefault();
    window.addEventListener("beforeinstallprompt", quiet);
    return () => window.removeEventListener("beforeinstallprompt", quiet);
  }, []);
  const signedIn = !!viewer?.signedIn;
  return (
    <>
      <a className="do-skip" href="#inhalt">
        Zum Inhalt
      </a>
      <header className="do-header">
        <div className="do-header-inner">
          <Link className="do-logo" href="/" aria-label="Deal Operator – Startseite">
            <OperatorWordmark />
          </Link>
          <nav className="do-nav" aria-label="Hauptnavigation">
            {MAIN.map((item) => (
              <Link
                key={item.area}
                href={item.href}
                className="do-nav-link"
                aria-current={area === item.area ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="do-header-actions">
            {viewer && !signedIn && (
              <>
                <Link className="do-button do-button-quiet do-hide-mobile" href="/starten">
                  Kostenfrei starten
                </Link>
                <Link className="do-button do-button-secondary" href="/anmelden">
                  Anmelden
                </Link>
              </>
            )}
            {signedIn && <AccountMenu viewer={viewer} />}
          </div>
        </div>
      </header>
      <nav className="do-tabbar" aria-label="Bereiche">
        {MAIN.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.area}
              href={item.href}
              aria-current={area === item.area ? "page" : undefined}
            >
              <Icon size={22} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        {viewer && !signedIn ? (
          <Link href="/anmelden">
            <LogIn size={22} aria-hidden="true" />
            <span>Anmelden</span>
          </Link>
        ) : (
          <Link
            href="/profil?modus=eigen"
            aria-current={area === "profile" ? "page" : undefined}
          >
            <CircleUserRound size={22} aria-hidden="true" />
            <span>Profil</span>
          </Link>
        )}
      </nav>
    </>
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
    <footer className="do-footer">
      <div className="do-footer-inner">
        <Link className="do-logo" href="/" aria-label="Deal Operator – Startseite">
          <OperatorWordmark />
        </Link>
        <nav aria-label="Weitere Seiten">
          <Link href="/">Ergebnisse</Link>
          <Link href="/tagesabschluss">Mein Tag</Link>
          <Link href="/reflexionen">Reflexionen</Link>
          <Link href="/so-funktionierts">So funktioniert’s</Link>
          <a href={discordUrl} target="_blank" rel="noopener noreferrer">
            Discord
          </a>
          {showAdmin && <Link href="/verwaltung">Verwaltung</Link>}
          <Link href="/impressum">Impressum</Link>
          <Link href="/datenschutz">Datenschutz</Link>
        </nav>
      </div>
    </footer>
  );
}
