"use client";
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  Bell,
  BellOff,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Send,
  Smartphone,
  Trash2,
} from "lucide-react";
import { defaultCommitmentSettings, type CommitmentSettings } from "@/lib/commitment";
import { ApiError, getJson, postJson } from "./closing-form";
import InstallApp from "./install-app";
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
/** Signal zwischen Hinweiskarte und Einrichtung: ein Gerät wurde eingetragen. */
const CHANGED = "do-push-changed";
function subscribeEnvironment(change: () => void) {
  document.addEventListener("visibilitychange", change);
  window.addEventListener("focus", change);
  window.addEventListener(CHANGED, change);
  return () => {
    document.removeEventListener("visibilitychange", change);
    window.removeEventListener("focus", change);
    window.removeEventListener(CHANGED, change);
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
const dateOf = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));
const clockText = (c: { hour: number; minute: number }) =>
  `${c.hour}:${String(c.minute).padStart(2, "0")} Uhr`;

/**
 * Abo für dieses Gerät anlegen (oder das bestehende mit dem aktuellen
 * Schlüssel weiterverwenden) und beim Server eintragen. Die Erlaubnis muss
 * vorher im Klick erteilt worden sein.
 */
async function registerDevice(publicKey: string) {
  if (!publicKey) throw new Error("Der Push-Versand ist auf dem Server noch nicht eingerichtet.");
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const key = keyBytes(publicKey);
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
  window.dispatchEvent(new Event(CHANGED));
  return sub.endpoint;
}

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
  const [keyMismatch, setKeyMismatch] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getJson<PushInfo>("/api/push");
      setInfo(data);
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
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // Über die Hinweiskarte oben eingetragen: Stand neu laden.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const changed = () => {
      setVersion((v) => v + 1);
      void load();
    };
    window.addEventListener(CHANGED, changed);
    return () => window.removeEventListener(CHANGED, changed);
  }, [load]);
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
  }, [env.kind, env.permission, publicKey, version]);

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
      setEndpoint(await registerDevice(info.publicKey));
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
        title: "Auf iPhone und iPad gibt es Push nur über den Home-Bildschirm",
        text: "Wie das geht, steht weiter unten. Deal Operator funktioniert auch ganz ohne Push.",
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
    <section id="erinnerungen" className="cm-card cm-push" aria-labelledby={`${uid}-title`}>
      <header className="cm-section-head">
        <div>
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
          <BellOff size={16} aria-hidden="true" /> Nie an freien Tagen, nie in einer bestätigten
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
                <small>
                  {devices.length
                    ? "Abends und vor der Frist, wie oben beschrieben."
                    : "Gilt, sobald ein Gerät eingetragen ist."}
                </small>
              </span>
            </label>
          </div>

          <InstallApp />

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
                  <small>
                    Bei neuen Registrierungen und Profilübernahmen, mit Namen, je Ereignis genau
                    einmal. Antippen öffnet den Eintrag in der Verwaltung.
                  </small>
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

const LATER = "do-push-spaeter";
const LATER_DAYS = 7;
/** Nach dem Einreichen „Nein, danke“: dann fragt diese Stelle nicht erneut. */
const DECLINED = "do-push-abgelehnt";

/**
 * Kurze Karte oben im Tagesabschluss: Erinnerungen mit einem Tipp einschalten.
 * Erscheint nur, wenn dieses Gerät Pushs kann, noch nicht eingetragen ist,
 * die Erinnerungen im Konto an sind und „Später“ nicht in den letzten sieben
 * Tagen gewählt wurde. Nur wo Push im Browser direkt geht; keine Aufforderung,
 * die Website zum Home-Bildschirm hinzuzufügen. Gefragt wird nur auf
 * ausdrücklichen Tipp.
 */
