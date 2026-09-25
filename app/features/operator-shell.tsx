"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink, PencilLine } from "lucide-react";
import OperatorWordmark from "./operator-wordmark";
import AccountMenu from "./account-menu";
import { keepInstallPrompt } from "./install-app";
import { DISCORD_INVITE } from "@/lib/discord";

/** Anmeldestand für Kopf und Reiterleiste. */
export type Viewer = {
  signedIn: boolean;
  hasPassword: boolean;
  team: boolean;
  role?: "admin" | "moderator" | null;
};

// Ein Abruf je Seitenaufruf, geteilt von Kopf, Reiterleiste und Kontomenü.
let pending: Promise<Viewer | null> | null = null;
export function loadViewer(): Promise<Viewer | null> {
  pending ??= fetch("/api/auth", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) =>
      data
        ? {
            signedIn: !!data.signedIn,
            hasPassword: !!data.hasPassword,
            team: !!data.team,
            role: data.role === "admin" || data.role === "moderator" ? data.role : null,
          }
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
 * an den Reflexionen; Call-Partner ist ein eigener Reiter.
 */
type Area = "results" | "day" | "exchange" | "partner" | "profile" | "admin" | "";
function areaOf(path: string): Area {
  if (path === "/" || path.startsWith("/ranking")) return "results";
  if (/^\/verwaltung(\/|$)/.test(path)) return "admin";
  if (/^\/(tagesabschluss|heute|zahlen|reflexion)(\/|$)/.test(path)) return "day";
  if (/^\/partner(\/|$)/.test(path)) return "partner";
  if (/^\/(reflexionen|sessions|wissen)(\/|$)/.test(path)) return "exchange";
  if (/^\/(profil|passwort)(\/|$)/.test(path)) return "profile";
  return "";
}

const MAIN = [
  { area: "results", href: "/", label: "Ergebnisse" },
  { area: "day", href: "/tagesabschluss", label: "Mein Tag" },
  { area: "exchange", href: "/reflexionen", label: "Reflexionen" },
  { area: "partner", href: "/partner?modus=eigen", label: "Call-Partner" },
] as const;

/**
 * Ein Kopf für alle Seiten: Logo zur Startseite, die Bereiche, Discord,
 * „Zahlen eintragen“ und das Konto. Am Handy stehen die Bereiche als
 * Reiterleiste direkt unter dem Kopf; unten gibt es keine feste Leiste mehr,
 * weil dort niemand hinsieht.
 */
export function OperatorHeader({
  viewer: initial,
}: {
  /** Discord steht im Kopf und auf der Startseite; der Parameter bleibt kompatibel. */
  discordUrl?: string;
  /** Bereits bekannter Anmeldestand (vermeidet ein kurzes Umspringen). */
  viewer?: Viewer | null;
}) {
  const path = usePathname() || "/";
  const area = areaOf(path);
  const viewer = useViewer(initial);
  // Kein Banner „Zum Startbildschirm hinzufügen“: Installieren steht nur in
  // den Benachrichtigungs-Einstellungen, dort wird das Angebot verwendet.
  useEffect(() => {
    window.addEventListener("beforeinstallprompt", keepInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", keepInstallPrompt);
  }, []);
  const signedIn = !!viewer?.signedIn;
  // Zahlen eintragen läuft über die Reflexionen (erst der eigene Tag, dann die
  // anderen); dort und unter Mein Tag steht der Knopf nicht noch einmal.
  const onEntry = /^\/(reflexionen|tagesabschluss)(\/|$)/.test(path);
  // Die Reiterleiste am Handy schiebt sich seitlich; der aktuelle Bereich
  // soll beim Öffnen sichtbar sein, nicht hinter dem Rand.
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    const current = strip.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && strip.current && strip.current.scrollWidth > strip.current.clientWidth)
      current.scrollIntoView({ inline: "center", block: "nearest" });
  }, [area]);
  // Abgemeldet entfällt „Mein Tag“; „Anmelden“ steht rechts im Kopf.
  const areas = MAIN.filter((item) => !(viewer && !signedIn && item.area === "day"));
  const links = (
    <>
      {areas.map((item) => (
        <Link
          key={item.area}
          href={item.href}
          className="do-nav-link"
          aria-current={area === item.area ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
      {viewer?.team && (
        <Link
          href="/verwaltung"
          className="do-nav-link"
          aria-current={area === "admin" ? "page" : undefined}
        >
          Verwaltung
        </Link>
      )}
      <a
        className="do-nav-link do-nav-discord"
        href={DISCORD_INVITE}
        target="_blank"
        rel="noopener noreferrer"
      >
        Discord
        <ExternalLink size={14} aria-hidden="true" />
        <span className="do-sr">(neues Fenster)</span>
      </a>
    </>
  );
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
            {links}
          </nav>
          <div className="do-header-actions">
            {viewer && !signedIn && (
              <>
                {path !== "/" && (
                  <Link className="do-button do-button-quiet do-hide-mobile" href="/starten">
                    Kostenfrei starten
                  </Link>
                )}
                <Link className="do-button do-button-secondary" href="/anmelden">
                  Anmelden
                </Link>
              </>
            )}
            {/* Die Hauptsache auf jeder Seite; wo eingetragen wird, nicht doppelt. */}
            {signedIn && !onEntry && (
              <Link className="do-button do-button-primary do-header-cta" href="/reflexionen">
                <PencilLine size={17} aria-hidden="true" />
                <span className="do-cta-long">Zahlen eintragen</span>
                <span className="do-cta-short">Eintragen</span>
              </Link>
            )}
            {signedIn && <AccountMenu viewer={viewer} />}
          </div>
        </div>
      </header>
      {/* Handy: dieselben Bereiche als Reiterleiste unter dem Kopf. */}
      <nav className="do-topnav" aria-label="Bereiche" ref={strip}>
        {links}
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
          <Link href="/partner?modus=eigen">Call-Partner</Link>
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
