"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
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
import { aggregate, emptyCounts, metricLabels, progress, type Counts } from "@/lib/kpis";
import {
  deadlineFor,
  isDueDay,
  isPaused,
  localDay,
  previousDueDay,
  summarize,
  type Closing,
  type ImportedDay,
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
const COUNT_LABELS: Record<CountKey, string> = {
  attempts: "Anwahlen",
  settingsBooked: "Settings vereinbart",
  closingsBooked: "Closings vereinbart",
  settingsHeld: "Settings durchgeführt",
  closingsHeld: "Closings durchgeführt",
  dealsWon: "Deals gewonnen",
};
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
  /** Übernommener Tag aus den Gruppenmeldungen: der eigene Abschluss ersetzt ihn. */
  replaceable?: boolean;
  firstSubmittedAt: string | null;
  submittedAt: string | null;
  shared: boolean;
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
  streak: { current: number; best: number };
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
  /**
   * Schon einmal bestätigt, wer den Tagesabschluss sieht (serverseitig aus
   * dem ersten eigenen Abschluss). Dann entfällt der Abschnitt dazu.
   */
  visibilityConfirmed: boolean;
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

/** Andere Bausteine (Serie, Kalender) aktualisieren sich nach dem Einreichen. */
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
/** „heute 10:00 Uhr“, „morgen 10:00 Uhr“ oder „Mo. 10:00 Uhr“: kurz für die Statuszeile. */
export function formatDeadlineShort(iso: string, timeZone = "Europe/Berlin", now = Date.now()) {
  const day = localDay(new Date(iso), timeZone);
  const today = localDay(new Date(now), timeZone);
  const tomorrow = localDay(new Date(now + 86_400_000), timeZone);
  const clock = formatClock(iso, timeZone);
  if (day === today) return `heute ${clock} Uhr`;
  if (day === tomorrow) return `morgen ${clock} Uhr`;
  const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone }).format(new Date(iso));
  return `${weekday} ${clock} Uhr`;
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
/** Übernommene Tage ohne eigenen Abschluss, wie toImported() auf dem Server. */
export function commitmentImports(rows: ClosingRecord[]): ImportedDay[] {
  return rows
    .filter((r) => r.origin === "import")
    .map((r) => ({
      day: r.day,
      attempts: typeof r.counts.attempts === "number" ? r.counts.attempts : null,
    }));
}
/** Status eines einzelnen Tages nach denselben Regeln wie auf dem Server. */
export function statusOf(state: ClosingState, day: string): DayStatus {
  try {
    const result = summarize({
      closings: commitmentClosings(state.closings),
      imported: commitmentImports(state.closings),
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
  draftKept = false,
}: {
  missing: MissingReason[];
  next?: string;
  purpose?: "closing" | "feed";
  /** Ein Entwurf ist möglich und bleibt erhalten, während etwas nachgetragen wird. */
  draftKept?: boolean;
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
      text: "Mit deiner E-Mail-Adresse und deinem Passwort.",
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
          text: "Lege ein neues Profil an oder frag die Übernahme an, wenn deine Zahlen schon in der Rangliste stehen.",
          links: [
            { href: `/start?weiter=eigen&next=${encodeURIComponent(next)}`, label: "Profil anlegen" },
            { href: "/profil-uebernehmen", label: "Meine Zahlen sind schon hier" },
          ],
        },
    {
      key: "phone",
      done: !needs.has("phone") && !needs.has("login"),
      title: "Nummer",
      text: "",
      links: [
        {
          href: `/profil?modus=eigen&weiter=${encodeURIComponent(next)}#konto`,
          label: "Nummer ergänzen",
        },
      ],
    },
  ];
  return (
    <div className="cm-checklist" role="region" aria-label="Voraussetzungen">
      <p className="cm-checklist-lead">
        {purpose === "feed"
          ? "Zum Lesen der Reflexionen brauchst du:"
          : "Vor dem Einreichen fehlt noch:"}
      </p>
      {draftKept && purpose === "closing" && (
        <p className="cm-checklist-note">
          Du kannst schon ausfüllen. Dein Entwurf bleibt gespeichert, und danach geht es hier weiter.
        </p>
      )}
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
                  {item.text && <p>{item.text}</p>}
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
  /** Aktuelle Abschluss-Serie nach dem Einreichen, falls bekannt. */
  streak: number | null;
  /** Neu erreichte Leistungslevel, z. B. „Anwahlen auf Level 2“. Nur echte Sprünge. */
  levelUps: string[];
};

/** Leistungslevel aus allen eigenen Tagesständen (auch übernommenen). */
function levelsOf(state: ClosingState) {
  return progress(
    aggregate(state.closings.map((c) => ({ ...emptyCounts(), ...c.counts }) as Counts)),
  );
}
function levelUps(before: ClosingState, after: ClosingState) {
  const old = new Map(levelsOf(before).map((t) => [t.id, t.level]));
  return levelsOf(after)
    .filter((t) => t.level > (old.get(t.id) ?? 0))
    .map((t) => `${t.label} auf Level ${t.level}`);
}
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
  // Ein gesperrter übernommener Stand (z. B. Akquise Day) nimmt keinen Entwurf an.
  const locked = record?.origin === "import" && !record.replaceable;
  if (draft && !locked) {
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
    acknowledged: false,
    dirty: false,
    draftAt: draft && !locked ? draft.updatedAt : null,
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

function validate(
  form: FormState,
  needsAcknowledgement: boolean,
): Partial<Record<FieldKey, string>> {
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
  if (needsAcknowledgement && !form.acknowledged)
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
    "Rechtzeitig eingereicht: Der Tag zählt für deine Serie.",
  reflected:
    "Rechtzeitig mit Reflexion, auch mit 0 Anwahlen: Deine Serie läuft weiter.",
  late: "Später eingereicht: Deine Zahlen zählen, deine Serie setzt dieser Tag nicht fort.",
  bonus:
    "Freiwilliger Abschluss an einem freien Tag: Deine Zahlen zählen, deine Serie bleibt davon unberührt.",
  "before-start":
    "Dieser Tag liegt vor deinem Start im Tagesabschluss: Er zählt nicht für die Serie.",
};

// ---------------------------------------------------------------------------

export default function ClosingForm({
  day: requestedDay,
  initial,
  syncUrl = false,
  onSubmitted,
  afterSubmit,
}: {
  /** Leistungstag (YYYY-MM-DD), Standard heute. */
  day?: string;
  /** Vom Server vorgeladener Stand; ohne ihn lädt das Formular selbst. */
  initial?: ClosingState | null;
  /** Den gewählten Tag in der Adresszeile mitführen (?tag=…). */
  syncUrl?: boolean;
  onSubmitted?: (day: string) => void;
  /** Zusatz in der Bestätigung, z. B. das einmalige Angebot für Erinnerungen. */
  afterSubmit?: React.ReactNode;
}) {
  const uid = useId();
  const [state, setState] = useState<ClosingState | null>(initial ?? null);
  const [form, setForm] = useState<FormState | null>(() =>
    initial ? formFor(initial, clampDay(initial, requestedDay)) : null,
  );
  const [loadError, setLoadError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Set<FieldKey>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>({ kind: "idle" });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  // Die Tagesauswahl erscheint erst auf Wunsch: meistens geht es um heute.
  const [pickDay, setPickDay] = useState(false);

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
  // Gesperrt: kuratierter Import. Ersetzbar: vom Team aus den Gruppenmeldungen
  // übernommen — der eigene Abschluss gewinnt.
  const imported = record?.origin === "import" && !record.replaceable ? record : null;
  const prefilled = record?.origin === "import" && record.replaceable ? record : null;
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
  // „Wer sieht deinen Tagesabschluss?“ nur bis zur ersten Bestätigung.
  const needsAcknowledgement = !state.visibilityConfirmed;
  const errors = validate(form, needsAcknowledgement);
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
      // Ein vom Team übernommener Stand ersetzt den eigenen Abschluss nicht.
      if (state.closings.some((c) => c.day === prev && (c.origin === "closing" || !c.replaceable)))
        return null;
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
      // Nur beim ersten Mal nötig; danach kennt der Server die Bestätigung.
      ...(needsAcknowledgement ? { acknowledged: true } : {}),
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
      // Mit dem ersten Abschluss ist die Bestätigung erteilt, auch wenn das
      // Neuladen gerade nicht geklappt hat.
      if (!fresh) setState((s) => (s ? { ...s, visibilityConfirmed: true } : s));
      setForm(
        fresh
          ? formFor(fresh, form.day)
          : { ...form, baseRevision: result.revision, dirty: false, acknowledged: false, draftAt: null },
      );
      setConfirmation({
        day: form.day,
        unchanged: !!result.unchanged,
        status: fresh ? statusOf(fresh, form.day) : "free",
        streak: fresh?.summary?.streak.current ?? null,
        levelUps: fresh ? levelUps(state, fresh) : [],
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
      // Der Server kennt noch keine Bestätigung: Abschnitt wieder zeigen.
      if (err.data?.field === "acknowledged")
        setState((s) => (s ? { ...s, visibilityConfirmed: false } : s));
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
        text: `Entwurf vom ${formatMoment(form.draftAt, tz)} geladen. Er ist privat und zählt erst nach dem Einreichen.`,
      };
    return {
      tone: "",
      text: "Wird automatisch als privater Entwurf gespeichert. Zählt erst nach dem Einreichen.",
    };
  })();

  // Stand des Tages in einem Wort: eingereicht, Entwurf, unvollständig, offen.
  const incomplete = attempted && Object.keys(errors).length > 0;
  const hasDraft =
    !!form.draftAt || (draftStatus.kind === "saved" && draftStatus.day === form.day);
  const badge = submitted
    ? { tone: "done", icon: <CircleCheck size={15} aria-hidden="true" />, text: form.dirty ? "Eingereicht, Änderung offen" : "Eingereicht" }
    : imported
      ? { tone: "done", icon: <Lock size={14} aria-hidden="true" />, text: "Übernommen" }
      : incomplete
        ? { tone: "warn", icon: <CircleAlert size={15} aria-hidden="true" />, text: "Unvollständig" }
        : hasDraft
          ? { tone: "draft", icon: <Check size={15} aria-hidden="true" />, text: "Entwurf gespeichert" }
          : due
            ? {
                tone: "open",
                icon: null,
                text:
                  status === "missed"
                    ? "Nachtragen möglich"
                    : deadline && nowMs < deadline.getTime()
                      ? `Offen · bis ${formatDeadlineShort(deadline.toISOString(), tz, nowMs)}`
                      : "Noch offen",
              }
            : { tone: "free", icon: null, text: paused ? "Pause" : "Freiwillig" };

  const dayNote = (() => {
    if (imported) return null;
    if (state.trackingStart && form.day < state.trackingStart && !submitted)
      return `Dieser Tag liegt vor deinem Start im Tagesabschluss (${formatShortDay(state.trackingStart)}). Er zählt nicht für die Serie.`;
    if (paused) return "Dieser Tag liegt in einer bestätigten Pause. Ein Abschluss ist freiwillig.";
    if (!due)
      return "Kein Calling-Tag: Ein Abschluss ist freiwillig. Er zählt als Bonus, deine Serie bleibt unberührt.";
    if (submitted) return null;
    // Die laufende Frist steht schon in der Statuszeile.
    if (deadline && nowMs < deadline.getTime()) return null;
    if (deadline)
      return `Rechtzeitig war bis ${formatMoment(deadline.toISOString(), tz)}. Deine Zahlen zählen trotzdem, nur für die Serie zählt der Tag nicht mehr.`;
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
              {COUNT_LABELS[k]}
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
            placeholder={required ? "Zahl" : ""}
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
        {hint && (
          <small id={`${id}-hint`} className={key === "help" ? "cm-private" : undefined}>
            {key === "help" && <Lock size={14} aria-hidden="true" />}
            {hint}
          </small>
        )}
        <textarea
          id={id}
          rows={key === "help" ? 2 : 3}
          maxLength={1500}
          required={required}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={`${hint ? `${id}-hint` : ""}${error ? ` ${id}-error` : ""}` || undefined}
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
  const confirmed = confirmation && confirmation.day === form.day ? confirmation : null;

  return (
    <section className="cm-card cm-closing md-closing" aria-labelledby={`${uid}-title`}>
      <header className="md-head">
        <div>
          <p className="md-kicker">{form.day === today ? "Heute" : "Nachtrag"}</p>
          <h2 id={`${uid}-title`}>{formatLongDay(form.day)}</h2>
        </div>
        <span className={`md-badge md-badge-${confirmed ? "done" : badge.tone}`}>
          {confirmed ? <CircleCheck size={15} aria-hidden="true" /> : badge.icon}
          {confirmed ? "Eingereicht" : badge.text}
        </span>
      </header>

      <div className="md-day">
        {pickDay ? (
          <>
            <label htmlFor={`${uid}-day`}>Anderen Tag wählen</label>
            <div className="md-day-row">
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
                <button type="button" className="do-button do-button-secondary" onClick={() => selectDay(today)}>
                  Heute
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="md-day-links">
            <button
              type="button"
              className="do-link"
              aria-expanded={false}
              onClick={() => setPickDay(true)}
            >
              <CalendarDays size={16} aria-hidden="true" />
              Anderen Tag wählen
            </button>
            {form.day !== today && (
              <button type="button" className="do-link" onClick={() => selectDay(today)}>
                Zu heute
              </button>
            )}
          </div>
        )}
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

      {openEarlier && !confirmed && (
        <div className={`cm-alert ${openEarlier.risk ? "warn" : "info"}`}>
          <Clock3 size={18} aria-hidden="true" />
          <div>
            <p>
              Dein Abschluss für {formatLongDay(openEarlier.day)} ist noch offen. Bis{" "}
              {formatMoment(openEarlier.deadline, tz)} zählt er noch für deine Serie.
            </p>
            <button
              type="button"
              className="do-button do-button-secondary"
              onClick={() => selectDay(openEarlier.day)}
            >
              {formatShortDay(openEarlier.day)} abschließen
            </button>
          </div>
        </div>
      )}

      {confirmed && (
        <div className="md-confirm" ref={confirmRef} tabIndex={-1} role="status">
          <span className="md-confirm-mark" aria-hidden="true">
            <Check size={28} strokeWidth={3} />
          </span>
          <h3>
            {confirmed.unchanged
              ? "Keine Änderung nötig."
              : `${formatLongDay(confirmed.day)} ist eingereicht.`}
          </h3>
          {confirmed.unchanged ? (
            <p>Deine eingereichte Fassung war schon genau so.</p>
          ) : (
            <ul className="md-effects">
              {CONFIRM_STATUS[confirmed.status] && (
                <li>
                  {confirmed.streak !== null &&
                  (confirmed.status === "called" || confirmed.status === "reflected")
                    ? `${confirmed.status === "reflected" ? "Rechtzeitig mit Reflexion, auch mit 0 Anwahlen." : "Rechtzeitig eingereicht."} Deine Abschluss-Serie steht bei ${confirmed.streak} ${confirmed.streak === 1 ? "Tag" : "Tagen"}.`
                    : CONFIRM_STATUS[confirmed.status]}
                </li>
              )}
              <li>
                Deine Zahlen zählen in der Rangliste und in der gemeinsamen Summe.
              </li>
              <li>
                Deine Reflexion steht unter Reflexionen, mit deinen Zahlen.
              </li>
            </ul>
          )}
          {confirmed.levelUps.length > 0 && (
            <p className="md-level-up">
              Neues Leistungslevel: {confirmed.levelUps.join(", ")}.{" "}
              <Link href="/heute?modus=eigen">Mein Fortschritt</Link>
            </p>
          )}
          <div className="md-confirm-actions">
            <Link className="do-button do-button-primary" href="/">
              Zu den Ergebnissen
            </Link>
            <Link className="do-button do-button-secondary" href="/reflexionen">
              Reflexionen lesen
            </Link>
            <button type="button" className="do-link md-correct" onClick={() => setConfirmation(null)}>
              Diesen Tag korrigieren
            </button>
          </div>
          {afterSubmit}
        </div>
      )}

      {!eligibility.eligible && (
        <EligibilityChecklist
          missing={eligibility.missing}
          next={`/tagesabschluss?tag=${form.day}`}
          draftKept={canDraft}
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
      ) : canDraft && !confirmed ? (
        <form className="cm-form" onSubmit={submit} noValidate>
          {submitted && (
            <p className="md-info">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>
                Eingereicht{submitted.submittedAt ? ` am ${formatMoment(submitted.submittedAt, tz)}` : ""}.
                Änderungen gelten erst, wenn du sie erneut einreichst.
              </span>
            </p>
          )}
          {prefilled && (
            <p className="md-info">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>
                Das Team hat deine Zahlen für diesen Tag aus den Gruppenmeldungen übernommen. Sie
                sind vorausgefüllt; mit deinem Tagesabschluss ersetzt du sie.
              </span>
            </p>
          )}
          {dayNote && <p className="md-day-note">{dayNote}</p>}

          <fieldset className="cm-group">
            <legend>
              Deine Zahlen
              <small>0 ist eine gültige Angabe.</small>
            </legend>
            <div className="cm-counts md-counts">{counts(REQUIRED_COUNTS, true)}</div>
            <button
              type="button"
              className="cm-toggle"
              aria-expanded={showOptional}
              aria-controls={`${uid}-optional`}
              onClick={() => setShowOptional((s) => !s)}
            >
              {showOptional
                ? "Weitere Ergebnisse ausblenden"
                : "Weitere Ergebnisse eintragen (freiwillig)"}
            </button>
            <div id={`${uid}-optional`} className="cm-counts md-counts" hidden={!showOptional}>
              {counts(OPTIONAL_COUNTS, false)}
            </div>
          </fieldset>

          <fieldset className="cm-group">
            <legend>
              Deine Reflexion
              <small>Kurz und ehrlich reicht.</small>
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
              <small id={`${uid}-energy-hint`}>1 heißt leer, 10 heißt voller Energie.</small>
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
              "",
              true,
              "Zum Beispiel: Der kurze Einstieg über das Projekt hat drei Gespräche geöffnet.",
            )}
            {textField(
              "next",
              "Was willst du beim nächsten Calling-Tag besser machen?",
              "",
              true,
              "Zum Beispiel: Früher nach dem nächsten Termin fragen.",
            )}
            {textField(
              "help",
              "Wobei wünschst du dir Unterstützung?",
              "Privat: Das liest nur das Team, nicht die anderen.",
              false,
              "Optional",
            )}
          </fieldset>

          {needsAcknowledgement && (
            <fieldset className="cm-group cm-visibility">
              <legend>Wer sieht deinen Tagesabschluss?</legend>
              <ul className="md-visibility">
                <li>
                  Deine Reflexion lesen alle Angemeldeten mit eigenem Profil und Telefonnummer unter
                  Reflexionen.
                </li>
                <li>
                  Deine Zahlen zählen öffentlich in Rangliste und gemeinsamer Summe, mit deinem
                  Anzeigenamen.
                </li>
                <li>Deinen Wunsch nach Unterstützung sieht nur das Team.</li>
              </ul>
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
                  Verstanden
                  <span className="cm-required" aria-hidden="true"> *</span>
                  <small>Dieser Hinweis erscheint nur vor deinem ersten Abschluss.</small>
                </span>
              </label>
              {ackError && (
                <p className="cm-field-error" id={`${uid}-ack-error`}>
                  {ackError}
                </p>
              )}
            </fieldset>
          )}

          {incomplete && (
            <p className="cm-alert error" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>Noch nicht vollständig. Bitte ergänze die markierten Felder.</span>
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
                className="do-button do-button-secondary"
                disabled={busy}
                onClick={() => void reloadLatest(false)}
              >
                <RefreshCw size={16} aria-hidden="true" /> Eingereichte Fassung laden
              </button>
              <button
                type="button"
                className="do-button do-button-secondary"
                disabled={busy}
                onClick={() => void reloadLatest(true)}
              >
                Meine Eingabe behalten
              </button>
            </div>
          )}

          <div className="md-submit">
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
            {!canSubmit && (
              <p className="cm-muted">
                Einreichen geht, sobald oben alles erledigt ist.
              </p>
            )}
            <button
              type="submit"
              className="do-button do-button-primary md-submit-button"
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
                    className="do-button do-button-secondary"
                    disabled={busy}
                    onClick={() => void discardDraft()}
                  >
                    Ja, verwerfen
                  </button>
                  <button
                    type="button"
                    className="do-button do-button-quiet"
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
        </form>
      ) : null}
    </section>
  );
}