export function PushPrompt({
  settings = defaultCommitmentSettings,
  variant = "card",
}: {
  settings?: CommitmentSettings;
  /** after-submit: einmaliges Angebot in der Bestätigung nach dem Einreichen. */
  variant?: "card" | "after-submit";
}) {
  const env = useEnvironment();
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [later, setLater] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Message | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      try {
        const at = Number(localStorage.getItem(LATER) || 0);
        const declined = localStorage.getItem(DECLINED) === "1";
        if (alive) setLater(declined || Date.now() - at < LATER_DAYS * 86400_000);
      } catch {
        if (alive) setLater(false);
      }
    }, 0);
    getJson<PushInfo>("/api/push")
      .then((data) => alive && setInfo(data))
      .catch(() => undefined);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const devices = info?.prefs.devices;
  useEffect(() => {
    if (!devices || env.kind !== "supported") return;
    let alive = true;
    const check =
      env.permission === "granted"
        ? currentSubscription().then((sub) => !!sub && devices.some((d) => d.endpoint === sub.endpoint))
        : Promise.resolve(false);
    check
      .catch(() => false)
      .then((known) => alive && setRegistered(known));
    return () => {
      alive = false;
    };
  }, [devices, env.kind, env.permission]);

  async function enable() {
    if (!info) return;
    setBusy(true);
    try {
      // Noch im Tipp fragen: Safari verlangt das.
      const answer = await Notification.requestPermission();
      if (answer !== "granted") {
        setDone({
          tone: "warn",
          text:
            answer === "denied"
              ? "Benachrichtigungen sind für diese Seite blockiert. Du kannst sie in den Einstellungen deines Browsers wieder erlauben."
              : "Ohne deine Erlaubnis gibt es keine Erinnerungen. Unter Profil und Einstellungen kannst du es jederzeit erneut versuchen.",
        });
        return;
      }
      await registerDevice(info.publicKey);
      setRegistered(true);
      setDone({
        tone: "ok",
        text: `Erinnerungen sind an. Du bekommst um ${clockText(settings.eveningReminder)} einen Hinweis, wenn dein Tagesabschluss an einem Calling-Tag noch fehlt.`,
      });
    } catch (e) {
      setDone({
        tone: "error",
        text:
          e instanceof ApiError
            ? e.message
            : "Das Einschalten hat nicht geklappt. Unter Profil und Einstellungen kannst du es noch einmal versuchen.",
      });
    } finally {
      setBusy(false);
    }
  }

  function postpone() {
    try {
      if (variant === "after-submit") localStorage.setItem(DECLINED, "1");
      else localStorage.setItem(LATER, String(Date.now()));
    } catch {
      /* ohne Speicher erscheint die Karte beim nächsten Besuch wieder */
    }
    setLater(true);
  }

  if (done)
    return (
      <p className={`cm-alert ${done.tone} cm-push-prompt-done`} role="status">
        {done.tone === "ok" ? (
          <CircleCheck size={18} aria-hidden="true" />
        ) : (
          <CircleAlert size={18} aria-hidden="true" />
        )}
        <span>{done.text}</span>
      </p>
    );
  if (!info || !info.publicKey || !info.prefs.reminders || later) return null;
  // Nur wo Push direkt geht. Keine Aufforderung, die Website irgendwo hinzuzufügen.
  if (env.kind !== "supported" || env.permission === "denied" || registered !== false) return null;

  return (
    <section className={`cm-push-prompt md-push-${variant}`} aria-label="Erinnerungen">
      <span className="cm-push-prompt-icon" aria-hidden="true">
        <Bell size={20} />
      </span>
      <div>
        <strong>
          {variant === "after-submit"
            ? "Soll dich Deal Operator erinnern, wenn ein Abschluss fehlt?"
            : "Erinnerung an deinen Tagesabschluss?"}
        </strong>
        <p>
          Um {clockText(settings.eveningReminder)}, wenn dein Abschluss noch fehlt, und um{" "}
          {clockText(settings.streakWarning)} vor Fristende. Nur an Calling-Tagen.
        </p>
        {variant === "after-submit" ? (
          // In der Bestätigung bleibt „Zu den Ergebnissen“ der einzige
          // Hauptknopf; das einmalige Angebot ist ruhig und bricht um.
          <div className="cm-push-prompt-actions">
            <button
              type="button"
              className="do-button do-button-secondary"
              disabled={busy}
              onClick={() => void enable()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              ) : (
                <Bell size={17} aria-hidden="true" />
              )}
              Erinnerungen einschalten
            </button>
            <button type="button" className="do-link" onClick={postpone}>
              Nein, danke
            </button>
          </div>
        ) : (
          <div className="cm-push-prompt-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void enable()}>
              {busy ? (
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              ) : (
                <Bell size={17} aria-hidden="true" />
              )}
              Erinnerungen einschalten
            </button>
            <button type="button" className="btn secondary" onClick={postpone}>
              Später
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
