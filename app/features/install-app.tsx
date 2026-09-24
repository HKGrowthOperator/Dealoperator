"use client";
import { useState, useSyncExternalStore } from "react";
import {
  CircleCheck,
  Download,
  EllipsisVertical,
  MonitorDown,
  PanelTop,
  Share,
  Smartphone,
  SquarePlus,
  Trash2,
} from "lucide-react";

/*
 * Deal Operator als App auf dem Gerät: nur hier in den Benachrichtigungs-
 * Einstellungen erklärt, nie als Aufforderung an anderer Stelle. Als App
 * kommen Erinnerungen mit dem Deal-Operator-Symbol (Safari zeigt Symbole von
 * Websites nicht an); auf iPhone und iPad gibt es Push überhaupt nur so.
 */

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
let deferred: InstallEvent | null = null;
const READY = "do-install-ready";

/**
 * Vom Seitenkopf für „beforeinstallprompt“ registriert (Chrome, Edge,
 * Android): kein Banner, die Installation bleibt für die Einstellungen
 * aufgehoben.
 */
export function keepInstallPrompt(event: Event) {
  event.preventDefault();
  deferred = event as InstallEvent;
  window.dispatchEvent(new Event(READY));
}

type Platform = "unknown" | "installed" | "ios" | "android" | "mac-safari" | "desktop";

function readPlatform(): Platform {
  const ua = navigator.userAgent;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua))
    return "mac-safari";
  return "desktop";
}
function subscribe(change: () => void) {
  window.addEventListener(READY, change);
  window.addEventListener("appinstalled", change);
  return () => {
    window.removeEventListener(READY, change);
    window.removeEventListener("appinstalled", change);
  };
}

const TITLE: Record<Exclude<Platform, "unknown" | "installed">, string> = {
  ios: "Zum Home-Bildschirm hinzufügen",
  android: "Zum Startbildschirm hinzufügen",
  "mac-safari": "Zum Dock hinzufügen",
  desktop: "Als App installieren",
};

export default function InstallApp() {
  const platform = useSyncExternalStore(subscribe, readPlatform, () => "unknown" as Platform);
  const canPrompt = useSyncExternalStore(subscribe, () => !!deferred, () => false);
  const [result, setResult] = useState("");

  async function install() {
    const event = deferred;
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    deferred = null;
    window.dispatchEvent(new Event(READY));
    setResult(
      outcome === "accepted"
        ? "Deal Operator ist installiert. Öffne es über das neue Symbol und richte dort unter Profil Push ein."
        : "",
    );
  }

  if (platform === "unknown") return null;
  if (platform === "installed")
    return (
      <div className="cm-pref cm-app">
        <p className="cm-app-ok">
          <CircleCheck size={18} aria-hidden="true" />
          <span>Deal Operator ist auf diesem Gerät als App eingerichtet. Erinnerungen kommen mit dem Deal-Operator-Symbol.</span>
        </p>
      </div>
    );

  return (
    <div className="cm-pref cm-app">
      <div className="cm-app-head">
        <strong>{TITLE[platform]}</strong>
        <small>
          {platform === "ios"
            ? "Auf iPhone und iPad gibt es Push-Erinnerungen nur so. Sie kommen dann mit dem Deal-Operator-Symbol."
            : "Erinnerungen kommen dann mit dem Deal-Operator-Symbol statt mit dem des Browsers."}
        </small>
      </div>

      {canPrompt ? (
        <div className="cm-actions">
          <button type="button" className="btn secondary" onClick={() => void install()}>
            <Download size={16} aria-hidden="true" />
            Als App installieren
          </button>
        </div>
      ) : (
        <ol className="cm-app-steps">
          {platform === "ios" && (
            <>
              <li>
                <Share size={17} aria-hidden="true" />
                <span>
                  Tippe in Safari auf <strong>Teilen</strong>. Bei neueren iOS-Versionen steckt es
                  unter <strong>„…“</strong>.
                </span>
              </li>
              <li>
                <SquarePlus size={17} aria-hidden="true" />
                <span>
                  Wähle <strong>„Zum Home-Bildschirm“</strong> und tippe auf Hinzufügen.
                </span>
              </li>
              <li>
                <Smartphone size={17} aria-hidden="true" />
                <span>
                  Öffne Deal Operator über das neue Symbol, melde dich einmal an und richte unter
                  Profil Push ein.
                </span>
              </li>
            </>
          )}
          {platform === "android" && (
            <>
              <li>
                <EllipsisVertical size={17} aria-hidden="true" />
                <span>
                  Öffne in Chrome das Menü <strong>⋮</strong>.
                </span>
              </li>
              <li>
                <SquarePlus size={17} aria-hidden="true" />
                <span>
                  Wähle <strong>„Zum Startbildschirm hinzufügen“</strong> oder{" "}
                  <strong>„App installieren“</strong>.
                </span>
              </li>
              <li>
                <Smartphone size={17} aria-hidden="true" />
                <span>Öffne Deal Operator über das neue Symbol.</span>
              </li>
            </>
          )}
          {platform === "mac-safari" && (
            <>
              <li>
                <PanelTop size={17} aria-hidden="true" />
                <span>
                  Wähle in der Menüleiste <strong>Ablage › „Zum Dock hinzufügen…“</strong> (ab
                  macOS Sonoma).
                </span>
              </li>
              <li>
                <MonitorDown size={17} aria-hidden="true" />
                <span>
                  Öffne Deal Operator aus dem Dock, melde dich falls nötig an und richte unter
                  Profil Push ein.
                </span>
              </li>
              <li>
                <Trash2 size={17} aria-hidden="true" />
                <span>
                  Entferne danach unten bei den Geräten den älteren Eintrag „Mac“, sonst kommt jede
                  Erinnerung doppelt.
                </span>
              </li>
            </>
          )}
          {platform === "desktop" && (
            <>
              <li>
                <MonitorDown size={17} aria-hidden="true" />
                <span>
                  Wähle im Browsermenü <strong>„App installieren“</strong> oder{" "}
                  <strong>„Diese Seite als App installieren“</strong>, falls dein Browser das
                  anbietet.
                </span>
              </li>
              <li>
                <Smartphone size={17} aria-hidden="true" />
                <span>Öffne Deal Operator danach als App.</span>
              </li>
            </>
          )}
        </ol>
      )}

      {result && (
        <p className="cm-alert ok" role="status">
          <CircleCheck size={18} aria-hidden="true" />
          <span>{result}</span>
        </p>
      )}
    </div>
  );
}
