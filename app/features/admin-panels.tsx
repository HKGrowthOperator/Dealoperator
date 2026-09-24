"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bell,
  CirclePause,
  ClipboardPaste,
  FileInput,
  Headphones,
  Inbox,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  UserSearch,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { berlinDate } from "@/lib/kpis";
import { AKQUISE_DAY, eventLabel, formatDay } from "@/lib/ranking-history";
import type { RankingEvent } from "@/lib/ranking-history";
import ImportConsole from "./import-console";
import ReviewQueue from "./review-queue";
import {
  Badge,
  DELIVERY_TONE,
  Feedback,
  ProfilePicker,
  adminPost,
  formatDateTime,
  type AdminOverview,
  type AdminPause,
  type InboxItem,
  type Participant,
  type Tone,
  type Unconfirmed,
} from "./admin-shared";
import { ReviewCases, WinsImport } from "./admin-wins";
import { RulesPanel } from "./admin-rules";
import { DiscordPanel, NotificationsPanel } from "./admin-status";
import { TeamPanel } from "./admin-team";
import ResendConfirmation from "./resend-confirmation";

// Drei Gruppen: was heute zu entscheiden ist, Zahlen einspielen, Einstellungen.
const GROUPS = [
  { id: "heute", label: "Heute" },
  { id: "import", label: "Import" },
  { id: "einstellungen", label: "Einstellungen" },
] as const;

// adminOnly: Einstellungen, Diagnose, Kontaktliste und Rollen. Moderatoren
// sehen diese Reiter nicht; der Server lehnt die Aktionen zusätzlich ab.
const TABS = [
  { id: "inbox", group: "heute", label: "Team-Inbox", icon: Inbox, adminOnly: false },
  { id: "uebernahmen", group: "heute", label: "Übernahmen", icon: ShieldCheck, adminOnly: false },
  { id: "faelle", group: "heute", label: "Prüffälle", icon: UserSearch, adminOnly: false },
  { id: "pausen", group: "heute", label: "Pausen", icon: CirclePause, adminOnly: false },
  { id: "wins", group: "import", label: "Wins-Import", icon: ClipboardPaste, adminOnly: false },
  { id: "csv", group: "import", label: "CSV-Import", icon: FileInput, adminOnly: true },
  { id: "events", group: "einstellungen", label: "Akquise Days", icon: Sparkles, adminOnly: true },
  { id: "regeln", group: "einstellungen", label: "Dranbleiben-Regeln", icon: SlidersHorizontal, adminOnly: true },
  { id: "benachrichtigungen", group: "einstellungen", label: "Benachrichtigungen", icon: Bell, adminOnly: true },
  { id: "discord", group: "einstellungen", label: "Discord", icon: Headphones, adminOnly: true },
  { id: "team", group: "einstellungen", label: "Team & Rollen", icon: UsersRound, adminOnly: true },
] as const;
type TabId = (typeof TABS)[number]["id"];
const isTab = (value: string | null): value is TabId =>
  TABS.some((tab) => tab.id === value);

type Loaded = {
  overview: AdminOverview | null;
  participants: Participant[];
  error: string;
  status: number;
};

async function fetchOverview(signal?: AbortSignal): Promise<Loaded> {
  const [adminResponse, operatorResponse] = await Promise.all([
    fetch("/api/admin", { cache: "no-store", signal }),
    fetch("/api/operator", { cache: "no-store", signal }),
  ]);
  const admin = await adminResponse.json().catch(() => ({}));
  const operator = await operatorResponse.json().catch(() => ({}));
  if (!adminResponse.ok)
    return {
      overview: null,
      participants: [],
      error: admin?.error || "Die Verwaltung ist gerade nicht erreichbar.",
      status: adminResponse.status,
    };
  return {
    overview: admin as AdminOverview,
    participants: Array.isArray(operator?.participants)
      ? (operator.participants as Participant[])
      : [],
    // Ohne Profilliste funktionieren Zuordnungen nicht; das sagen wir offen.
    error: operatorResponse.ok
      ? ""
      : `Profilliste nicht geladen: ${operator?.error || "unbekannter Fehler"}`,
    status: 200,
  };
}

/**
 * Verwaltung in Reitern. Übernahmeprüfung (ReviewQueue) und CSV-Import
 * (ImportConsole) bleiben unverändert und stehen in eigenen Reitern.
 */
