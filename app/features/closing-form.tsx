"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  LoaderCircle,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { metricLabels } from "@/lib/kpis";
import {
  deadlineFor,
  isDueDay,
  isPaused,
  localDay,
  previousDueDay,
  summarize,
  type Closing,
  type CommitmentSettings,
  type DayStatus,
  type Pause,
} from "@/lib/commitment";
import "../commitment.css";

/*
 * Der Tagesabschluss: Zahlen und Reflexion in einem Formular.
 *
 * Alles hier spricht mit /api/closing. Ein Entwurf speichert sich automatisch
 * und bleibt privat; gezählt wird erst, was vollständig eingereicht ist. Bei
 * einer Korrektur bleibt die eingereichte Fassung gültig, bis die neue
 * vollständig eingereicht ist. Die Regeln selbst prüft der Server.
 */

// ---------------------------------------------------------------------------
// Datentypen der Schnittstelle (nur, was die Oberfläche liest)

export const COUNT_KEYS = [
  "attempts",
  "settingsBooked",
  "closingsBooked",
  "settingsHeld",
  "closingsHeld",
  "dealsWon",
] as const;
export type CountKey = (typeof COUNT_KEYS)[number];
const REQUIRED_COUNTS: CountKey[] = ["attempts", "settingsBooked", "closingsBooked"];
const OPTIONAL_COUNTS: CountKey[] = ["settingsHeld", "closingsHeld", "dealsWon"];
const COUNT_HINTS: Record<CountKey, string> = {
  attempts: "Jede Anwahl zählt, auch ohne Gespräch.",
  settingsBooked: "Neu vereinbarte Setting-Termine.",
  closingsBooked: "Neu vereinbarte Abschlussgespräche.",
  settingsHeld: "Settings, die heute stattgefunden haben.",
  closingsHeld: "Closings, die heute stattgefunden haben.",
  dealsWon: "Heute gewonnene Aufträge.",
};

export type MissingReason = "profile" | "phone" | "review" | "login";

export type ClosingRecord = {
  day: string;
  counts: Partial<Record<string, number | null>>;
  reflection: {
    energy?: number | null;
    win?: string;
    next?: string;
    help?: string;
  };
  revision: number;
  origin: "import" | "closing";
  firstSubmittedAt: string | null;
  submittedAt: string | null;
  shared: boolean;
  discord: boolean;
  callsDocumentedAt?: string | null;
};
export type ClosingDraft = {
  day: string;
  counts: Partial<Record<CountKey, number | null>>;
  reflection: {
    energy?: number | null;
    win?: string;
    next?: string;
    help?: string;
  };
  updatedAt: string;
  baseRevision?: number;
};
export type PauseEntry = {
  id: string;
  from: string;
  to: string;
  reason: string;
  status: "requested" | "approved" | "rejected";
};
export type CommitmentSummaryDTO = {
  calling: { current: number; best: number };
  reflection: { current: number; best: number };
  activeDays: number;
  closedDays: number;
  inactive: boolean;
  missingOpen: number;
  needsTeamReview: boolean;
  atRisk: { day: string; deadline: string } | null;
};
export type CalendarDay = {
  day: string;
  status: DayStatus;
  due: boolean;
  deadline: string | null;
  attempts: number | null;
};
export type ClosingState = {
  eligibility: {
    eligible: boolean;
    participant: {
      id: string;
      name: string;
      publicConsent: boolean;
      claimedAt: string | null;
      eligibleSince?: string | null;
    } | null;
    missing: ("profile" | "phone" | "review")[];
  };
  settings: CommitmentSettings;
  closings: ClosingRecord[];
  drafts: ClosingDraft[];
  summary: CommitmentSummaryDTO | null;
  calendar: {
    month: string;
    days: CalendarDay[];
    activeDays: number;
    closedDays: number;
  } | null;
  trackingStart: string | null;
  /** Frühester Tag, für den ein eigener Abschluss möglich ist. */
  firstClosableDay?: string | null;
  pauses: PauseEntry[];
};

// ---------------------------------------------------------------------------
// Gemeinsame Helfer für Tagesabschluss, Dashboard und Austausch

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await readJson(response);
  if (!response.ok)
    throw new ApiError(
      typeof data.error === "string"
        ? data.error
        : "Das hat gerade nicht geklappt. Bitte lade die Seite neu.",
      response.status,
      data,
    );
  return data as T;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  keepalive = false,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  });
  const data = await readJson(response);
  if (!response.ok)
    throw new ApiError(
      typeof data.error === "string"
        ? data.error
        : "Das hat gerade nicht geklappt. Deine Eingabe ist nicht verloren, bitte versuche es gleich noch einmal.",
      response.status,
      data,
    );
  return data as T;
}

export function fetchClosingState(month?: string, signal?: AbortSignal) {
  return getJson<ClosingState>(
    `/api/closing${month ? `?monat=${encodeURIComponent(month)}` : ""}`,
    signal,
  );
}

/** Andere Bausteine (Serien, Kalender) aktualisieren sich nach dem Einreichen. */
export const CLOSING_CHANGED = "deal-operator:closing-changed";
export function announceClosingChange() {
  window.dispatchEvent(new Event(CLOSING_CHANGED));
}

/** Aktueller Zeitpunkt. Als Funktion, damit Anzeigen ihn bewusst abfragen. */
export function currentTime() {
  return Date.now();
}
export function todayIn(timeZone = "Europe/Berlin") {
  return localDay(new Date(currentTime()), timeZone);
}

const dayFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("de-DE", { ...options, timeZone: "UTC" });
const SHORT_DAY = dayFormat({ weekday: "short", day: "2-digit", month: "2-digit" });
const LONG_DAY = dayFormat({ weekday: "long", day: "numeric", month: "long" });
const FULL_DAY = dayFormat({
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const asDate = (day: string) => new Date(`${day}T12:00:00Z`);
/** „Mo., 22.09.“ */
export const formatShortDay = (day: string) => SHORT_DAY.format(asDate(day));
/** „Montag, 22. September“ */
export const formatLongDay = (day: string) => LONG_DAY.format(asDate(day));
/** „Mo., 22.09.2026“ */
export const formatFullDay = (day: string) => FULL_DAY.format(asDate(day));
/** „Mo., 22.09., 10:00 Uhr“ in der Zeitzone der Regeln. */
export function formatMoment(iso: string, timeZone = "Europe/Berlin") {
  return `${new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso))} Uhr`;
}
export function formatClock(iso: string, timeZone = "Europe/Berlin") {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function approvedPauses(pauses: PauseEntry[]): Pause[] {
  return pauses
    .filter((p) => p.status === "approved")
    .map((p) => ({ from: p.from, to: p.to }));
}
export function commitmentClosings(rows: ClosingRecord[]): Closing[] {
  return rows
    .filter((r) => r.origin === "closing" && r.firstSubmittedAt && r.submittedAt)
    .map((r) => ({
      day: r.day,
      attempts: typeof r.counts.attempts === "number" ? r.counts.attempts : null,
      firstSubmittedAt: r.firstSubmittedAt!,
      submittedAt: r.submittedAt!,
      callsDocumentedAt: r.callsDocumentedAt ?? null,
    }));
}
/** Status eines einzelnen Tages nach denselben Regeln wie auf dem Server. */
export function statusOf(state: ClosingState, day: string): DayStatus {
  try {
    const result = summarize({
      closings: commitmentClosings(state.closings),
      pauses: approvedPauses(state.pauses),
      trackingStart: state.trackingStart,
      from: day,
      to: day,
      now: new Date(currentTime()),
      settings: state.settings,
    });
    return result.days[0]?.status ?? "free";
  } catch {
    return "free";
  }
}
export function safeDeadline(state: ClosingState, day: string): Date | null {
  try {
    if (!isDueDay(day, state.settings, approvedPauses(state.pauses))) return null;
    return deadlineFor(day, state.settings, approvedPauses(state.pauses));
  } catch {
    return null;
  }
}

export function uuid(): string {
  // randomUUID gibt es nur in sicheren Kontexten (https, localhost).
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Was noch fehlt: eine Checkliste mit Wegen statt einer Fehlermeldung

export function EligibilityChecklist({
  missing,
  next = "/tagesabschluss",
  purpose = "closing",
}: {
  missing: MissingReason[];
  next?: string;
  purpose?: "closing" | "feed";
}) {
  const needs = new Set(missing);
  const items: {
    key: string;
    done: boolean;
    title: string;
    text: string;
    links: { href: string; label: string }[];
  }[] = [
    {
      key: "login",
      done: !needs.has("login"),
      title: "Mit bestätigter E-Mail angemeldet",
      text: "Du meldest dich über einen Link in deinem Postfach an.",
      links: [
        { href: `/anmelden?next=${encodeURIComponent(next)}`, label: "Anmelden" },
      ],
    },
    needs.has("review")
      ? {
          key: "review",
          done: false,
          title: "Profilübernahme wird geprüft",
          text: "Das Team gleicht deine Angaben ab. Sobald es freigibt, geht es hier weiter.",
          links: [{ href: "/status", label: "Stand ansehen" }],
        }
      : {
          key: "profile",
          done: !needs.has("profile") && !needs.has("login"),
          title: "Eigenes persönliches Profil",
          text: "Lege ein neues Profil an oder übernimm dein Profil, wenn deine Zahlen schon auf der Seite stehen.",
          links: [
            { href: `/start?next=${encodeURIComponent(next)}`, label: "Profil anlegen" },
            { href: "/profil-uebernehmen", label: "Meine Zahlen sind schon auf der Seite" },
          ],
        },
    {
      key: "phone",
      done: !needs.has("phone") && !needs.has("login"),
      title: "Telefonnummer hinterlegt",
      text: "Mit Ländervorwahl, zum Beispiel +49 … Sie wird nicht per SMS geprüft und ist nur für das Team sichtbar.",
      links: [{ href: "/profil?modus=eigen", label: "Nummer im Profil ergänzen" }],
    },
  ];
  return (
    <div className="cm-checklist" role="region" aria-label="Voraussetzungen">
      <p className="cm-checklist-lead">
        {purpose === "feed"
          ? "Die Reflexionen lesen Mitglieder, die diese Punkte erfüllen:"
          : "Für einen eigenen Tagesabschluss fehlt noch:"}
      </p>
      <ol>
        {items.map((item) => (
          <li key={item.key} className={item.done ? "done" : ""}>
            <span className="cm-check-mark" aria-hidden="true">
              {item.done ? <Check size={15} /> : null}
            </span>
            <div>
              <strong>
                {item.title}
                <span className="cm-sr">{item.done ? " (erledigt)" : " (offen)"}</span>
              </strong>
              {!item.done && (
                <>
                  <p>{item.text}</p>
                  <div className="cm-checklist-links">
                    {item.links.map((l) => (
                      <Link key={l.href} className="cm-link" href={l.href}>
                        {l.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formularzustand

type Values = {
  counts: Record<CountKey, string>;
  energy: number | null;
  win: string;
  next: string;
  help: string;
};
type FormState = {
  day: string;
  values: Values;
  /** Revision des vorhandenen Eintrags für den Tag (0 = keiner). */
  baseRevision: number;
  discord: boolean;
  acknowledged: boolean;
  /** Vom Nutzer seit dem Laden verändert. */
  dirty: boolean;
  /** Stand eines gespeicherten Entwurfs, falls einer geladen wurde. */
  draftAt: string | null;
};
type DraftStatus =
  | { kind: "idle" }
  | { kind: "pending" | "saving"; day: string }
  | { kind: "saved"; day: string; at: string }
  | { kind: "error"; day: string; message: string };
type Confirmation = {
  day: string;
  unchanged: boolean;
  status: DayStatus;
  publicConsent: boolean;
  discord: boolean;
};
type FieldKey = CountKey | "energy" | "win" | "next" | "acknowledged";

const emptyValues = (): Values => ({
  counts: Object.fromEntries(COUNT_KEYS.map((k) => [k, ""])) as Record<CountKey, string>,
  energy: null,
  win: "",
  next: "",
  help: "",
});
const text = (v: unknown) => (typeof v === "string" ? v : "");
const energyOf = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null;
const countText = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : "";

function formFor(state: ClosingState, day: string): FormState {
  const record = state.closings.find((c) => c.day === day) ?? null;
  const draft = state.drafts.find((d) => d.day === day) ?? null;
  const values = emptyValues();
  if (record) {
    for (const k of COUNT_KEYS) values.counts[k] = countText(record.counts[k]);
    if (record.origin === "closing") {
      values.energy = energyOf(record.reflection.energy);
      values.win = text(record.reflection.win);
      values.next = text(record.reflection.next);
      values.help = text(record.reflection.help);
    }
  }
  if (draft && record?.origin !== "import") {
    for (const k of COUNT_KEYS)
      if (k in draft.counts) values.counts[k] = countText(draft.counts[k]);
    const r = draft.reflection;
    if ("energy" in r) values.energy = energyOf(r.energy);
    if ("win" in r) values.win = text(r.win);
    if ("next" in r) values.next = text(r.next);
    if ("help" in r) values.help = text(r.help);
  }
  return {
    day,
    values,
    baseRevision: record?.revision ?? 0,
    discord: record?.origin === "closing" ? record.discord : false,
    acknowledged: false,
    dirty: false,
    draftAt: draft && record?.origin !== "import" ? draft.updatedAt : null,
  };
}

function toNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= 100000 ? n : null;
}

function draftPayload(form: FormState) {
  const v = form.values;
  return {
    day: form.day,
    baseRevision: form.baseRevision,
    counts: Object.fromEntries(COUNT_KEYS.map((k) => [k, toNumber(v.counts[k])])),
    reflection: {
      energy: v.energy,
      win: v.win.slice(0, 1500),
      next: v.next.slice(0, 1500),
      help: v.help.slice(0, 1500),
    },
  };
}

function validate(form: FormState): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  const v = form.values;
  for (const k of COUNT_KEYS) {
    const raw = v.counts[k];
    if (!raw) {
      if (REQUIRED_COUNTS.includes(k))
        errors[k] = "Bitte eine Zahl eintragen. 0 ist eine gültige Angabe.";
    } else if (toNumber(raw) === null) errors[k] = "Bitte eine ganze Zahl bis 100.000 eintragen.";
  }
  if (v.energy === null) errors.energy = "Bitte wähle deine Energie von 1 bis 10.";
  if (v.win.trim().length < 3)
    errors.win = "Bitte beantworte „Was lief richtig gut?“ in ein paar Worten.";
  if (v.next.trim().length < 3)
    errors.next =
      "Bitte beantworte „Was willst du beim nächsten Calling-Tag besser machen?“ in ein paar Worten.";
  if (!form.acknowledged)
    errors.acknowledged = "Bitte bestätige, dass du gelesen hast, wer deinen Tagesabschluss sieht.";
  return errors;
}

const FIELD_ORDER: FieldKey[] = [
  ...REQUIRED_COUNTS,
  ...OPTIONAL_COUNTS,
  "energy",
  "win",
  "next",
  "acknowledged",
];

function clampDay(state: ClosingState, requested: string | undefined) {
  const today = todayIn(state.settings.timeZone);
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested) || requested > today) return today;
  if (state.firstClosableDay && requested < state.firstClosableDay) return today;
  return requested;
}

const CONFIRM_STATUS: Partial<Record<DayStatus, string>> = {
  called:
    "Fristgerecht mit Anwahlen: Der Tag zählt für deine Calling-Serie und deine Reflexions-Serie.",
  reflected:
    "Fristgerecht ohne Anwahlen: Der Tag hält deine Reflexions-Serie. Die Calling-Serie wächst nur an Tagen mit Anwahlen.",
  late: "Nach der Frist eingereicht: Deine Zahlen zählen, die Serien setzt dieser Tag nicht fort.",
  bonus:
    "Freiwilliger Abschluss an einem freien Tag: Deine Zahlen zählen, deine Serien bleiben davon unberührt.",
  "before-start":
    "Dieser Tag liegt vor deinem Start im Tagesabschluss: Er zählt nicht für Serien.",
};

// ---------------------------------------------------------------------------

export default function ClosingForm({
  day: requestedDay,
  initial,
  discordAvailable,
  syncUrl = false,
  onSubmitted,
}: {
  /** Leistungstag (YYYY-MM-DD), Standard heute. */
  day?: string;
  /** Vom Server vorgeladener Stand; ohne ihn lädt das Formular selbst. */
  initial?: ClosingState | null;
  /** Ob die Discord-Anbindung eingerichtet ist; ohne Angabe wird gefragt. */
  discordAvailable?: boolean;
  /** Den gewählten Tag in der Adresszeile mitführen (?tag=…). */
  syncUrl?: boolean;
  onSubmitted?: (day: string) => void;
}) {
  const uid = useId();
  const [state, setState] = useState<ClosingState | null>(initial ?? null);
  const [form, setForm] = useState<FormState | null>(() =>
    initial ? formFor(initial, clampDay(initial, requestedDay)) : null,
  );
  const [loadError, setLoadError] = useState("");
  const [discordReady, setDiscordReady] = useState<boolean | null>(
    discordAvailable ?? null,
  );
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Set<FieldKey>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>({ kind: "idle" });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showOptional, setShowOptional] = useState(false);

  const timer = useRef<number | null>(null);
  const pending = useRef<FormState | null>(null);
  const generation = useRef(0);
  const lastRequest = useRef<{ hash: string; key: string } | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const fresh = await fetchClosingState(undefined, signal);
    setState(fresh);
    return fresh;
  }, []);

  // Ohne vorgeladenen Stand (z. B. im Mitgliederbereich) selbst laden.
  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    fetchClosingState(undefined, controller.signal)
      .then((fresh) => {
        setState(fresh);
        setForm(formFor(fresh, clampDay(fresh, requestedDay)));
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setLoadError(e.message);
      });
    return () => controller.abort();
  }, [initial, requestedDay]);

  useEffect(() => {
    if (discordAvailable !== undefined) return;
    let alive = true;
    getJson<{ postsAvailable: boolean }>("/api/discord/connect")
      .then((d) => alive && setDiscordReady(!!d.postsAvailable))
      .catch(() => alive && setDiscordReady(false));
    return () => {
      alive = false;
    };
  }, [discordAvailable]);

  // ---- Entwurf automatisch speichern -------------------------------------

  const flushDraft = useCallback(async (keepalive = false) => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const f = pending.current;
    pending.current = null;
    if (!f) return;
    const gen = generation.current;
    if (!keepalive) setDraftStatus({ kind: "saving", day: f.day });
    try {
      const result = await postJson<{ ok: boolean; stale?: boolean }>(
        "/api/closing",
        { action: "draft", value: draftPayload(f) },
        keepalive,
      );
      if (gen !== generation.current) return;
      if (result.ok === false && result.stale) {
        setConflict(true);
        setServerError(
          "Für diesen Tag gibt es inzwischen eine neuere eingereichte Fassung, zum Beispiel aus einem anderen Fenster. Dein Entwurf wurde deshalb nicht gespeichert.",
        );
        setDraftStatus({ kind: "idle" });
        return;
      }
      setDraftStatus({ kind: "saved", day: f.day, at: new Date(currentTime()).toISOString() });
    } catch (e) {
      if (gen !== generation.current) return;
      setDraftStatus({ kind: "error", day: f.day, message: (e as Error).message });
    }
  }, []);

  // Beim Verlassen der Seite nichts verlieren.
  useEffect(() => {
    const leave = () => {
      if (pending.current) void flushDraft(true);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [flushDraft]);

  if (loadError && !state)
    return (
      <div className="cm-card cm-closing">
        <p role="alert" className="cm-alert error">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{loadError}</span>
        </p>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setLoadError("");
            load()
              .then((fresh) => setForm(formFor(fresh, clampDay(fresh, requestedDay))))
              .catch((e: Error) => setLoadError(e.message));
          }}
        >
          <RefreshCw size={16} aria-hidden="true" /> Erneut laden
        </button>
      </div>
    );
  if (!state || !form)
    return (
      <div className="cm-card cm-closing cm-loading" aria-busy="true">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        <span>Dein Tagesabschluss wird geladen …</span>
      </div>
    );

  // ---- Abgeleitete Angaben ------------------------------------------------

  const { eligibility, settings } = state;
  const tz = settings.timeZone;
  const today = todayIn(tz);
  const nowMs = currentTime();
  const pauses = approvedPauses(state.pauses);
  const canDraft = !!eligibility.participant;
  const canSubmit = eligibility.eligible;
  const record = state.closings.find((c) => c.day === form.day) ?? null;
  const submitted = record?.origin === "closing" ? record : null;
  const imported = record?.origin === "import" ? record : null;
  const status = statusOf(state, form.day);
  const due = (() => {
    try {
      return isDueDay(form.day, settings, pauses);
    } catch {
      return false;
    }
  })();
  const deadline = safeDeadline(state, form.day);
  const paused = isPaused(form.day, pauses);
  const errors = validate(form);
  const visible = (k: FieldKey) =>
    (attempted || touched.has(k)) && errors[k] ? errors[k] : "";
  const otherDrafts = state.drafts
    .filter((d) => d.day !== form.day)
    .map((d) => d.day)
    .sort()
    .reverse()
    .slice(0, 4);

  // Offener Pflicht-Tag davor (z. B. Freitag am Montagmorgen), solange die
  // Frist noch läuft. Kein Druck am Wochenende: es geht nur um die Frist.
  const openEarlier = (() => {
    try {
      const prev = previousDueDay(today, settings, pauses);
      if (!prev || prev === form.day) return null;
      if (state.trackingStart && prev < state.trackingStart) return null;
      if (state.firstClosableDay && prev < state.firstClosableDay) return null;
      if (state.closings.some((c) => c.day === prev)) return null;
      const d = deadlineFor(prev, settings, pauses);
      if (nowMs >= d.getTime()) return null;
      return {
        day: prev,
        deadline: d.toISOString(),
        risk: state.summary?.atRisk?.day === prev,
      };
    } catch {
      return null;
    }
  })();

  // ---- Aktionen -----------------------------------------------------------

  const current = form;
  function update(change: (f: FormState) => FormState, field?: FieldKey) {
    const next = { ...change(current), dirty: true };
    setForm(next);
    if (canDraft) {
      // Entprellt: gespeichert wird 1,5 s nach der letzten Änderung.
      pending.current = next;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flushDraft(), 1500);
      setDraftStatus({ kind: "pending", day: next.day });
    }
    if (field) setTouched((t) => (t.has(field) ? t : new Set(t).add(field)));
    setConfirmation(null);
  }
  const blur = (field: FieldKey) =>
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)));

  function selectDay(day: string) {
    if (!state || !day || day === form?.day) return;
    if (day > today) return;
    if (state.firstClosableDay && day < state.firstClosableDay) {
      setServerError(
        `Tage vor deinem Start im Tagesabschluss (${formatShortDay(state.firstClosableDay)}) lassen sich hier nicht abschließen. Korrekturen dafür laufen über das Team.`,
      );
      return;
    }
    if (pending.current) void flushDraft();
    generation.current++;
    setForm(formFor(state, day));
    setAttempted(false);
    setTouched(new Set());
    setServerError("");
    setConflict(false);
    setConfirmDiscard(false);
    setConfirmation(null);
    setDraftStatus({ kind: "idle" });
    lastRequest.current = null;
    if (syncUrl)
      window.history.replaceState(null, "", `/tagesabschluss?tag=${day}`);
  }

  async function reloadLatest(keepInput: boolean) {
    if (!form) return;
    setBusy(true);
    try {
      generation.current++;
      pending.current = null;
      if (timer.current) window.clearTimeout(timer.current);
      const fresh = await load();
      const latest = formFor(fresh, form.day);
      setForm(
        keepInput
          ? { ...form, baseRevision: latest.baseRevision, dirty: true, acknowledged: false }
          : latest,
      );
      setConflict(false);
      setServerError("");
      setDraftStatus({ kind: "idle" });
      lastRequest.current = null;
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (!form) return;
    setBusy(true);
    try {
      generation.current++;
      pending.current = null;
      if (timer.current) window.clearTimeout(timer.current);
      await postJson("/api/closing", { action: "discard", value: { day: form.day } });
      const fresh = await load();
      setForm(formFor(fresh, form.day));
      setAttempted(false);
      setTouched(new Set());
      setDraftStatus({ kind: "idle" });
      setConfirmDiscard(false);
      setServerError("");
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !state) return;
    setAttempted(true);
    setServerError("");
    const found = FIELD_ORDER.find((k) => errors[k]);
    if (found) {
      if (OPTIONAL_COUNTS.includes(found as CountKey)) setShowOptional(true);
      window.setTimeout(() => {
        const el = document.getElementById(`${uid}-${found}`);
        el?.focus();
      }, 0);
      return;
    }
    if (!canSubmit) return;
    // Laufendes automatisches Speichern ist ab hier überholt.
    generation.current++;
    pending.current = null;
    if (timer.current) window.clearTimeout(timer.current);
    const v = form.values;
    const value = {
      day: form.day,
      expectedRevision: form.baseRevision,
      counts: Object.fromEntries(COUNT_KEYS.map((k) => [k, toNumber(v.counts[k])])),
      reflection: {
        energy: v.energy,
        win: v.win.trim(),
        next: v.next.trim(),
        help: v.help.trim(),
      },
      discord: form.discord,
      acknowledged: true,
    };
    const hash = JSON.stringify(value);
    const key =
      lastRequest.current?.hash === hash ? lastRequest.current.key : uuid();
    lastRequest.current = { hash, key };
    setBusy(true);
    setConflict(false);
    try {
      const result = await postJson<{ ok: boolean; revision: number; unchanged?: boolean }>(
        "/api/closing",
        { action: "submit", value: { ...value, idempotencyKey: key } },
      );
      lastRequest.current = null;
      let fresh: ClosingState | null = null;
      try {
        fresh = await load();
      } catch {
        fresh = null;
      }
      const base = fresh ?? state;
      setForm(
        fresh
          ? formFor(fresh, form.day)
          : { ...form, baseRevision: result.revision, dirty: false, acknowledged: false, draftAt: null },
      );
      setConfirmation({
        day: form.day,
        unchanged: !!result.unchanged,
        status: fresh ? statusOf(fresh, form.day) : "free",
        publicConsent: !!base.eligibility.participant?.publicConsent,
        discord: form.discord,
      });
      setAttempted(false);
      setTouched(new Set());
      setDraftStatus({ kind: "idle" });
      announceClosingChange();
      onSubmitted?.(form.day);
      window.setTimeout(() => confirmRef.current?.focus(), 0);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && /neuer/i.test(err.message)) setConflict(true);
      setServerError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- Darstellung --------------------------------------------------------

  const draftLine = (() => {
    if (!canDraft) return null;
    const s = draftStatus;
    if ((s.kind === "pending" || s.kind === "saving") && s.day === form.day)
      return { tone: "", text: "Entwurf wird gespeichert …" };
    if (s.kind === "saved" && s.day === form.day)
      return {
        tone: "ok",
        text: `Entwurf gespeichert um ${formatClock(s.at, tz)} Uhr. Er ist privat und zählt erst nach dem Einreichen.`,
      };
    if (s.kind === "error" && s.day === form.day)
      return { tone: "error", text: `Entwurf nicht gespeichert: ${s.message}` };
    if (form.draftAt)
      return {
        tone: "",
        text: `Dein Entwurf vom ${formatMoment(form.draftAt, tz)} ist geladen. Er ist privat und zählt erst nach dem Einreichen.`,
      };
    return {
      tone: "",
      text: "Dein Entwurf speichert sich automatisch. Er bleibt privat und zählt erst nach dem Einreichen.",
    };
  })();

  const dayNote = (() => {
    if (imported) return null;
    if (state.trackingStart && form.day < state.trackingStart && !submitted)
      return `Dieser Tag liegt vor deinem Start im Tagesabschluss (${formatShortDay(state.trackingStart)}). Er zählt nicht für Serien.`;
    if (paused) return "Dieser Tag liegt in einer genehmigten Pause. Ein Abschluss ist freiwillig.";
    if (!due)
      return "Kein Pflicht-Tag: Am Wochenende ist ein Abschluss freiwillig. Er zählt als Bonus, deine Serien bleiben unberührt.";
    if (submitted) return null;
    if (deadline && nowMs < deadline.getTime())
      return `Pflicht-Tag. Fristgerecht bis ${formatMoment(deadline.toISOString(), tz)}.`;
    if (deadline)
      return `Die Frist für diesen Tag ist am ${formatMoment(deadline.toISOString(), tz)} abgelaufen. Deine Zahlen zählen trotzdem, für die Serien zählt der Tag nicht mehr.`;
    return null;
  })();

  const counts = (keys: CountKey[], required: boolean) =>
    keys.map((k) => {
      const id = `${uid}-${k}`;
      const error = visible(k);
      return (
        <div className={`cm-count ${error ? "invalid" : ""}`} key={k}>
          <label htmlFor={id}>
            <span>
              {metricLabels[k]}
              {required && (
                <span className="cm-required" aria-hidden="true">
                  {" "}*
                </span>
              )}
            </span>
            <small id={`${id}-hint`}>{COUNT_HINTS[k]}</small>
          </label>
          <input
            id={id}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={6}
            required={required}
            aria-required={required}
            aria-invalid={!!error}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
            placeholder={required ? "Zahl" : "leer"}
            value={form.values.counts[k]}
            disabled={!canDraft || busy}
            onBlur={() => blur(k)}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
              update(
                (f) => ({
                  ...f,
                  values: { ...f.values, counts: { ...f.values.counts, [k]: digits } },
                }),
                k,
              );
            }}
          />
          {error && (
            <p className="cm-field-error" id={`${id}-error`}>
              {error}
            </p>
          )}
        </div>
      );
    });

  const textField = (
    key: "win" | "next" | "help",
    label: string,
    hint: string,
    required: boolean,
    placeholder: string,
  ) => {
    const id = `${uid}-${key}`;
    const error = key === "help" ? "" : visible(key);
    return (
      <div className={`cm-field ${error ? "invalid" : ""}`}>
        <label htmlFor={id}>
          {label}
          {required ? (
            <span className="cm-required" aria-hidden="true">
              {" "}*
            </span>
          ) : (
            <span className="cm-optional"> (freiwillig)</span>
          )}
        </label>
        <small id={`${id}-hint`}>{hint}</small>
        <textarea
          id={id}
          rows={key === "help" ? 2 : 3}
          maxLength={1500}
          required={required}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          placeholder={placeholder}
          value={form.values[key]}
          disabled={!canDraft || busy}
          onBlur={() => key !== "help" && blur(key)}
          onChange={(e) => {
            const value = e.target.value;
            update(
              (f) => ({ ...f, values: { ...f.values, [key]: value } }),
              key === "help" ? undefined : key,
            );
          }}
        />
        {error && (
          <p className="cm-field-error" id={`${id}-error`}>
            {error}
          </p>
        )}
      </div>
    );
  };

  const energyError = visible("energy");
  const ackError = visible("acknowledged");

  return (
    <section className="cm-card cm-closing" aria-labelledby={`${uid}-title`}>
      <header className="cm-closing-head">
        <div>
          <p className="cm-kicker">TAGESABSCHLUSS</p>
          <h2 id={`${uid}-title`}>
            {form.day === today ? "Heute, " : ""}
            {formatLongDay(form.day)}
          </h2>
        </div>
        <span className={`cm-day-badge ${submitted ? "done" : due ? "due" : "free"}`}>
          {submitted ? (
            <>
              <CircleCheck size={15} aria-hidden="true" /> Eingereicht
            </>
          ) : imported ? (
            <>
              <Lock size={14} aria-hidden="true" /> Übernommen
            </>
          ) : due ? (
            status === "missed" ? "Frist vorbei" : status === "open" ? "Frist läuft" : "Pflicht-Tag"
          ) : paused ? (
            "Pause"
          ) : (
            "Freiwillig"
          )}
        </span>
      </header>

      <div className="cm-day-picker">
        <label htmlFor={`${uid}-day`}>Leistungstag</label>
        <div className="cm-day-row">
          <input
            id={`${uid}-day`}
            type="date"
            value={form.day}
            max={today}
            min={state.firstClosableDay || undefined}
            disabled={busy}
            onChange={(e) => {
              const day = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(day)) selectDay(day);
            }}
          />
          {form.day !== today && (
            <button type="button" className="btn secondary" onClick={() => selectDay(today)}>
              Heute
            </button>
          )}
        </div>
        {otherDrafts.length > 0 && (
          <p className="cm-other-drafts">
            Weitere Entwürfe:{" "}
            {otherDrafts.map((d) => (
              <button type="button" key={d} className="cm-chip" onClick={() => selectDay(d)}>
                {formatShortDay(d)}
              </button>
            ))}
          </p>
        )}
      </div>

      {openEarlier && (
        <div className={`cm-alert ${openEarlier.risk ? "warn" : "info"}`}>
          <Clock3 size={18} aria-hidden="true" />
          <div>
            <p>
              Dein Abschluss für {formatLongDay(openEarlier.day)} ist noch offen. Fristgerecht
              bis {formatMoment(openEarlier.deadline, tz)}.
              {openEarlier.risk ? " Deine laufende Serie hängt daran." : ""}
            </p>
            <button
              type="button"
              className="btn secondary"
              onClick={() => selectDay(openEarlier.day)}
            >
              {formatShortDay(openEarlier.day)} abschließen
            </button>
          </div>
        </div>
      )}

      {confirmation && confirmation.day === form.day && (
        <div className="cm-confirm" ref={confirmRef} tabIndex={-1} role="status">
          <h3>
            <CircleCheck size={20} aria-hidden="true" />
            {confirmation.unchanged
              ? "Keine Änderung nötig."
              : `Eingereicht. ${formatLongDay(confirmation.day)} zählt jetzt.`}
          </h3>
          {confirmation.unchanged ? (
            <p>Deine eingereichte Fassung war schon genau so. Es bleibt alles, wie es ist.</p>
          ) : (
            <ul>
              <li>
                {confirmation.publicConsent
                  ? "Deine Zahlen zählen im Ranking und in der Gruppensumme und sind öffentlich sichtbar, weil du der öffentlichen Anzeige zugestimmt hast."
                  : "Deine Zahlen zählen für deine Serien und stehen in deinem Bereich. Im Ranking und in der Gruppensumme erscheinen sie erst, wenn du der öffentlichen Anzeige zustimmst. Das kannst du in deinem Profil ändern."}
              </li>
              {CONFIRM_STATUS[confirmation.status] && (
                <li>{CONFIRM_STATUS[confirmation.status]}</li>
              )}
              <li>
                Deine Reflexion erscheint im Austausch unter{" "}
                <Link className="cm-link" href="/reflexionen">
                  /reflexionen
                </Link>
                {confirmation.publicConsent
                  ? " mit deinen Zahlen."
                  : ", ohne deine Zahlen."}
              </li>
              {confirmation.discord && (
                <li>
                  {discordReady
                    ? "Deine Zustimmung zum Teilen auf Discord ist gespeichert."
                    : "Deine Zustimmung zum Teilen auf Discord ist gespeichert. Die Discord-Übertragung ist noch nicht eingerichtet und wird erst genutzt, wenn sie läuft."}
                </li>
              )}
              <li>Für diesen Tag bekommst du keine Erinnerung mehr.</li>
            </ul>
          )}
          <div className="cm-actions">
            <Link className="btn primary" href="/reflexionen">
              Zum Austausch
            </Link>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setConfirmation(null)}
            >
              Diesen Tag korrigieren
            </button>
          </div>
        </div>
      )}

      {!eligibility.eligible && (
        <EligibilityChecklist
          missing={eligibility.missing}
          next={`/tagesabschluss?tag=${form.day}`}
        />
      )}

      {imported ? (
        <div className="cm-alert info">
          <Lock size={18} aria-hidden="true" />
          <div>
            <p>Für diesen Tag gilt der übernommene Stand. Korrekturen laufen über das Team.</p>
            <dl className="cm-imported">
              {COUNT_KEYS.filter((k) => typeof imported.counts[k] === "number").map((k) => (
                <div key={k}>
                  <dt>{metricLabels[k]}</dt>
                  <dd>{imported.counts[k]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : canDraft && !(confirmation && confirmation.day === form.day) ? (
        <form className="cm-form" onSubmit={submit} noValidate>
          {submitted && (
            <div className="cm-alert info">
              <ShieldCheck size={18} aria-hidden="true" />
              <p>
                Eingereicht {submitted.submittedAt ? `am ${formatMoment(submitted.submittedAt, tz)}` : ""}.
                Du kannst den Tag korrigieren. Bis du die neue Fassung vollständig einreichst,
                gilt die zuletzt eingereichte. Für die Frist zählt deine erste Einreichung.
              </p>
            </div>
          )}
          {dayNote && <p className="cm-day-note">{dayNote}</p>}

          <fieldset className="cm-group">
            <legend>
              Deine Zahlen
              <small>
                Felder mit <span className="cm-required">*</span> sind Pflicht. 0 ist eine
                gültige Angabe.
              </small>
            </legend>
            <div className="cm-counts">{counts(REQUIRED_COUNTS, true)}</div>
            <button
              type="button"
              className="cm-toggle"
              aria-expanded={showOptional}
              aria-controls={`${uid}-optional`}
              onClick={() => setShowOptional((s) => !s)}
            >
              {showOptional ? "Weitere Ergebnisse ausblenden" : "Weitere Ergebnisse eintragen (freiwillig)"}
            </button>
            <div id={`${uid}-optional`} className="cm-counts" hidden={!showOptional}>
              {counts(OPTIONAL_COUNTS, false)}
            </div>
          </fieldset>

          <fieldset className="cm-group">
            <legend>
              Deine Reflexion
              <small>Kurz und ehrlich reicht. Ein Learning ist auch ein Win.</small>
            </legend>
            <div
              className={`cm-energy ${energyError ? "invalid" : ""}`}
              role="radiogroup"
              aria-labelledby={`${uid}-energy-label`}
              aria-describedby={`${uid}-energy-hint${energyError ? ` ${uid}-energy-error` : ""}`}
              aria-required="true"
            >
              <p id={`${uid}-energy-label`} className="cm-label">
                Deine Energie heute<span className="cm-required" aria-hidden="true"> *</span>
              </p>
              <small id={`${uid}-energy-hint`}>
                Wähle bewusst: 1 heißt leer, 10 heißt voller Energie.
              </small>
              <div className="cm-energy-scale">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <label key={n} className={form.values.energy === n ? "chosen" : ""}>
                    <input
                      id={n === 1 ? `${uid}-energy` : undefined}
                      type="radio"
                      name={`${uid}-energy`}
                      value={n}
                      checked={form.values.energy === n}
                      disabled={!canDraft || busy}
                      onChange={() =>
                        update((f) => ({ ...f, values: { ...f.values, energy: n } }), "energy")
                      }
                    />
                    <span>{n}</span>
                  </label>
                ))}
              </div>
              {energyError && (
                <p className="cm-field-error" id={`${uid}-energy-error`}>
                  {energyError}
                </p>
              )}
            </div>
            {textField(
              "win",
              "Was lief richtig gut?",
              "Ein Einstieg, der funktioniert hat, ein Einwand, den du besser verstanden hast.",
              true,
              "Zum Beispiel: Der kurze Einstieg über das Projekt hat drei Gespräche geöffnet.",
            )}
            {textField(
              "next",
              "Was willst du beim nächsten Calling-Tag besser machen?",
              "Ein konkreter Schritt, den du beim nächsten Mal ausprobierst.",
              true,
              "Zum Beispiel: Früher nach dem nächsten Termin fragen.",
            )}
            {textField(
              "help",
              "Wobei wünschst du dir Unterstützung?",
              "Geht nur an das Team, nicht in den Austausch.",
              false,
              "Optional",
            )}
          </fieldset>

          <fieldset className="cm-group cm-visibility">
            <legend>Wer sieht deinen Tagesabschluss?</legend>
            <p>
              Mit dem Einreichen zählt dein Tag für deine Serien. Deine Zahlen gehen
              in Ranking und Gruppensumme ein, wenn du der öffentlichen Anzeige
              zugestimmt hast. Deine Reflexion erscheint im Austausch unter
              /reflexionen. Lesen können alle angemeldeten Mitglieder mit bestätigter
              E-Mail, hinterlegter Telefonnummer und eigenem Profil. Die Telefonnummer
              wird nicht per SMS geprüft; neue Mitglieder können sich selbst registrieren.
            </p>
            <p className="cm-muted">
              {eligibility.participant?.publicConsent
                ? "Du hast der öffentlichen Anzeige deiner Zahlen zugestimmt."
                : "Du hast der öffentlichen Anzeige deiner Zahlen nicht zugestimmt. Deine Zahlen erscheinen deshalb nicht öffentlich und nicht auf deiner Karte im Austausch."}
            </p>
            <label className={`cm-check ${ackError ? "invalid" : ""}`}>
              <input
                id={`${uid}-acknowledged`}
                type="checkbox"
                checked={form.acknowledged}
                disabled={busy}
                aria-invalid={!!ackError}
                aria-describedby={ackError ? `${uid}-ack-error` : undefined}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm((f) => (f ? { ...f, acknowledged: checked } : f));
                  blur("acknowledged");
                }}
              />
              <span>
                Ich habe gelesen, wer meinen Tagesabschluss sieht.
                <span className="cm-required" aria-hidden="true"> *</span>
              </span>
            </label>
            {ackError && (
              <p className="cm-field-error" id={`${uid}-ack-error`}>
                {ackError}
              </p>
            )}
            <label className="cm-check">
              <input
                type="checkbox"
                checked={form.discord}
                disabled={busy}
                onChange={(e) => {
                  const checked = e.target.checked;
                  // Keine Zahl und kein Text: kein Entwurf nötig.
                  setForm((f) => (f ? { ...f, discord: checked } : f));
                }}
              />
              <span>
                Zusätzlich im Discord-Channel teilen – dort liest jede Person mit, die dem
                Server beigetreten ist (Beitritt über öffentlichen Einladungslink).
                <small>
                  {discordReady === false
                    ? "Die Discord-Übertragung ist noch nicht eingerichtet; deine Zustimmung wird gespeichert und erst genutzt, wenn sie läuft."
                    : "Freiwillig. Standardmäßig bleibt dein Abschluss auf der Website."}
                </small>
              </span>
            </label>
          </fieldset>

          {draftLine && (
            <p className={`cm-draft-line ${draftLine.tone}`} aria-live="polite">
              {draftStatus.kind === "saving" || draftStatus.kind === "pending" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : draftLine.tone === "ok" ? (
                <Check size={15} aria-hidden="true" />
              ) : null}
              {draftLine.text}
            </p>
          )}

          {attempted && Object.keys(errors).length > 0 && (
            <p className="cm-alert error" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>
                Noch nicht vollständig: Bitte ergänze die markierten Felder. Erst dann zählt
                dein Tag.
              </span>
            </p>
          )}
          {serverError && (
            <p className="cm-alert error" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{serverError}</span>
            </p>
          )}
          {conflict && (
            <div className="cm-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => void reloadLatest(false)}
              >
                <RefreshCw size={16} aria-hidden="true" /> Eingereichte Fassung laden
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => void reloadLatest(true)}
              >
                Meine Eingabe behalten
              </button>
            </div>
          )}

          {!canSubmit && (
            <p className="cm-muted">
              Einreichen ist möglich, sobald die Punkte oben erledigt sind. Dein Entwurf
              bleibt bis dahin gespeichert.
            </p>
          )}

          <div className="cm-submit-row">
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !canSubmit || conflict}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              ) : (
                <Check size={17} aria-hidden="true" />
              )}
              {submitted ? "Korrektur einreichen" : "Tagesabschluss einreichen"}
            </button>
            {(form.draftAt || form.dirty) &&
              (confirmDiscard ? (
                <span className="cm-discard-confirm">
                  <span>Entwurf wirklich verwerfen?</span>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => void discardDraft()}
                  >
                    Ja, verwerfen
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setConfirmDiscard(false)}
                  >
                    Behalten
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="cm-text-button"
                  disabled={busy}
                  onClick={() => setConfirmDiscard(true)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {submitted ? "Änderungen verwerfen" : "Entwurf verwerfen"}
                </button>
              ))}
          </div>
          <p className="cm-muted cm-small">
            Zählt erst nach dem Einreichen. Ein Entwurf erscheint nirgends: nicht im
            Ranking, nicht in der Serie, nicht im Austausch.
          </p>
        </form>
      ) : null}
    </section>
  );
}
