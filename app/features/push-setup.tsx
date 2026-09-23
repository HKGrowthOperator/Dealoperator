"use client";
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  Bell,
  BellOff,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Moon,
  Send,
  Share,
  Smartphone,
  SquarePlus,
  Trash2,
} from "lucide-react";
import { defaultCommitmentSettings, type CommitmentSettings } from "@/lib/commitment";
import { ApiError, getJson, postJson } from "./closing-form";
import "../commitment.css";

/*
 * Geräte-Pushs einrichten. Ehrlich über den Zustand: Ein Gerät gilt erst als
 * eingerichtet, wenn der Browser zugestimmt hat und der Server das Abo kennt.
 * Nach der Erlaubnis wird nur auf ausdrücklichen Klick gefragt, nie
 * automatisch. Mitmachen geht auch ganz ohne Push.
 */

type Device = { endpoint: string; label: string; since: string; lastSuccess: string | null };
type Prefs = {
  reminders: boolean;
  teamAlerts: boolean;
  teamEmail: boolean;
  email: string | null;
  quietStart: number | null;
  quietEnd: number | null;
  devices: Device[];
};
type PushInfo = { publicKey: string; admin: boolean; prefs: Prefs };
type Message = { tone: "ok" | "warn" | "error"; text: string };

/** Umgebung des Geräts; auf dem Server immer „unbekannt“. */
type Environment = {
  kind: "unknown" | "supported" | "unsupported" | "ios-browser" | "ios-old";
  permission: NotificationPermission | "unknown";
};
function readEnvironment(): string {
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const kind =
    ios && !standalone
      ? "ios-browser"
      : !supported
        ? ios
          ? "ios-old"
          : "unsupported"
        : "supported";
  const permission = "Notification" in window ? Notification.permission : "unknown";
  return `${kind}|${permission}`;
}
function subscribeEnvironment(change: () => void) {
  document.addEventListener("visibilitychange", change);
  window.addEventListener("focus", change);
  return () => {
    document.removeEventListener("visibilitychange", change);
    window.removeEventListener("focus", change);
  };
}
function useEnvironment(): Environment {
  const raw = useSyncExternalStore(subscribeEnvironment, readEnvironment, () => "unknown|unknown");
  const [kind, permission] = raw.split("|");
  return {
    kind: kind as Environment["kind"],
    permission: permission as Environment["permission"],
  };
}

function keyBytes(base64url: string) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
function sameKey(a: ArrayBuffer | null, b: Uint8Array) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}
const toClock = (minutes: number | null, fallback: string) =>
  minutes === null
    ? fallback
    : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const toMinutes = (clock: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(clock);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const quietFrom = (prefs: Prefs) => ({
  on: prefs.quietStart !== null,
  start: toClock(prefs.quietStart, "22:00"),
  end: toClock(prefs.quietEnd, "07:00"),
});
const dateOf = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));
const clockText = (c: { hour: number; minute: number }) =>
  `${c.hour}:${String(c.minute).padStart(2, "0")} Uhr`;