export default function AdminPanels({ role }: { role: "admin" | "moderator" }) {
  const params = useSearchParams();
  const requested = params.get("bereich");
  // Aus einem Team-Push: genau diesen Eintrag bzw. diese Anfrage zeigen.
  const focusEntry = Number(params.get("eintrag")) || 0;
  const focusRequest = params.get("anfrage") || "";
  const tabs = TABS.filter((t) => role === "admin" || !t.adminOnly);
  const tab: TabId =
    isTab(requested) && tabs.some((t) => t.id === requested) ? requested : "inbox";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      setLoaded(await fetchOverview());
    } catch (e) {
      setLoaded((current) => ({
        overview: current?.overview ?? null,
        participants: current?.participants ?? [],
        error: (e as Error).message,
        status: 0,
      }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchOverview(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setLoaded(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setLoaded({
            overview: null,
            participants: [],
            error: (e as Error).message,
            status: 0,
          });
      });
    return () => controller.abort();
  }, []);

  function go(next: TabId) {
    const search = new URLSearchParams(window.location.search);
    search.set("bereich", next);
    window.history.replaceState(null, "", `?${search}`);
  }

  const overview = loaded?.overview ?? null;
  const counts: Partial<Record<TabId, number>> = overview
    ? {
        inbox: overview.inbox.filter((i) => !i.resolved).length,
        faelle: overview.cases.filter((c) => c.status === "open").length,
        pausen: overview.pauses.filter((p) => p.status === "requested").length,
      }
    : {};
  const active = tabs.find((t) => t.id === tab)!;

  return (
    <div className="adm">
      <div className="adm-top">
        <div className="adm-title-row">
          <h1>
            Verwaltung{" "}
            <span className="do-role-badge">
              {role === "admin" ? "Du bist Admin" : "Du bist Moderator"}
            </span>
          </h1>
          <button
            className="adm-refresh"
            onClick={() => void reload()}
            disabled={refreshing}
            aria-label="Verwaltung neu laden"
          >
            <RefreshCw size={17} className={refreshing ? "spin" : ""} />
            <span>Neu laden</span>
          </button>
        </div>
        <p>
          Unter Heute steht, was auf eine Entscheidung wartet. Kontaktdaten
          erscheinen nur hier im Team-Bereich.
        </p>
        <nav className="adm-tabs" aria-label="Bereiche der Verwaltung">
          {GROUPS.map((g) => {
            const items = tabs.filter((t) => t.group === g.id);
            if (!items.length) return null;
            return (
              <div
                className="adm-tab-group"
                key={g.id}
                role="group"
                aria-labelledby={`adm-group-${g.id}`}
              >
                <span className="adm-tab-group-label" id={`adm-group-${g.id}`}>
                  {g.label}
                </span>
                <div className="adm-tab-row">
                  {items.map((t) => {
                    const Icon = t.icon;
                    const count = counts[t.id];
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-current={tab === t.id ? "page" : undefined}
                        onClick={() => go(t.id)}
                      >
                        <Icon size={16} aria-hidden="true" />
                        <span>{t.label}</span>
                        {count ? (
                          <span className="adm-count">
                            {count}
                            <span className="sr-only"> offen</span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <label className="adm-tab-select">
          <span>Bereich</span>
          <select value={tab} onChange={(e) => go(e.target.value as TabId)}>
            {GROUPS.map((g) => {
              const items = tabs.filter((t) => t.group === g.id);
              if (!items.length) return null;
              return (
                <optgroup key={g.id} label={g.label}>
                  {items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                      {counts[t.id] ? ` (${counts[t.id]} offen)` : ""}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
      </div>
      {tab === "csv" ? (
        <ImportConsole admin signedIn />
      ) : (
        <main className="adm-main" aria-label={active.label}>
          {tab === "uebernahmen" ? (
            <ReviewQueue admin focus={focusRequest} />
          ) : !loaded ? (
            <div className="adm-card adm-loading" role="status">
              <RefreshCw size={20} className="spin" />
              Die Verwaltung wird geladen …
            </div>
          ) : !overview ? (
            <div className="adm-card" role="alert">
              <h2>Die Verwaltung ist gerade nicht abrufbar.</h2>
              <Feedback error={loaded.error} />
              <div className="adm-actions">
                <button className="btn primary" onClick={() => void reload()}>
                  Erneut laden
                </button>
              </div>
            </div>
          ) : (
            <>
              {loaded.error && <Feedback error={loaded.error} />}
              <PushDeviceHint />
              {tab === "inbox" && (
                <InboxPanel
                  focus={focusEntry}
                  items={overview.inbox}
                  unconfirmed={overview.unconfirmed}
                  onChanged={reload}
                  onGo={go}
                />
              )}
              {tab === "wins" && <WinsImport onCommitted={reload} />}
              {tab === "faelle" && (
                <ReviewCases
                  cases={overview.cases}
                  participants={loaded.participants}
                  onChanged={reload}
                  onImport={() => go("wins")}
                />
              )}
              {tab === "pausen" && (
                <PausesPanel
                  pauses={overview.pauses}
                  participants={loaded.participants}
                  onChanged={reload}
                />
              )}
              {tab === "events" && (
                <EventsPanel events={overview.events} onChanged={reload} />
              )}
              {tab === "regeln" && overview.rules && (
                <RulesPanel rules={overview.rules} onSaved={reload} />
              )}
              {tab === "benachrichtigungen" && overview.notifications && (
                <NotificationsPanel status={overview.notifications} />
              )}
              {tab === "discord" && overview.discord && (
                <DiscordPanel status={overview.discord} />
              )}
              {tab === "team" && overview.team && (
                <TeamPanel
                  team={overview.team}
                  participants={loaded.participants}
                  onChanged={reload}
                />
              )}
            </>
          )}
        </main>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team-Inbox

const KIND: Record<string, string> = {
  registration: "Registrierung",
  help: "Unterstützung",
  pause: "Pause",
  review: "Teamprüfung",
};
function stateInfo(item: InboxItem): {
  label: string;
  tone: Tone;
  hint?: string;
} {
  if (item.kind === "registration") {
    if (item.state === "unconfirmed")
      return {
        label: "Unbestätigt",
        tone: "muted",
        hint: "E-Mail noch nicht bestätigt. Es gibt noch nichts zu prüfen.",
      };
    if (item.state === "review_ready")
      return {
        label: "Prüfbereit",
        tone: "action",
        hint: "E-Mail bestätigt. Die Profilübernahme wartet auf eure Prüfung im Reiter Übernahmen.",
      };
    if (item.state === "confirmed")
      return {
        label: "Bestätigt",
        tone: "ok",
        hint: "E-Mail bestätigt, ein neues Mitglied. Nur zur Information, nichts zu tun.",
      };
  }
  if (item.kind === "pause") {
    if (item.state === "requested")
      return { label: "Gemeldet", tone: "action" };
    if (item.state === "approved") return { label: "Bestätigt", tone: "ok" };
    if (item.state === "rejected") return { label: "Abgelehnt", tone: "muted" };
  }
  if (item.kind === "help")
    return {
      label: "Wunsch",
      tone: "action",
      hint: "Ein Mitglied wünscht sich Unterstützung. Bitte persönlich melden, zum Beispiel über Discord oder den bekannten Kontakt.",
    };
  if (item.kind === "review")
    return {
      label: "Nachfragen",
      tone: "warn",
      hint: "Kein automatischer Ausschluss. Bitte persönlich nachfragen oder eine Pause eintragen.",
    };
  return { label: item.state || "Offen", tone: "neutral" };
}

/**
 * Ältere Prüfhinweise tragen den Hinweis zum Ausschluss noch im Text und ein
 * ISO-Datum; beides steht jetzt einheitlich darunter bzw. deutsch formatiert.
 */
function inboxBody(item: InboxItem) {
  if (item.kind !== "review") return item.body;
  return item.body
    .replace(/\s*Kein automatischer Ausschluss[\s\S]*$/, "")
    .replace(/offene fehlende/, "fehlende")
    .replace(
      /seit (\d{4}-\d{2}-\d{2})/,
      (_, day: string) => `seit dem ${formatDay(day)}`,
    );
}

/**
 * Team-Hinweise kommen als Push nur auf Geräte, die dieses Konto selbst
 * eingerichtet hat. Fehlt das Handy, merkt man es erst, wenn eine Übernahme
 * wartet; deshalb steht es hier.
 */
function PushDeviceHint() {
  const [devices, setDevices] = useState<{ label: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/push", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { prefs?: { devices?: { label: string }[] } } | null) => {
        if (alive) setDevices(d?.prefs?.devices ?? []);
      })
      .catch(() => alive && setDevices([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!devices || devices.some((d) => /iPhone|Android/.test(d.label))) return null;
  return (
    <p className="adm-push-hint">
      <Smartphone size={18} aria-hidden="true" />
      <span>
        {devices.length === 0
          ? "Dieses Konto hat kein Gerät für Push-Hinweise. Neue Übernahmen und Registrierungen kommen dann nur per E-Mail."
          : `Push-Hinweise gehen bisher nur an: ${devices.map((d) => d.label).join(", ")}. Am Handy kommt nichts an.`}{" "}
        Für das Handy: dort anmelden, Deal Operator als App hinzufügen und unter{" "}
        <Link href="/profil?modus=eigen#erinnerungen">Benachrichtigungen</Link> einschalten.
      </span>
    </p>
  );
}

function InboxPanel({
  focus,
  items,
  unconfirmed,
  onChanged,
  onGo,
}: {
  /** Inbox-Eintrag aus dem Push-Link (?eintrag=), wird angesprungen. */
  focus: number;
  items: InboxItem[];
  unconfirmed?: Unconfirmed;
  onChanged: () => Promise<void>;
  onGo: (tab: TabId) => void;
}) {
  const [kind, setKind] = useState<string>("alle");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const matching = items.filter((i) => kind === "alle" || i.kind === kind);
  const open = matching.filter((i) => !i.resolved);
  const done = matching.filter((i) => i.resolved);
  const kinds = ["registration", "help", "pause", "review"].filter((k) =>
    items.some((i) => i.kind === k),
  );
  const focused = items.find((i) => i.id === focus);
  // Einmal zum Eintrag aus dem Push springen, auch wenn er schon erledigt ist.
  const jumped = useRef(false);
  useEffect(() => {
    if (!focused || jumped.current) return;
    jumped.current = true;
    const el = document.getElementById(`inbox-${focused.id}`);
    if (!el) return;
    const details = el.closest("details");
    if (details) details.open = true;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }, [focused]);

  async function toggle(item: InboxItem) {
    setBusy(item.id);
    setError("");
    try {
      await adminPost("resolveInbox", {
        id: item.id,
        reopen: item.resolved,
      });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const card = (item: InboxItem) => {
    const s = stateInfo(item);
    return (
      <li
        key={item.id}
        id={`inbox-${item.id}`}
        className="adm-item"
        data-resolved={item.resolved}
        data-focus={item.id === focus ? "" : undefined}
        tabIndex={item.id === focus ? -1 : undefined}
      >
        <div className="adm-item-head">
          <Badge tone="neutral">{KIND[item.kind] ?? item.kind}</Badge>
          <Badge tone={s.tone}>{s.label}</Badge>
          <span className="adm-meta">
            {formatDateTime(item.updatedAt)}
            {item.updatedAt !== item.createdAt
              ? ` · angelegt ${formatDateTime(item.createdAt)}`
              : ""}
          </span>
        </div>
        <h3>{item.title}</h3>
        {item.body && <p className="adm-body">{inboxBody(item)}</p>}
        {s.hint && <p className="adm-hint">{s.hint}</p>}
        {item.delivery && item.delivery.length > 0 && (
          <div className="adm-item-head" aria-label="Zustellung der Team-Hinweise">
            <span className="adm-meta">Team-Hinweis:</span>
            {item.delivery.map((d) => (
              <Badge key={`${d.channel}-${d.state}`} tone={DELIVERY_TONE[d.state]}>
                {d.channel === "email" ? "E-Mail" : "Push"} {d.count}× {d.label}
              </Badge>
            ))}
          </div>
        )}
        <div className="adm-actions">
          {item.kind === "registration" &&
            item.state === "review_ready" &&
            !item.resolved && (
              <button
                className="btn primary"
                onClick={() => onGo("uebernahmen")}
              >
                Zur Prüfung
              </button>
            )}
          {item.kind === "pause" &&
            item.state === "requested" &&
            !item.resolved && (
              <button className="btn primary" onClick={() => onGo("pausen")}>
                Pause entscheiden
              </button>
            )}
          {item.kind === "review" && !item.resolved && (
            <button className="btn secondary" onClick={() => onGo("pausen")}>
              Pause eintragen
            </button>
          )}
          <button
            className="btn secondary"
            disabled={busy !== null}
            onClick={() => toggle(item)}
          >
            {busy === item.id
              ? "Speichert …"
              : item.resolved
                ? "Wieder öffnen"
                : "Erledigt"}
          </button>
        </div>
      </li>
    );
  };
  return (
    <section className="adm-card" aria-labelledby="adm-inbox-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <Inbox size={19} />
        </span>
        <div>
          <h2 id="adm-inbox-title">Team-Inbox</h2>
          <p>
            Offen steht nur, was eine Entscheidung braucht: prüfbereite
            Übernahmen, Unterstützungswünsche, Pausenanträge und Teamprüfungen.
            Neue Registrierungen stehen nur zur Information unter „Erledigt“;
            dafür muss niemand klicken.
          </p>
        </div>
      </div>
      {unconfirmed && unconfirmed.count > 0 && (
        <details className="adm-waiting">
          <summary>
            <Badge tone="muted">Unbestätigt</Badge>
            <span>
              {unconfirmed.count.toLocaleString("de-DE")}{" "}
              {unconfirmed.count === 1
                ? "Registrierung wartet"
                : "Registrierungen warten"}{" "}
              auf E-Mail-Bestätigung.
            </span>
          </summary>
          {unconfirmed.recent.length > 0 && (
            <ul>
              {unconfirmed.recent.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.name}</strong>
                  <span>
                    {entry.kind === "claim"
                      ? "möchte ein vorbereitetes Profil übernehmen"
                      : "neu dabei"}{" "}
                    · seit {formatDateTime(entry.since)}
                  </span>
                  <ResendConfirmation id={entry.id} lastMailAt={entry.lastMail} onSent={onChanged} />
                </li>
              ))}
            </ul>
          )}
          <p className="adm-hint">
            Ohne bestätigte E-Mail entsteht kein Inbox-Eintrag und keine
            Meldung ans Team, weil die Adresse vertippt oder fremd sein kann.
            Kam die Mail nicht an, schickt „Mail erneut senden“ eine neue an
            dieselbe Adresse.
            Gezählt werden die letzten 14 Tage
            {unconfirmed.recent.length < unconfirmed.count
              ? `, gezeigt die neuesten ${unconfirmed.recent.length}`
              : ""}
            .
          </p>
        </details>
      )}
      {kinds.length > 1 && (
        <div className="adm-filter" role="group" aria-label="Art filtern">
          {["alle", ...kinds].map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {k === "alle" ? "Alle" : (KIND[k] ?? k)}
            </button>
          ))}
        </div>
      )}
      <Feedback error={error} />
      <h3 className="adm-subhead">Offen ({open.length})</h3>
      {open.length ? (
        <ul className="adm-list">{open.map(card)}</ul>
      ) : (
        <p className="adm-empty">Nichts offen.</p>
      )}
      {focus > 0 && !focused && (
        <p className="adm-hint" role="status">
          Der Eintrag aus der Benachrichtigung ist nicht mehr unter den letzten
          100 Einträgen.
        </p>
      )}
      {done.length > 0 && (
        <details className="adm-done">
          <summary>Erledigt ({done.length})</summary>
          <ul className="adm-list">{done.map(card)}</ul>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pausen

const PAUSE_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "Gemeldet", tone: "action" },
  approved: { label: "Bestätigt", tone: "ok" },
  rejected: { label: "Abgelehnt", tone: "muted" },
};

function PausesPanel({
  pauses,
  participants,
  onChanged,
}: {
  pauses: AdminPause[];
  participants: Participant[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [person, setPerson] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const requested = pauses.filter((p) => p.status === "requested");
  const other = pauses.filter((p) => p.status !== "requested");

  async function decide(p: AdminPause, decision: "approved" | "rejected") {
    setBusy(`${p.id}:${decision}`);
    setError("");
    setSuccess("");
    try {
      await adminPost("decidePause", { id: p.id, decision });
      setSuccess(
        `Pause von ${p.name} ${decision === "approved" ? "freigegeben" : "abgelehnt"}.`,
      );
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function add() {
    setBusy("add");
    setError("");
    setSuccess("");
    try {
      await adminPost("addPause", {
        participantId: person,
        from,
        to,
        reason: reason.trim(),
      });
      const name = participants.find((p) => p.id === person)?.name;
      setSuccess(`Pause für ${name ?? "das Profil"} eingetragen und freigegeben.`);
      setPerson("");
      setFrom("");
      setTo("");
      setReason("");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const row = (p: AdminPause, actions: boolean) => {
    const s = PAUSE_STATUS[p.status] ?? { label: p.status, tone: "neutral" };
    return (
      <li key={p.id} className="adm-item">
        <div className="adm-item-head">
          <Badge tone={s.tone}>{s.label}</Badge>
          <span className="adm-meta">
            {formatDay(p.from)} bis {formatDay(p.to)}
          </span>
        </div>
        <h3>{p.name}</h3>
        {p.reason && <p className="adm-body">{p.reason}</p>}
        {actions && (
          <div className="adm-actions">
            <button
              className="btn primary"
              disabled={busy !== ""}
              onClick={() => decide(p, "approved")}
            >
              Freigeben
            </button>
            <button
              className="btn secondary"
              disabled={busy !== ""}
              onClick={() => decide(p, "rejected")}
            >
              Ablehnen
            </button>
          </div>
        )}
      </li>
    );
  };
  return (
    <section className="adm-card" aria-labelledby="adm-pauses-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <CirclePause size={19} />
        </span>
        <div>
          <h2 id="adm-pauses-title">Pausen</h2>
          <p>
            Bestätigte Pausen zählen nicht als Calling-Tage: keine
            Erinnerung, kein Serienverlust, keine Teamprüfung. Die Frist
            verschiebt sich auf den nächsten Calling-Tag danach.
          </p>
        </div>
      </div>
      <Feedback error={error} success={success} />
      <h3 className="adm-subhead">Offene Anträge ({requested.length})</h3>
      {requested.length ? (
        <ul className="adm-list">{requested.map((p) => row(p, true))}</ul>
      ) : (
        <p className="adm-empty">Keine offenen Anträge.</p>
      )}

      <h3 className="adm-subhead">Pause direkt eintragen</h3>
      <div className="adm-form">
        <ProfilePicker
          participants={participants}
          value={person}
          onChange={setPerson}
        />
        <div className="adm-grid adm-grid-2">
          <label className="adm-field">
            <span>Von</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="adm-field">
            <span>Bis (einschließlich)</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <label className="adm-field">
          <span>Grund (optional, nur für das Team)</span>
          <input
            type="text"
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="adm-actions">
          <button
            className="btn primary"
            disabled={!person || !from || !to || to < from || busy !== ""}
            onClick={add}
          >
            {busy === "add" ? "Speichert …" : "Pause eintragen"}
          </button>
        </div>
      </div>

      {other.length > 0 && (
        <details className="adm-done">
          <summary>Entschiedene Pausen ({other.length})</summary>
          <ul className="adm-list">{other.map((p) => row(p, false))}</ul>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Akquise Days und andere gekennzeichnete Tage

const emptyEvent = (): RankingEvent => ({
  day: berlinDate(),
  title: "Akquise Day",
  partner: "",
  url: "",
  thanks: "",
});

function EventsPanel({
  events,
  onChanged,
}: {
  events: RankingEvent[];
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<RankingEvent>(emptyEvent);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const sorted = events.toSorted((a, b) => b.day.localeCompare(a.day));
  const exists = !editing && events.some((e) => e.day === form.day);

  function set(patch: Partial<RankingEvent>) {
    setForm((current) => ({ ...current, ...patch }));
    setSuccess("");
  }
  async function save() {
    setBusy("save");
    setError("");
    setSuccess("");
    try {
      await adminPost("saveEvent", {
        day: form.day,
        title: form.title.trim(),
        partner: form.partner.trim(),
        url: form.url.trim(),
        thanks: form.thanks.trim(),
      });
      setSuccess(`${eventLabel(form)} am ${formatDay(form.day)} gespeichert.`);
      setEditing(null);
      setForm(emptyEvent());
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function remove(day: string) {
    setBusy(`delete:${day}`);
    setError("");
    setSuccess("");
    try {
      await adminPost("deleteEvent", { day });
      setSuccess(`Kennzeichnung für ${formatDay(day)} entfernt.`);
      setConfirmDelete(null);
      if (editing === day) {
        setEditing(null);
        setForm(emptyEvent());
      }
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="adm-card" aria-labelledby="adm-events-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <Sparkles size={19} />
        </span>
        <div>
          <h2 id="adm-events-title">Akquise Days und Event-Tage</h2>
          <p>
            Ein Event kennzeichnet einen Tag mit Titel, Partner und Dank. Die
            Rangliste zeigt diesen Tag dann hervorgehoben. Die Zahlen des Tages
            zählen wie an jedem anderen Tag genau einmal, es gibt keine
            Zusatzwertung.
          </p>
        </div>
      </div>
      <Feedback error={error} success={success} />
      {sorted.length ? (
        <ul className="adm-list">
          {sorted.map((event) => {
            const permanent = event.day === AKQUISE_DAY;
            return (
              <li key={event.day} className="adm-item">
                <div className="adm-item-head">
                  <Badge tone="action">{formatDay(event.day)}</Badge>
                  {permanent && <Badge tone="muted">Dauerhaft</Badge>}
                </div>
                <h3>{eventLabel(event)}</h3>
                {event.thanks && <p className="adm-body">{event.thanks}</p>}
                {event.url && (
                  <p className="adm-hint">
                    <a href={event.url} target="_blank" rel="noopener noreferrer">
                      {event.url}
                    </a>
                  </p>
                )}
                <div className="adm-actions">
                  <button
                    className="btn secondary"
                    disabled={busy !== ""}
                    onClick={() => {
                      setEditing(event.day);
                      setForm({ ...event });
                      setSuccess("");
                      setError("");
                    }}
                  >
                    Bearbeiten
                  </button>
                  {permanent ? (
                    <span className="adm-hint">
                      Der Akquise Day vom 22.09.2026 bleibt dauerhaft
                      gekennzeichnet und lässt sich nicht löschen.
                    </span>
                  ) : confirmDelete === event.day ? (
                    <>
                      <button
                        className="btn primary adm-danger"
                        disabled={busy !== ""}
                        onClick={() => remove(event.day)}
                      >
                        Wirklich entfernen
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Abbrechen
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn secondary"
                      disabled={busy !== ""}
                      onClick={() => setConfirmDelete(event.day)}
                    >
                      Löschen
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="adm-empty">Noch keine gekennzeichneten Tage.</p>
      )}

      <h3 className="adm-subhead">
        {editing
          ? `Bearbeiten: ${formatDay(editing)}`
          : "Neuen Event-Tag anlegen"}
      </h3>
      <div className="adm-form">
        <div className="adm-grid adm-grid-2">
          <label className="adm-field">
            <span>Tag</span>
            <input
              type="date"
              value={form.day}
              readOnly={!!editing}
              onChange={(e) => set({ day: e.target.value })}
            />
            {exists && (
              <small>
                Für diesen Tag gibt es schon ein Event. Speichern überschreibt
                es.
              </small>
            )}
          </label>
          <label className="adm-field">
            <span>Titel</span>
            <input
              type="text"
              maxLength={80}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </label>
          <label className="adm-field">
            <span>Partner (optional)</span>
            <input
              type="text"
              maxLength={80}
              placeholder="z. B. akquise.de"
              value={form.partner}
              onChange={(e) => set({ partner: e.target.value })}
            />
          </label>
          <label className="adm-field">
            <span>Adresse des Partners (optional, https)</span>
            <input
              type="url"
              inputMode="url"
              maxLength={300}
              placeholder="https://"
              value={form.url}
              onChange={(e) => set({ url: e.target.value })}
            />
          </label>
        </div>
        <label className="adm-field">
          <span>Dank (optional, öffentlich sichtbar)</span>
          <textarea
            rows={3}
            maxLength={400}
            value={form.thanks}
            onChange={(e) => set({ thanks: e.target.value })}
          />
        </label>
        <p className="adm-hint">
          Öffentlich erscheint: „{eventLabel(form)}“ am{" "}
          {form.day ? formatDay(form.day) : "gewählten Tag"}
          {form.thanks.trim() ? ` mit dem Dank oben` : ""}, dazu das
          Tagesranking dieses Tages.
        </p>
        <div className="adm-actions">
          <button
            className="btn primary"
            disabled={
              busy !== "" || !form.day || form.title.trim().length < 3
            }
            onClick={save}
          >
            {busy === "save" ? "Speichert …" : "Event speichern"}
          </button>
          {editing && (
            <button
              className="btn secondary"
              onClick={() => {
                setEditing(null);
                setForm(emptyEvent());
              }}
            >
              Abbrechen
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