async function currentSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export default function PushSetup({
  settings = defaultCommitmentSettings,
}: {
  settings?: CommitmentSettings;
}) {
  const uid = useId();
  const env = useEnvironment();
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [quiet, setQuiet] = useState<{ on: boolean; start: string; end: string } | null>(null);
  const [keyMismatch, setKeyMismatch] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getJson<PushInfo>("/api/push");
      setInfo(data);
      setQuiet(quietFrom(data.prefs));
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    getJson<PushInfo>("/api/push")
      .then((data) => {
        if (!alive) return;
        setInfo(data);
        setQuiet(quietFrom(data.prefs));
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // Welches Abo hat dieses Gerät, und passt es noch zum Serverschlüssel?
  // Nur lesen, nie ungefragt anlegen oder ändern.
  const publicKey = info?.publicKey ?? "";
  useEffect(() => {
    if (env.kind !== "supported" || env.permission !== "granted") return;
    let alive = true;
    currentSubscription()
      .then((sub) => {
        if (!alive) return;
        setEndpoint(sub?.endpoint ?? null);
        setKeyMismatch(
          !!sub && !!publicKey && !sameKey(sub.options.applicationServerKey, keyBytes(publicKey)),
        );
      })
      .catch(() => {
        if (!alive) return;
        setEndpoint(null);
        setKeyMismatch(false);
      });
    return () => {
      alive = false;
    };
  }, [env.kind, env.permission, publicKey]);

  const devices = info?.prefs.devices ?? [];
  const thisDevice = endpoint ? devices.find((d) => d.endpoint === endpoint) : undefined;
  const permission = env.permission;

  async function enable() {
    if (!info) return;
    setBusy("enable");
    setMessage(null);
    try {
      // Zuerst fragen, noch innerhalb des Klicks: Safari verlangt das.
      const answer = await Notification.requestPermission();
      if (answer !== "granted") {
        setMessage(
          answer === "denied"
            ? {
                tone: "warn",
                text: "Benachrichtigungen sind für diese Seite blockiert. Du kannst sie in den Einstellungen deines Browsers oder Geräts wieder erlauben.",
              }
            : {
                tone: "warn",
                text: "Ohne deine Erlaubnis kann dieses Gerät keine Pushs empfangen. Du kannst es jederzeit erneut versuchen.",
              },
        );
        return;
      }
      if (!info.publicKey) throw new Error("Der Push-Versand ist auf dem Server noch nicht eingerichtet.");
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const key = keyBytes(info.publicKey);
      let sub = await registration.pushManager.getSubscription();
      if (sub && !sameKey(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await postJson("/api/push", { action: "subscribe", value: sub.toJSON() });
      setEndpoint(sub.endpoint);
      setKeyMismatch(false);
      await load();
      setMessage({
        tone: "ok",
        text: "Dieses Gerät ist eingetragen. Schick dir eine Testnachricht, um zu sehen, ob Pushs wirklich ankommen.",
      });
    } catch (e) {
      setMessage({
        tone: "error",
        text:
          e instanceof ApiError
            ? e.message
            : `Die Einrichtung hat nicht geklappt: ${(e as Error).message || "unbekannter Fehler"}. Es wurde nichts eingetragen.`,
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(device: Device) {
    setBusy(device.endpoint);
    setMessage(null);
    try {
      await postJson("/api/push", { action: "unsubscribe", value: { endpoint: device.endpoint } });
      if (device.endpoint === endpoint) {
        const sub = await currentSubscription().catch(() => null);
        await sub?.unsubscribe().catch(() => false);
        setEndpoint(null);
      }
      await load();
      setMessage({ tone: "ok", text: `${device.label} bekommt keine Pushs mehr.` });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMessage(null);
    try {
      const result = await postJson<{ ok: boolean; claimed?: number; sent?: number }>("/api/push", {
        action: "test",
      });
      setMessage(
        (result.sent ?? 0) > 0
          ? {
              tone: "ok",
              text: "Die Testnachricht wurde an den Push-Dienst deiner Geräte übergeben. Sie sollte in wenigen Sekunden erscheinen. Falls nicht: Fokus- oder Nicht-stören-Modus und die Mitteilungseinstellungen prüfen.",
            }
          : {
              tone: "warn",
              text: "Es wurde keine Nachricht zugestellt. Mögliche Gründe: Auf keinem Gerät ist Push aktiv, ein Gerät hat sein Abo verworfen oder der Versand ist auf dem Server noch nicht vollständig eingerichtet.",
            },
      );
      await load();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function savePrefs(change: Partial<Prefs>, done: string) {
    if (!info) return;
    const next = { ...info.prefs, ...change };
    setBusy("prefs");
    setMessage(null);
    try {
      const prefs = await postJson<Prefs>("/api/push", {
        action: "prefs",
        value: {
          reminders: next.reminders,
          quietStart: next.quietStart,
          quietEnd: next.quietEnd,
          ...(info.admin ? { teamAlerts: next.teamAlerts, teamEmail: next.teamEmail } : {}),
        },
      });
      setInfo({ ...info, prefs });
      setMessage({ tone: "ok", text: done });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  // ---- Darstellung --------------------------------------------------------

  const deviceState = (() => {
    if (env.kind === "unknown") return null;
    if (env.kind === "ios-browser")
      return {
        tone: "info",
        title: "Auf dem iPhone oder iPad: erst zum Home-Bildschirm",
        text: "Pushs gibt es dort nur für Web-Apps auf dem Home-Bildschirm, ab iOS 16.4.",
      };
    if (env.kind === "ios-old")
      return {
        tone: "warn",
        title: "Dieses Gerät unterstützt noch keine Web-Pushs",
        text: "Web-Pushs gibt es ab iOS 16.4. Nach einem Update kannst du sie hier einrichten.",
      };
    if (env.kind === "unsupported")
      return {
        tone: "warn",
        title: "Dieser Browser unterstützt keine Web-Pushs",
        text: "Probiere es in einem aktuellen Chrome, Edge, Firefox oder Safari.",
      };
    if (permission === "denied")
      return {
        tone: "warn",
        title: "Benachrichtigungen sind blockiert",
        text: "Erlaube Benachrichtigungen für diese Seite in den Einstellungen deines Browsers oder Geräts. Danach kannst du Push hier einrichten.",
      };
    if (permission === "granted" && keyMismatch)
      return {
        tone: "warn",
        title: "Bitte Push auf diesem Gerät neu einrichten",
        text: "Der Versandschlüssel auf dem Server hat sich geändert. Bis zur Neueinrichtung kommen auf diesem Gerät keine Pushs an.",
      };
    if (permission === "granted" && thisDevice)
      return {
        tone: "ok",
        title: "Push ist auf diesem Gerät aktiv",
        text: thisDevice.lastSuccess
          ? `Zuletzt erfolgreich zugestellt am ${dateOf(thisDevice.lastSuccess)}.`
          : "Noch keine Nachricht zugestellt. Eine Testnachricht zeigt, ob alles ankommt.",
      };
    if (permission === "granted" && endpoint)
      return {
        tone: "info",
        title: "Dieses Gerät ist noch nicht mit deinem Konto verbunden",
        text: "Der Browser hat zugestimmt, aber dein Konto kennt dieses Gerät noch nicht.",
      };
    return {
      tone: "info",
      title: "Auf diesem Gerät noch nicht eingerichtet",
      text: "Du wirst erst gefragt, wenn du auf „Push einrichten“ tippst.",
    };
  })();
  const canEnable =
    !!info &&
    env.kind === "supported" &&
    permission !== "denied" &&
    (keyMismatch || !(permission === "granted" && thisDevice));

  return (
    <section className="cm-card cm-push" aria-labelledby={`${uid}-title`}>
      <header className="cm-section-head">
        <div>
          <p className="cm-kicker">ERINNERUNGEN</p>
          <h2 id={`${uid}-title`}>Push auf deinem Gerät</h2>
        </div>
        <p className="cm-muted">
          Freiwillig. Deal Operator funktioniert auch ganz ohne Push. Mit Push erinnert dich Deal Operator auch
          bei geschlossener Website.
        </p>
      </header>

      <ul className="cm-rules">
        <li>
          <Bell size={16} aria-hidden="true" /> Um {clockText(settings.eveningReminder)}, wenn dein
          Tagesabschluss an einem Calling-Tag noch fehlt.
        </li>
        <li>
          <Bell size={16} aria-hidden="true" /> Um {clockText(settings.streakWarning)} am nächsten
          Calling-Tag, wenn dein Abschluss noch offen ist und bis {settings.deadlineHour}:00 Uhr
          noch für deine laufende Serie zählt.
        </li>
        <li>
          <BellOff size={16} aria-hidden="true" /> Nie am Wochenende, nie in deiner Ruhezeit oder
          Pause, nie nach eingereichtem Abschluss.
        </li>
      </ul>

      {loadError && (
        <p className="cm-alert error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{loadError}</span>
        </p>
      )}

      {deviceState && (
        <div className={`cm-device-state ${deviceState.tone}`}>
          <Smartphone size={20} aria-hidden="true" />
          <div>
            <strong>{deviceState.title}</strong>
            <p>{deviceState.text}</p>
          </div>
        </div>
      )}

      {env.kind === "ios-browser" && (
        <ol className="cm-ios-steps">
          <li>
            <Share size={17} aria-hidden="true" />
            <span>
              Öffne diese Seite in Safari und tippe unten auf <strong>Teilen</strong>.
            </span>
          </li>
          <li>
            <SquarePlus size={17} aria-hidden="true" />
            <span>
              Wähle <strong>„Zum Home-Bildschirm“</strong> und bestätige mit Hinzufügen.
            </span>
          </li>
          <li>
            <Smartphone size={17} aria-hidden="true" />
            <span>
              Öffne Deal Operator über das neue Symbol auf dem Home-Bildschirm, melde dich an und
              richte hier Push ein.
            </span>
          </li>
        </ol>
      )}

      <div className="cm-actions">
        {canEnable && (
          <button
            type="button"
            className="btn primary"
            disabled={busy !== null}
            onClick={() => void enable()}
          >
            {busy === "enable" ? (
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
            ) : (
              <Bell size={17} aria-hidden="true" />
            )}
            {keyMismatch
              ? "Push neu einrichten"
              : permission === "granted" && endpoint
                ? "Mit meinem Konto verbinden"
                : "Push einrichten"}
          </button>
        )}
        {info && devices.length > 0 && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy !== null}
            onClick={() => void test()}
          >
            {busy === "test" ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <Send size={16} aria-hidden="true" />
            )}
            Testnachricht senden
          </button>
        )}
      </div>

      {message && (
        <p
          className={`cm-alert ${message.tone}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.tone === "ok" ? (
            <CircleCheck size={18} aria-hidden="true" />
          ) : (
            <CircleAlert size={18} aria-hidden="true" />
          )}
          <span>{message.text}</span>
        </p>
      )}

      {info && (
        <>
          <div className="cm-pref">
            <label className="cm-switch">
              <input
                type="checkbox"
                role="switch"
                checked={info.prefs.reminders}
                disabled={busy !== null}
                onChange={(e) =>
                  void savePrefs(
                    { reminders: e.target.checked },
                    e.target.checked
                      ? "Erinnerungen sind eingeschaltet."
                      : "Erinnerungen sind ausgeschaltet. Du bekommst keine Erinnerungen mehr.",
                  )
                }
              />
              <span className="cm-switch-track" aria-hidden="true" />
              <span>
                <strong>Erinnerungen an meinen Tagesabschluss</strong>
                <small>Abends und vor der Frist, wie oben beschrieben.</small>
              </span>
            </label>
          </div>

          {quiet && (
            <form
              className="cm-pref cm-quiet"
              onSubmit={(e) => {
                e.preventDefault();
                const start = quiet.on ? toMinutes(quiet.start) : null;
                const end = quiet.on ? toMinutes(quiet.end) : null;
                if (quiet.on && (start === null || end === null)) {
                  setMessage({ tone: "error", text: "Bitte Beginn und Ende der Ruhezeit angeben." });
                  return;
                }
                void savePrefs(
                  { quietStart: start, quietEnd: end },
                  quiet.on
                    ? `Ruhezeit gespeichert: ${quiet.start} bis ${quiet.end} Uhr.`
                    : "Ruhezeit ausgeschaltet.",
                );
              }}
            >
              <label className="cm-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={quiet.on}
                  onChange={(e) => setQuiet({ ...quiet, on: e.target.checked })}
                />
                <span className="cm-switch-track" aria-hidden="true" />
                <span>
                  <strong>
                    <Moon size={15} aria-hidden="true" /> Ruhezeit
                  </strong>
                  <small>In dieser Zeit kommen keine Pushs.</small>
                </span>
              </label>
              {quiet.on && (
                <div className="cm-quiet-times">
                  <label>
                    Von
                    <input
                      type="time"
                      value={quiet.start}
                      onChange={(e) => setQuiet({ ...quiet, start: e.target.value })}
                    />
                  </label>
                  <label>
                    Bis
                    <input
                      type="time"
                      value={quiet.end}
                      onChange={(e) => setQuiet({ ...quiet, end: e.target.value })}
                    />
                  </label>
                </div>
              )}
              <button type="submit" className="btn secondary" disabled={busy !== null}>
                Ruhezeit speichern
              </button>
            </form>
          )}

          {info.admin && (
            <div className="cm-pref cm-admin-prefs">
              <p className="cm-label">Für Admins und Moderatoren</p>
              <label className="cm-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={info.prefs.teamAlerts}
                  disabled={busy !== null}
                  onChange={(e) =>
                    void savePrefs(
                      { teamAlerts: e.target.checked },
                      e.target.checked ? "Team-Pushs sind eingeschaltet." : "Team-Pushs sind ausgeschaltet.",
                    )
                  }
                />
                <span className="cm-switch-track" aria-hidden="true" />
                <span>
                  <strong>Team-Pushs</strong>
                  <small>Bei neuen Anmeldungen und Profilübernahmen, einmal je Person.</small>
                </span>
              </label>
              <label className="cm-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={info.prefs.teamEmail}
                  disabled={busy !== null}
                  onChange={(e) =>
                    void savePrefs(
                      { teamEmail: e.target.checked },
                      e.target.checked
                        ? "Die E-Mail-Absicherung ist eingeschaltet."
                        : "Die E-Mail-Absicherung ist ausgeschaltet.",
                    )
                  }
                />
                <span className="cm-switch-track" aria-hidden="true" />
                <span>
                  <strong>E-Mail-Absicherung</strong>
                  <small>
                    Zusätzlich eine kurze E-Mail an deine bestätigte Adresse
                    {info.prefs.email ? ` (${info.prefs.email})` : ""}.
                  </small>
                </span>
              </label>
            </div>
          )}

          <div className="cm-devices">
            <h3>Eingetragene Geräte</h3>
            {devices.length === 0 ? (
              <p className="cm-muted">Noch kein Gerät eingetragen.</p>
            ) : (
              <ul>
                {devices.map((d) => (
                  <li key={d.endpoint}>
                    <div>
                      <strong>
                        {d.label}
                        {d.endpoint === endpoint ? " · dieses Gerät" : ""}
                      </strong>
                      <small>
                        Seit {dateOf(d.since)}
                        {d.lastSuccess
                          ? ` · zuletzt zugestellt ${dateOf(d.lastSuccess)}`
                          : " · noch nichts zugestellt"}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busy !== null}
                      onClick={() => void remove(d)}
                      aria-label={`${d.label} entfernen`}
                    >
                      {busy === d.endpoint ? (
                        <LoaderCircle className="spin" size={15} aria-hidden="true" />
                      ) : (
                        <Trash2 size={15} aria-hidden="true" />
                      )}
                      Entfernen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
