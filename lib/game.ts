/**
 * Tagesrunde: Tagesmarke, volle Runde, Serie als Flamme, Bestwerte, Woche
 * und gemeinsames Wochenziel.
 *
 * Alles hier ist eine reine Funktion ohne Datenbank und ohne Uhrzeit aus der
 * Umgebung: „jetzt" und „heute" werden immer hineingereicht, wie in
 * lib/commitment.ts. Die Serie selbst kommt unverändert aus summarize(); hier
 * entsteht nur, was das Spiel daraus zeigt.
 *
 * Grundlage aller persönlichen Spielwerte ist der Spielstand eines Tages
 * (gameCounts): der Stand bis zur Frist. Nachträgliches Hochkorrigieren zählt
 * in der Rangliste, im Spiel nicht; ehrliches Herunterkorrigieren wirkt
 * sofort. Ausnahme sind die Leistungslevel (levelUps): sie rechnen wie bisher
 * mit dem aktuellen Stand aller eigenen Tage, damit sie zu den sichtbaren
 * Levels passen. Gemeinsame Meldungen (kind='joint') fließen nie in
 * persönliche Werte, Plätze oder Bestwerte.
 *
 * Alle Spieltexte stehen gesammelt in GAME_TEXT am Ende dieser Datei. Sie
 * nennen nur echte Einheiten (Anwahlen, Runden, Tage), nie eine Wertung, nie
 * Gewichte und keine Punkte-Sprache.
 */

import {
  addDays,
  deadlineFor,
  isDueDay,
  isPaused,
  isoWeekday,
  localDay,
  summarize,
  type Closing,
  type CommitmentSettings,
  type CommitmentSummary,
  type DayStatus,
  type ImportedDay,
  type Pause,
} from "./commitment";
import {
  aggregate,
  emptyCounts,
  metrics,
  participantKind,
  placed,
  progress,
  type Counts,
  type ParticipantKind,
} from "./kpis";
import { summarizeRankingMonth, type DatedRankingRow } from "./ranking-history";

// ---------------------------------------------------------------------------
// Eingaben

/** Eine eigene Zeile aus checkins. Entwürfe stehen dort nie. */
export type GameCheckin = {
  day: string;
  /** Aktueller Stand. Ältere Zeilen können unvollständig sein. */
  counts: Partial<Counts>;
  origin: "import" | "closing";
  source: string;
  /** Erste vollständige Einreichung, ISO. Bei Übernahmen leer. */
  firstSubmittedAt: string | null;
  /** Letzte Einreichung, ISO. Nur für summarize(); fehlt sie, gilt die erste. */
  submittedAt?: string | null;
  callsDocumentedAt: string | null;
  /** Zur Absicherung: Zeilen fremder Profile werden ignoriert. */
  participant?: string;
  kind?: ParticipantKind | string | null;
};
/** Eine eigene Fassung aus checkin_revisions (source='website'). */
export type GameRevision = {
  day: string;
  counts: Partial<Counts>;
  createdAt: string;
  /** Nur 'website' zählt; Fassungen aus Importen werden ignoriert. */
  source?: string;
  participant?: string;
};
export type GameInputs = {
  participantId?: string;
  /** Art des eigenen Profils; ein gemeinsamer Datensatz spielt nicht mit. */
  kind?: ParticipantKind | string | null;
  checkins: GameCheckin[];
  revisions: GameRevision[];
  /** Bestätigte eigene Pausen. */
  pauses: Pause[];
  settings: CommitmentSettings;
  /** Erster Tag eigener Erfassung (server/settings.ts trackingStart). */
  trackingStart: string | null;
  /**
   * Seit wann der Tagesabschluss freigeschaltet ist (participants.eligible_since).
   * Die Tagesmarke gilt ab diesem Tag, damit sie nach einer Übernahme sofort
   * steht; trackingStart liegt höchstens einen Tag später.
   */
  eligibleSince: string | null;
  /** Tag einer 50/50 aufgeteilten Duo-Meldung (splitOrigin(import_key)?.day). */
  splitDay: string | null;
  /** Wochenziel aus dem Profil (1 bis 5.000), sonst null. */
  goal: number | null;
  /** Persönliche Call-Tage aus dem Profil, 0 = Sonntag … 6 = Samstag. */
  days: number[];
};

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
/** Vollständige Kennzahlen; alles, was keine Zahl ist, gilt als nicht gemeldet. */
function fullCounts(counts: Partial<Counts> | null | undefined): Counts {
  const base = emptyCounts();
  for (const k of metrics) base[k] = finite(counts?.[k]);
  return base;
}
const isOwn =
  (inputs: GameInputs) =>
  (row: { participant?: string; kind?: unknown }) =>
    participantKind(row.kind) !== "joint" &&
    (!inputs.participantId || !row.participant || row.participant === inputs.participantId);
/** Nur Zeilen der eigenen Person. Ein gemeinsamer Datensatz hat keine. */
function ownRows(inputs: GameInputs) {
  if (participantKind(inputs.kind) === "joint") return [];
  return inputs.checkins.filter(isOwn(inputs));
}

// ---------------------------------------------------------------------------
// Spielstand: der Stand bis zur Frist, je Tag und Kennzahl.

type Prepared = {
  rows: Map<string, GameCheckin>;
  counts: Map<string, Counts>;
  /** Eigene Tage aufsteigend; Tage mit Anwahlen über 0 aufsteigend. */
  days: string[];
  called: string[];
  /** Pflicht-Tag je Kalendertag, einmal gerechnet. */
  due: Map<string, boolean>;
  /** Ab diesem Tag gibt es eine Marke. */
  markStart: string | null;
  marks: Map<string, GameMark | null>;
};
// Je Eingabe einmal gerechnet. Eingaben gelten als unveränderlich;
// withSubmitted() liefert dafür ein neues Objekt.
const cache = new WeakMap<GameInputs, Prepared>();

function prepare(inputs: GameInputs): Prepared {
  const hit = cache.get(inputs);
  if (hit) return hit;
  const own = isOwn(inputs);
  const rows = new Map(ownRows(inputs).map((r) => [r.day, r]));
  const revisions = new Map<string, GameRevision[]>();
  for (const r of inputs.revisions) {
    if ((r.source ?? "website") !== "website" || !own(r)) continue;
    const list = revisions.get(r.day) || [];
    list.push(r);
    revisions.set(r.day, list);
  }
  const counts = new Map(
    [...rows.values()].map((row) => [row.day, stateOfDay(row, revisions.get(row.day) || [], inputs)]),
  );
  const days = [...counts.keys()].sort();
  const called = days.filter((d) => (counts.get(d)!.attempts ?? 0) > 0);
  const result: Prepared = {
    rows,
    counts,
    days,
    called,
    due: new Map(),
    markStart: markStart(inputs),
    marks: new Map(),
  };
  cache.set(inputs, result);
  return result;
}

/**
 * Spielstand eines Tages.
 * (a) Übernommener Tag: aktueller Wert.
 * (b) Eigener Abschluss: je Kennzahl der kleinere Wert aus aktuellem Stand und
 *     der letzten eigenen Fassung bis zum Spielschluss (später von Frist und
 *     erster Einreichung). War eine Kennzahl dort null, gilt sie als nicht
 *     gemeldet. Ohne passende Fassung (Altdaten) gilt der aktuelle Stand.
 */
function stateOfDay(row: GameCheckin, revisions: GameRevision[], inputs: GameInputs): Counts {
  const current = fullCounts(row.counts);
  if (row.origin !== "closing" || !revisions.length) return current;
  const first = row.firstSubmittedAt ? Date.parse(row.firstSubmittedAt) : -Infinity;
  // Die Frist nur rechnen, wenn es eine Fassung nach der ersten Einreichung
  // gibt; sonst liegt jede Fassung ohnehin vor dem Spielschluss.
  const cutoff = revisions.some((r) => Date.parse(r.createdAt) > first)
    ? Math.max(deadlineFor(row.day, inputs.settings, inputs.pauses).getTime(), first)
    : first;
  let last: { at: number; revision: GameRevision } | null = null;
  for (const revision of revisions) {
    const at = Date.parse(revision.createdAt);
    // Bei gleichem Zeitpunkt gilt die spätere Fassung (Reihenfolge nach id).
    if (at <= cutoff && (!last || at >= last.at)) last = { at, revision };
  }
  if (!last) return current;
  const kept = fullCounts(last.revision.counts);
  const lower = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.min(a, b));
  return Object.fromEntries(metrics.map((k) => [k, lower(current[k], kept[k])])) as Counts;
}

/** Spielstand eines eigenen Tages oder null, wenn es keine Zeile gibt. */
export function gameCounts(inputs: GameInputs, day: string): Counts | null {
  return prepare(inputs).counts.get(day) ?? null;
}

/**
 * Für die Transparenzzeile unter Meine Tage: wo der Spielstand vom aktuellen
 * Wert abweicht (nach der Frist erhöht). Nur privat.
 */
export function counted(inputs: GameInputs, day: string) {
  const p = prepare(inputs);
  const row = p.rows.get(day);
  const game = p.counts.get(day);
  if (!row || !game) return [];
  const current = fullCounts(row.counts);
  return BEST_METRICS.filter((m) => game[m] !== current[m]).map((metric) => ({
    metric,
    counted: game[metric],
    current: current[metric],
  }));
}

// ---------------------------------------------------------------------------
// Tagesmarke

/** Leiter der Tagesmarke in Anwahlen. */
export const GAME_LADDER = [50, 75, 100, 125, 150, 200, 250, 300] as const;
/** Marke für neue Konten und den Wiedereinstieg. */
export const MARK_START = 50;
const BASIS_DAYS = 10;
const BASIS_WINDOW = 60;
const BASIS_MIN = 3;
const GAP_DAYS = 3;
const HISTORY_WINDOW = 60;

export type GameMark = {
  mark: number;
  /** Pflicht-Tage mit gemeldeten Anwahlen, aus denen die Marke entsteht. */
  basisDays: number;
  /** Wiedereinstieg nach einer Lücke bzw. nach einer Pause. */
  comeback: null | "gap" | "pause";
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/** Die Stufe der Leiter mit dem kleinsten Abstand; bei Gleichstand die höhere. */
export function ladderStep(value: number): number {
  let best: number = GAME_LADDER[0];
  for (const step of GAME_LADDER)
    if (Math.abs(step - value) <= Math.abs(best - value)) best = step;
  return best;
}

/** Ab diesem Tag gibt es eine Marke: Freischaltung, sonst Erfassungsbeginn. */
function markStart(inputs: GameInputs): string | null {
  if (inputs.eligibleSince)
    return localDay(new Date(inputs.eligibleSince), inputs.settings.timeZone);
  return inputs.trackingStart;
}
const hasCalls = (p: Prepared, day: string) => (p.counts.get(day)?.attempts ?? 0) > 0;
function isDue(inputs: GameInputs, p: Prepared, day: string) {
  let due = p.due.get(day);
  if (due === undefined) p.due.set(day, (due = isDueDay(day, inputs.settings, inputs.pauses)));
  return due;
}
/** Index des letzten Eintrags vor `day` in einer aufsteigenden Liste, sonst -1. */
function lastBefore(sorted: string[], day: string) {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Lücke vor einem Tag: an den letzten drei Wochentagen aus callingWeekdays
 * (Pausentage zählen mit, das Wochenende nicht) keine Anwahlen, davor aber
 * innerhalb von 60 Tagen schon einmal. Sonst ist es ein neues Konto.
 */
function gapBefore(inputs: GameInputs, p: Prepared, day: string): GameMark["comeback"] {
  const window: string[] = [];
  for (let d = addDays(day, -1), i = 0; window.length < GAP_DAYS && i < 21; i++, d = addDays(d, -1))
    if (inputs.settings.callingWeekdays.includes(isoWeekday(d))) window.push(d);
  if (window.length < GAP_DAYS || window.some((d) => hasCalls(p, d))) return null;
  // Der letzte Tag mit Anwahlen vor der Lücke, höchstens 60 Tage davor.
  const first = window[GAP_DAYS - 1];
  const earlier = p.called[lastBefore(p.called, first)];
  if (!earlier || earlier < addDays(first, -HISTORY_WINDOW)) return null;
  return window.every((d) => isPaused(d, inputs.pauses)) ? "pause" : "gap";
}
function previousCallingWeekday(inputs: GameInputs, day: string): string | null {
  for (let d = addDays(day, -1), i = 0; i < 7; i++, d = addDays(d, -1))
    if (inputs.settings.callingWeekdays.includes(isoWeekday(d))) return d;
  return null;
}
/** Wiedereinstieg am ersten Tag zurück und am Tag danach. */
function comebackFor(inputs: GameInputs, p: Prepared, day: string): GameMark["comeback"] {
  const direct = gapBefore(inputs, p, day);
  if (direct) return direct;
  const previous = previousCallingWeekday(inputs, day);
  return previous ? gapBefore(inputs, p, previous) : null;
}

/**
 * Tagesmarke eines Tages, oder null: nur an Pflicht-Tagen, ab der
 * Freischaltung, nie am aufgeteilten Duo-Tag. Basis sind die Anwahlen der
 * letzten 10 Pflicht-Tage davor mit Meldung (0 zählt, null nicht), höchstens
 * 60 Kalendertage zurück; eigene und übernommene Tage gleich. Was am Tag
 * selbst gemeldet wird, verändert seine Marke nicht.
 */
export function markFor(inputs: GameInputs, day: string): GameMark | null {
  const p = prepare(inputs);
  if (p.marks.has(day)) return p.marks.get(day)!;
  const start = p.markStart;
  const applies =
    participantKind(inputs.kind) !== "joint" &&
    !!start &&
    day >= start &&
    day !== inputs.splitDay &&
    isDue(inputs, p, day);
  let result: GameMark | null = null;
  if (applies) {
    // Nur Tage mit Zeile können etwas beitragen: rückwärts über die eigenen Tage.
    const values: number[] = [];
    const floor = addDays(day, -BASIS_WINDOW);
    for (let i = lastBefore(p.days, day); i >= 0 && p.days[i] >= floor && values.length < BASIS_DAYS; i--) {
      const d = p.days[i];
      if (d === inputs.splitDay || !isDue(inputs, p, d)) continue;
      const attempts = p.counts.get(d)!.attempts;
      if (attempts !== null) values.push(attempts);
    }
    const comeback = comebackFor(inputs, p, day);
    result = {
      mark: comeback || values.length < BASIS_MIN ? MARK_START : ladderStep(median(values)),
      basisDays: values.length,
      comeback,
    };
  }
  p.marks.set(day, result);
  return result;
}

export type GameRound = {
  mark: number;
  /** Spielstand der Anwahlen an diesem Tag. */
  attempts: number | null;
  markReached: boolean;
  /** Rechtzeitig eingereicht (called oder reflected). */
  onTime: boolean;
  /** Volle Runde: Marke erreicht und Tagesstatus called. */
  full: boolean;
  /** Übernommener Stand: kann die Marke erfüllen, aber nie eine volle Runde. */
  imported: boolean;
};

/** Die Runde eines Tages aus Marke, Spielstand und Tagesstatus (summarize). */
export function roundFor(
  inputs: GameInputs,
  day: string,
  summaryDay?: { status: DayStatus } | DayStatus | null,
): GameRound | null {
  const mark = markFor(inputs, day);
  if (!mark) return null;
  const p = prepare(inputs);
  const attempts = p.counts.get(day)?.attempts ?? null;
  const status = typeof summaryDay === "string" ? summaryDay : (summaryDay?.status ?? null);
  const markReached = attempts !== null && attempts >= mark.mark;
  return {
    mark: mark.mark,
    attempts,
    markReached,
    onTime: status === "called" || status === "reflected",
    full: markReached && status === "called",
    imported: p.rows.get(day)?.origin === "import",
  };
}

// ---------------------------------------------------------------------------
// Serie als Flamme. Die Regeln bleiben in summarize(); hier nur Darstellung.

export const ETAPPEN = [5, 10, 20, 40, 60, 100] as const;
export type Etappe = (typeof ETAPPEN)[number];
/**
 * none: 0, grau umrandet · short: 1 bis 4, blau · glow: 5 bis 19, blau mit
 * ruhendem Schein · long: ab 20, Cyan zu Blau · risk: eine Frist läuft, amber ·
 * paused: heute in bestätigter Pause, grau gefüllt. Öffentlich nur die
 * Längen-Zustände: dort kommt flameState(streak, null, false).
 */
export type FlameState = "none" | "short" | "glow" | "long" | "risk" | "paused";

export function flameState(
  streak: { current: number },
  atRisk: unknown,
  paused: boolean,
): FlameState {
  if (paused) return "paused";
  if (atRisk) return "risk";
  if (streak.current <= 0) return "none";
  if (streak.current < 5) return "short";
  return streak.current < 20 ? "glow" : "long";
}
/** Kleinste Etappe über der laufenden Serie, nach 100 keine mehr. */
export function nextEtappe(current: number): Etappe | null {
  return ETAPPEN.find((n) => n > current) ?? null;
}
/** Die höchste Etappe mit vorher < n <= nachher. */
export function etappeCrossed(before: number, after: number): Etappe | null {
  return [...ETAPPEN].reverse().find((n) => before < n && n <= after) ?? null;
}
/** Neuer Serien-Bestwert erst ab einem bisherigen Bestwert von 3; Gleichstand zählt nicht. */
export function newStreakBest(
  before: { best: number },
  after: { current: number },
): number | null {
  return before.best >= 3 && after.current > before.best ? after.current : null;
}

function toClosings(rows: GameCheckin[]): Closing[] {
  return rows
    .filter((r) => r.origin === "closing" && r.firstSubmittedAt)
    .map((r) => ({
      day: r.day,
      attempts: finite(r.counts.attempts),
      firstSubmittedAt: r.firstSubmittedAt!,
      submittedAt: r.submittedAt ?? r.firstSubmittedAt!,
      callsDocumentedAt: r.callsDocumentedAt,
    }));
}
function toImported(rows: GameCheckin[]): ImportedDay[] {
  return rows
    .filter((r) => r.origin === "import")
    .map((r) => ({ day: r.day, attempts: finite(r.counts.attempts) }));
}

/**
 * summarize() wie in closingState(): Serie, Fristen und Status bis heute.
 * `from` und `to` erweitern nur die Liste der Tage (etwa auf die Woche);
 * Serie, Bestwert und atRisk bleiben dieselben.
 */
export function gameSummary(
  inputs: GameInputs,
  now: Date,
  range: { from?: string; to?: string } = {},
): CommitmentSummary {
  const today = localDay(now, inputs.settings.timeZone);
  const rows = ownRows(inputs);
  const start = inputs.trackingStart;
  let from = start && start < today ? start : today;
  if (range.from && range.from < from) from = range.from;
  return summarize({
    closings: toClosings(rows),
    imported: toImported(rows),
    pauses: inputs.pauses,
    trackingStart: start,
    from,
    to: range.to && range.to > today ? range.to : today,
    now,
    settings: inputs.settings,
  });
}

// ---------------------------------------------------------------------------
// Bestwerte

export const BEST_METRICS = ["attempts", "settingsBooked", "closingsBooked", "dealsWon"] as const;
export type BestMetric = (typeof BEST_METRICS)[number];
/** Vorgeschichte für einen neuen Bestwert: frühere Tage, Wochen, Monate mit Meldung. */
const BEST_HISTORY = { day: 5, week: 2, month: 1 } as const;
/** Die Karte „Deine Bestwerte“ erscheint ab dem sechsten Tag mit Meldung. */
const BESTS_FROM_DAYS = 6;

/** Montag der Woche (Montag bis Sonntag nach Kalendertag). */
export function weekStartOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

type Period = "day" | "week" | "month";
/** Werte je Zeitraum; nur Zeiträume mit Meldung (0 zählt, null nicht). */
function periodValues(inputs: GameInputs, period: Period, metric: BestMetric) {
  const values = new Map<string, number>();
  for (const [day, counts] of prepare(inputs).counts) {
    const value = counts[metric];
    if (value === null) continue;
    // Der aufgeteilte Duo-Tag zählt in Wochen- und Monatssummen, nicht als Tageswert.
    if (period === "day") {
      if (day !== inputs.splitDay) values.set(day, value);
      continue;
    }
    const key = period === "week" ? weekStartOf(day) : day.slice(0, 7);
    values.set(key, (values.get(key) ?? 0) + value);
  }
  return values;
}
/** Höchster Wert über 0; bei Gleichstand hält ihn der früheste Zeitraum. */
function holder(values: Map<string, number>, skip?: string) {
  let best: { key: string; value: number } | null = null;
  for (const [key, value] of [...values].sort(([a], [b]) => a.localeCompare(b)))
    if (key !== skip && value > 0 && (!best || value > best.value)) best = { key, value };
  return best;
}
const earlierCount = (values: Map<string, number>, key: string) =>
  [...values.keys()].filter((k) => k < key).length;

export type PersonalBests = {
  day: Record<BestMetric, { value: number; day: string; eligible: boolean } | null>;
  week: { value: number; weekStart: string; eligible: boolean } | null;
  month: { value: number; month: string; eligible: boolean } | null;
  /** Tage mit Meldung in einer der vier Kennzahlen. */
  reportedDays: number;
  /** Ab dem sechsten Tag mit Meldung steht die Karte, sonst eine Textzeile. */
  show: boolean;
};

/**
 * Bestwerte aus dem Spielstand aller eigenen Tage. `eligible`: genug
 * Vorgeschichte vor dem Halter (5 Tage, 2 Wochen, 1 Monat mit Meldung).
 */
export function personalBests(inputs: GameInputs): PersonalBests {
  const best = (period: Period, metric: BestMetric) => {
    const values = periodValues(inputs, period, metric);
    const top = holder(values);
    return top ? { ...top, eligible: earlierCount(values, top.key) >= BEST_HISTORY[period] } : null;
  };
  const day = Object.fromEntries(
    BEST_METRICS.map((metric) => {
      const top = best("day", metric);
      return [metric, top ? { value: top.value, day: top.key, eligible: top.eligible } : null];
    }),
  ) as PersonalBests["day"];
  const week = best("week", "attempts");
  const month = best("month", "attempts");
  const reportedDays = [...prepare(inputs).counts.values()].filter((c) =>
    BEST_METRICS.some((m) => c[m] !== null),
  ).length;
  return {
    day,
    week: week ? { value: week.value, weekStart: week.key, eligible: week.eligible } : null,
    month: month ? { value: month.value, month: month.key, eligible: month.eligible } : null,
    reportedDays,
    show: reportedDays >= BESTS_FROM_DAYS,
  };
}

export type NewBests = {
  /** In der Reihenfolge Deals, Closings, Settings, Anwahlen. */
  day: { metric: BestMetric; value: number; previous: { value: number; day: string } | null }[];
  week: { value: number; weekStart: string; previous: number | null } | null;
  month: { value: number; month: string; previous: number | null } | null;
};

/**
 * Neue Bestwerte durch eine Einreichung für `day`. Gemeldet wird genau beim
 * Überschreiten: der Zeitraum lag vorher höchstens beim alten Höchstwert der
 * übrigen Zeiträume und liegt jetzt darüber. Eine laufende Woche feiert so
 * nur einmal. Gleicher Wert ist kein neuer Bestwert.
 */
export function newBests(before: GameInputs, after: GameInputs, day: string): NewBests {
  const crossing = (period: Period, metric: BestMetric, key: string) => {
    const old = periodValues(before, period, metric);
    const now = periodValues(after, period, metric);
    const value = now.get(key) ?? 0;
    const previous = holder(old, key);
    const top = previous?.value ?? 0;
    if (value < 1 || value <= top || (old.get(key) ?? 0) > top) return null;
    if (earlierCount(now, key) < BEST_HISTORY[period]) return null;
    return { value, previous };
  };
  const order: BestMetric[] = ["dealsWon", "closingsBooked", "settingsBooked", "attempts"];
  const week = crossing("week", "attempts", weekStartOf(day));
  const month = crossing("month", "attempts", day.slice(0, 7));
  return {
    day:
      day === after.splitDay
        ? []
        : order.flatMap((metric) => {
            const hit = crossing("day", metric, day);
            return hit
              ? [{
                  metric,
                  value: hit.value,
                  previous: hit.previous ? { value: hit.previous.value, day: hit.previous.key } : null,
                }]
              : [];
          }),
    week: week ? { value: week.value, weekStart: weekStartOf(day), previous: week.previous?.value ?? null } : null,
    month: month ? { value: month.value, month: day.slice(0, 7), previous: month.previous?.value ?? null } : null,
  };
}

export type BestRow = {
  key: BestMetric | "week" | "month";
  label: string;
  value: number;
  valueText: string;
  date: string;
  /** Tageswerte öffnen den Tag, Woche und Monat die Seite Meine Tage. */
  href: string;
};
/** Die Zeilen der Karte „Deine Bestwerte“: nur Werte über 0, höchstens 6. */
export function bestRows(bests: PersonalBests, today: string): BestRow[] {
  const rows: BestRow[] = [];
  const dayRow = (metric: BestMetric) => {
    const b = bests.day[metric];
    if (b && b.value > 0)
      rows.push({
        key: metric,
        label: GAME_TEXT.bestLabel[metric],
        value: b.value,
        valueText: num(b.value),
        date: SHORT_DAY.format(asDate(b.day)),
        href: `/tagesabschluss?tag=${b.day}`,
      });
  };
  dayRow("attempts");
  if (bests.week && bests.week.value > 0)
    rows.push({
      key: "week",
      label: GAME_TEXT.bestLabel.week,
      value: bests.week.value,
      valueText: num(bests.week.value),
      date: GAME_TEXT.bestWeekDate(bests.week.weekStart),
      href: "/zahlen",
    });
  if (bests.month && bests.month.value > 0)
    rows.push({
      key: "month",
      label: GAME_TEXT.bestLabel.month,
      value: bests.month.value,
      valueText: num(bests.month.value),
      date: monthName(bests.month.month, today.slice(0, 4)),
      href: "/zahlen",
    });
  dayRow("settingsBooked");
  dayRow("closingsBooked");
  dayRow("dealsWon");
  return rows.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Ehrlichkeitsfrage im Formular: nicht blockierend, nur auf dem Gerät.

export type PlausibilityHint = {
  kind: "settings" | "outlier";
  /** Feld, auf das „Korrigieren“ den Fokus setzt. */
  field: "settingsBooked" | "attempts";
  text: string;
  confirm: string;
  correct: string;
};

/**
 * (a) Settings über den Anwahlen (nur mit Anwahlen über 0), oder (b) ein
 * Ausreißer: mindestens 10 frühere Tage mit Anwahlen, jetzt mindestens 150
 * und mehr als das Dreifache des Medians der letzten 20 dieser Tage. Keine
 * feste Obergrenze. Mit `day` zählen nur Tage davor.
 */
export function plausibilityHint(
  counts: { attempts?: number | null; settingsBooked?: number | null },
  closings: { day: string; counts: Partial<Record<"attempts", unknown>> | null }[],
  day?: string,
): PlausibilityHint | null {
  const attempts = finite(counts.attempts);
  const settings = finite(counts.settingsBooked);
  const labels = { confirm: GAME_TEXT.plausibilityConfirm, correct: GAME_TEXT.plausibilityCorrect };
  if (attempts !== null && attempts > 0 && settings !== null && settings > attempts)
    return {
      kind: "settings",
      field: "settingsBooked",
      text: GAME_TEXT.plausibilitySettings(settings, attempts),
      ...labels,
    };
  if (attempts === null || attempts < 150) return null;
  const earlier = closings
    .filter((c) => (day ? c.day < day : true))
    .map((c) => ({ day: c.day, attempts: finite(c.counts?.attempts) }))
    .filter((c): c is { day: string; attempts: number } => (c.attempts ?? 0) > 0)
    .sort((a, b) => b.day.localeCompare(a.day));
  if (earlier.length < 10) return null;
  const usual = median(earlier.slice(0, 20).map((c) => c.attempts));
  return attempts > 3 * usual
    ? {
        kind: "outlier",
        field: "attempts",
        text: GAME_TEXT.plausibilityOutlier(attempts, Math.round(usual)),
        ...labels,
      }
    : null;
}

// ---------------------------------------------------------------------------
// Deine Woche: Wochenziel-Balken und Tagesreihe.

/** full: volle Runde · submitted: eingereicht · imported: übernommen · open · paused. */
export type WeekDayState = "full" | "submitted" | "imported" | "open" | "paused";
export type WeekView = {
  from: string;
  to: string;
  /** Summen aus dem Spielstand; null heißt: nichts gemeldet. */
  totals: { attempts: number | null; settingsBooked: number | null; closingsBooked: number | null };
  goal: number | null;
  reached: boolean;
  remaining: number | null;
  /** Je globalem Calling-Wochentag der Woche ein Feld. */
  days: { day: string; state: WeekDayState; today: boolean }[];
  fullRounds: number;
  /** Alle Calling-Wochentage der Woche liegen in einer bestätigten Pause. */
  paused: boolean;
  /** Hinweis, wenn das Wochenziel unter der Hälfte des Vorschlags liegt. */
  suggestion: { value: number } | null;
};

const statusMap = (summary: CommitmentSummary) =>
  new Map(summary.days.map((d) => [d.day, d.status] as const));

/** Die Marke heute oder die zuletzt gültige (höchstens 31 Tage zurück). */
function latestMark(inputs: GameInputs, today: string) {
  for (let d = today, i = 0; i < 31; i++, d = addDays(d, -1)) {
    const mark = markFor(inputs, d);
    if (mark) return mark.mark;
  }
  return null;
}
function weekSum(inputs: GameInputs, weekStart: string) {
  const p = prepare(inputs);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return aggregate(days.flatMap((d) => (p.counts.has(d) ? [p.counts.get(d)!] : [])));
}

function weekViewAt(
  inputs: GameInputs,
  today: string,
  statuses: Map<string, DayStatus>,
): WeekView {
  const p = prepare(inputs);
  const from = weekStartOf(today);
  const to = addDays(from, 6);
  const sums = weekSum(inputs, from);
  const totals = {
    attempts: sums.attempts,
    settingsBooked: sums.settingsBooked,
    closingsBooked: sums.closingsBooked,
  };
  const calling = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((d) =>
    inputs.settings.callingWeekdays.includes(isoWeekday(d)),
  );
  const days = calling.map((day) => {
    const row = p.rows.get(day);
    let state: WeekDayState = "open";
    if (row?.origin === "closing")
      state = roundFor(inputs, day, statuses.get(day) ?? null)?.full ? "full" : "submitted";
    else if (row) state = "imported";
    else if (isPaused(day, inputs.pauses)) state = "paused";
    return { day, state, today: day === today };
  });
  const goal = inputs.goal && inputs.goal > 0 ? inputs.goal : null;
  const attempts = totals.attempts ?? 0;
  const callDays = Math.min(5, new Set(inputs.days.filter((d) => d >= 1 && d <= 5)).size);
  const mark = goal && callDays ? latestMark(inputs, today) : null;
  const value = mark ? Math.round((mark * callDays) / 50) * 50 : 0;
  return {
    from,
    to,
    totals,
    goal,
    reached: goal !== null && attempts >= goal,
    remaining: goal === null ? null : Math.max(0, goal - attempts),
    days,
    fullRounds: days.filter((d) => d.state === "full").length,
    paused: calling.length > 0 && calling.every((d) => isPaused(d, inputs.pauses)),
    suggestion: goal !== null && value > 0 && goal < value / 2 ? { value } : null,
  };
}

/** Die laufende Woche (Montag bis Sonntag) zum Zeitpunkt `now`. */
export function weekView(inputs: GameInputs, now: Date): WeekView {
  const today = localDay(now, inputs.settings.timeZone);
  const from = weekStartOf(today);
  return weekViewAt(inputs, today, statusMap(gameSummary(inputs, now, { from, to: addDays(from, 6) })));
}

// ---------------------------------------------------------------------------
// Gemeinsames Wochenziel aller Anwahlen.

export const COMMUNITY_GOAL_MIN = 500;
export const COMMUNITY_GOAL_MAX = 200_000;
export const COMMUNITY_GOAL_ENTRIES = 26;
/** Automatisches Ziel: nie darunter. */
export const COMMUNITY_GOAL_FLOOR = 1_000;
/** Automatisches Ziel: höchstens so viel mal die Vorwoche. */
export const COMMUNITY_GOAL_STRETCH = 1.2;
/**
 * Teamwert ab einem Montag. attempts null heißt: ab diesem Montag wieder
 * automatisch; frühere Wochen behalten ihr Ziel.
 */
export type CommunityGoal = { from: string; attempts: number | null };
/** Wert in app_settings unter dem Schlüssel 'community'. */
export type CommunitySettings = { goals: CommunityGoal[] };
/** Wochensumme; nur Wochen, in denen überhaupt Anwahlen gemeldet sind. */
export type CommunityWeekSum = { weekStart: string; attempts: number };

/**
 * Ziel einer Woche: der neueste Eintrag mit from <= Wochenbeginn (bei
 * gleichem Montag der spätere). Trägt er einen Teamwert, gilt der; ist er
 * leer (null) oder fehlt er, automatisch der Schnitt der vier Wochen davor
 * (weniger, wenn es weniger gibt), abgerundet auf volle 500, höchstens das
 * 1,2-Fache der Vorwoche (auf 500 gerundet), mindestens 1.000. Kein
 * Aufschlag auf den Schnitt, damit keine Sperrklinke entsteht.
 */
export function communityGoalFor(
  weekStart: string,
  settings: CommunitySettings | null | undefined,
  previousWeekSums: CommunityWeekSum[],
): { goal: number; auto: boolean } {
  let chosen: CommunityGoal | null = null;
  for (const entry of Array.isArray(settings?.goals) ? settings.goals : []) {
    const valid =
      typeof entry?.from === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry.from) &&
      isoWeekday(entry.from) === 1 &&
      (entry.attempts === null ||
        (Number.isInteger(entry.attempts) &&
          entry.attempts >= COMMUNITY_GOAL_MIN &&
          entry.attempts <= COMMUNITY_GOAL_MAX));
    if (valid && entry.from <= weekStart && (!chosen || entry.from >= chosen.from)) chosen = entry;
  }
  if (chosen?.attempts != null) return { goal: chosen.attempts, auto: false };
  const window = new Set([1, 2, 3, 4].map((i) => addDays(weekStart, -7 * i)));
  const sums = previousWeekSums.filter((w) => window.has(w.weekStart)).map((w) => w.attempts);
  const average = sums.length ? sums.reduce((a, b) => a + b, 0) / sums.length : 0;
  let goal = Math.floor(average / 500) * 500;
  // Erreichbar bleiben: Nach einer schwachen Woche (oder nach einem Ausreißer
  // wie dem Akquise Day im Schnitt) liegt das Ziel höchstens gut ein Fünftel
  // über der Vorwoche, auf volle 500 gerundet.
  const last = previousWeekSums.find((w) => w.weekStart === addDays(weekStart, -7));
  if (last) goal = Math.min(goal, Math.round((last.attempts * COMMUNITY_GOAL_STRETCH) / 500) * 500);
  return { goal: Math.max(COMMUNITY_GOAL_FLOOR, goal), auto: true };
}

/** Eine Zeile aus checkins mit Art des Profils. */
export type CommunityRow = {
  participant: string;
  kind?: ParticipantKind | string | null;
  day: string;
  counts: Partial<Counts>;
};
/**
 * Wochenwert über aggregate(): eigene Abschlüsse und Importe aller Profile,
 * gemeinsame Meldungen genau einmal. „Dabei“ zählt nur Personen mit
 * Anwahlen über 0.
 */
export function communityWeek(rows: CommunityRow[], weekStart: string) {
  const to = addDays(weekStart, 6);
  const week = rows.filter((r) => r.day >= weekStart && r.day <= to);
  const sum = aggregate(week.map((r) => fullCounts(r.counts))).attempts;
  const people = new Set(
    week
      .filter((r) => participantKind(r.kind) === "person" && (finite(r.counts.attempts) ?? 0) > 0)
      .map((r) => r.participant),
  );
  return { weekStart, attempts: sum ?? 0, reported: sum !== null, people: people.size };
}

export type CommunityView = {
  weekStart: string;
  attempts: number;
  goal: number;
  auto: boolean;
  reached: boolean;
  people: number;
  /** Ergebnis der Vorwoche mit deren Ziel, nur Montag bis Mittwoch. */
  lastWeek: { attempts: number; goal: number; reached: boolean } | null;
};

/**
 * Stand der laufenden Woche für die Fläche „Gemeinsam erreicht“. `rows`
 * deckt die laufende Woche und die fünf davor ab (die Vorwoche braucht für
 * ihr eigenes Ziel wiederum vier Wochen davor).
 */
export function communityView(
  rows: CommunityRow[],
  today: string,
  settings: CommunitySettings | null | undefined,
): CommunityView {
  const weekStart = weekStartOf(today);
  const sums = [1, 2, 3, 4, 5]
    .map((i) => communityWeek(rows, addDays(weekStart, -7 * i)))
    .filter((w) => w.reported)
    .map(({ weekStart: start, attempts }) => ({ weekStart: start, attempts }));
  const current = communityWeek(rows, weekStart);
  const { goal, auto } = communityGoalFor(weekStart, settings, sums);
  let lastWeek: CommunityView["lastWeek"] = null;
  if (isoWeekday(today) <= 3) {
    const previousStart = addDays(weekStart, -7);
    const previous = communityWeek(rows, previousStart);
    const previousGoal = communityGoalFor(previousStart, settings, sums).goal;
    lastWeek = {
      attempts: previous.attempts,
      goal: previousGoal,
      reached: previous.attempts >= previousGoal,
    };
  }
  return {
    weekStart,
    attempts: current.attempts,
    goal,
    auto,
    reached: current.attempts >= goal,
    people: current.people,
    lastWeek,
  };
}

// ---------------------------------------------------------------------------
// Alles für die Anzeige: Marke heute, Runde heute, Serie, Woche, Bestwerte, Tage.

export type GameStreak = {
  current: number;
  best: number;
  /**
   * Privat: ein früherer Pflicht-Tag ist noch offen und eine Serie hängt
   * daran (summarize().atRisk ohne den heutigen Tag).
   */
  atRisk: { day: string; deadline: string } | null;
  /** Privat: heute in bestätigter Pause. */
  paused: boolean;
  nextEtappe: Etappe | null;
  flame: FlameState;
};
export type GameDay = {
  day: string;
  fullRound: boolean;
  /** Kennzahlen, deren Tagesbestwert dieser Tag hält. */
  bestMetrics: BestMetric[];
  /** Nach der Frist erhöht: was für Tagesmarke und Bestwerte zählt. */
  differs: ReturnType<typeof counted>;
};
export type GameView = {
  today: string;
  /** Status von heute aus summarize(). */
  todayStatus: DayStatus | null;
  /** Frist für heute, nur an Pflicht-Tagen. */
  deadline: string | null;
  mark: GameMark | null;
  round: GameRound | null;
  streak: GameStreak;
  week: WeekView;
  bests: PersonalBests;
  /** Alle eigenen Tage, neueste zuerst. */
  days: GameDay[];
};

export function gameView(inputs: GameInputs, now: Date): GameView {
  const today = localDay(now, inputs.settings.timeZone);
  const monday = weekStartOf(today);
  const summary = gameSummary(inputs, now, { from: monday, to: addDays(monday, 6) });
  const statuses = statusMap(summary);
  const todayState = summary.days.find((d) => d.day === today) ?? null;
  const mark = markFor(inputs, today);
  const bests = personalBests(inputs);
  const paused = isPaused(today, inputs.pauses);
  const streak = summary.streak;
  // Gefahr heißt: ein früherer Tag hängt noch an seiner Frist. Der heutige
  // offene Tag ist der normale Auftrag (Zeile „Abschluss bis …“), keine Gefahr.
  const atRisk = summary.atRisk && summary.atRisk.day < today ? summary.atRisk : null;
  return {
    today,
    todayStatus: todayState?.status ?? null,
    // Direkt aus den Regeln, damit sie auch am Freischaltungstag vor dem
    // ersten Abschluss steht (summarize() kennt dort noch keine Frist).
    deadline: isDueDay(today, inputs.settings, inputs.pauses)
      ? deadlineFor(today, inputs.settings, inputs.pauses).toISOString()
      : null,
    mark,
    round: roundFor(inputs, today, todayState),
    streak: {
      current: streak.current,
      best: streak.best,
      atRisk,
      paused,
      nextEtappe: nextEtappe(streak.current),
      flame: flameState(streak, atRisk, paused),
    },
    week: weekViewAt(inputs, today, statuses),
    bests,
    days: [...prepare(inputs).rows.keys()]
      .sort((a, b) => b.localeCompare(a))
      .map((day) => ({
        day,
        // Voll kann nur ein Tag mit Status called sein.
        fullRound: statuses.get(day) === "called" && !!roundFor(inputs, day, "called")?.full,
        bestMetrics: BEST_METRICS.filter((m) => bests.day[m]?.day === day),
        differs: counted(inputs, day),
      })),
  };
}

/**
 * Satz der Karte zur Marke: Wiedereinstieg (Titel und Satz ersetzen die
 * Karte), erste Marke eines neuen Kontos, sonst nichts.
 */
export function markNotice(mark: GameMark, streak: number): { title: string | null; text: string } | null {
  if (mark.comeback === "gap")
    return { title: GAME_TEXT.comebackGapTitle, text: GAME_TEXT.comebackGapText };
  if (mark.comeback === "pause")
    return { title: GAME_TEXT.comebackPauseTitle, text: GAME_TEXT.comebackPauseText(streak) };
  return mark.basisDays < BASIS_MIN ? { title: null, text: GAME_TEXT.firstMark } : null;
}

/**
 * Ein Satz zur Serie, privat: Pause, Gefahr, Start, nächste Etappe oder alle
 * Etappen geschafft. `todayStatus` entscheidet, ob die Serie heute startet.
 */
export function streakNote(
  streak: Pick<GameStreak, "current" | "best" | "atRisk" | "paused">,
  todayStatus: DayStatus | null,
  timeZone: string,
  now: Date,
): string {
  if (streak.paused && streak.current > 0) return GAME_TEXT.streakPaused(streak.current);
  if (streak.atRisk) return GAME_TEXT.streakAtRisk(streak.atRisk, timeZone, now);
  if (streak.current <= 0)
    return todayStatus === "open" ? GAME_TEXT.streakStartsToday : GAME_TEXT.streakStartsNext;
  const next = nextEtappe(streak.current);
  return next ? GAME_TEXT.nextEtappe(next, streak.current) : GAME_TEXT.allEtappen(streak.best);
}

// ---------------------------------------------------------------------------
// Tagesbilanz nach dem Einreichen.

/**
 * Der Stand nach dem Schreiben, ohne zweite Abfrage: die eine Tageszeile wird
 * ersetzt und die neue eigene Fassung angehängt. Fehlende Zeitpunkte folgen
 * denselben Regeln wie submitClosing() (erste Einreichung und erste
 * Dokumentation von Anwahlen bleiben).
 */
export function withSubmitted(
  inputs: GameInputs,
  submitted: {
    day: string;
    counts: Partial<Counts>;
    submittedAt: string;
    firstSubmittedAt?: string | null;
    callsDocumentedAt?: string | null;
  },
): GameInputs {
  const own = isOwn(inputs);
  const old = inputs.checkins.find((r) => r.day === submitted.day && own(r));
  const counts = fullCounts(submitted.counts);
  const keptOld = old?.origin === "closing" ? old : null;
  const row: GameCheckin = {
    day: submitted.day,
    counts,
    origin: "closing",
    source: "website",
    firstSubmittedAt: submitted.firstSubmittedAt ?? keptOld?.firstSubmittedAt ?? submitted.submittedAt,
    submittedAt: submitted.submittedAt,
    callsDocumentedAt:
      submitted.callsDocumentedAt ??
      keptOld?.callsDocumentedAt ??
      ((counts.attempts ?? 0) > 0 ? submitted.submittedAt : null),
    ...(inputs.participantId ? { participant: inputs.participantId } : {}),
  };
  // Erfassungsbeginn wie trackingStart(): der Freischaltungstag zählt, sobald
  // an ihm ein Abschluss vorliegt.
  const first = inputs.eligibleSince
    ? localDay(new Date(inputs.eligibleSince), inputs.settings.timeZone)
    : null;
  return {
    ...inputs,
    checkins: [...inputs.checkins.filter((r) => !(r.day === submitted.day && own(r))), row],
    revisions: [
      ...inputs.revisions,
      { day: submitted.day, counts, createdAt: submitted.submittedAt, source: "website" },
    ],
    trackingStart:
      first === submitted.day && inputs.trackingStart && inputs.trackingStart > first
        ? first
        : inputs.trackingStart,
  };
}

/**
 * Leistungslevel wie bisher im Formular: aus dem aktuellen Stand aller
 * eigenen Tage (auch übernommener), vorher und nachher. Nur echte Sprünge,
 * z. B. „Anwahlen auf Level 3“.
 */
export function levelUps(before: GameInputs, after: GameInputs): string[] {
  const levels = (inputs: GameInputs) =>
    progress(aggregate(ownRows(inputs).map((r) => ({ ...emptyCounts(), ...r.counts }) as Counts)));
  const old = new Map(levels(before).map((t) => [t.id, t.level]));
  return levels(after)
    .filter((t) => t.level > (old.get(t.id) ?? 0))
    .map((t) => `${t.label} auf Level ${t.level}`);
}

export type GameHighlightKind = "etappe" | "streak-best" | "best" | "level" | "week" | "place";
export type GameHighlight = { kind: GameHighlightKind; title: string; detail: string };
export type GameNextStep =
  | { kind: "week"; text: string; attempts: number; goal: number; remaining: number }
  | { kind: "etappe"; text: string; etappe: Etappe };
export type GameMoments = {
  day: string;
  status: DayStatus | null;
  round: GameRound | null;
  streak: {
    before: { current: number; best: number };
    after: { current: number; best: number };
  };
  /** Höchstens zwei, nur bei der ersten Einreichung eines Tages. */
  highlights: GameHighlight[];
  /** „Als Nächstes“, nie zum gerade eingereichten Tag. */
  nextStep: GameNextStep | null;
};

/**
 * Eigener Platz im Kalendermonat des Tages, einmal mit der Zeile dieses Tages
 * vor der Einreichung (alte Werte bzw. ohne Zeile), einmal danach; alle
 * anderen Zeilen gleich. Gleiche Plätze wie in der Rangliste, gemeinsame
 * Meldungen bekommen nie einen Platz.
 */
export function monthPlaces(
  records: DatedRankingRow[],
  participantId: string,
  day: string,
  oldCounts: Partial<Counts> | null,
  newCounts: Partial<Counts>,
) {
  const month = day.slice(0, 7);
  const others = records.filter((r) => !(r.id === participantId && r.day === day));
  const self: DatedRankingRow = records.find((r) => r.id === participantId) ?? {
    id: participantId,
    key: "",
    name: "",
    company: "",
    role: "",
    kind: "person",
    claimed: true,
    counts: emptyCounts(),
    source: "Selbst gemeldet",
    updatedAt: "",
    day,
  };
  const row = (counts: Partial<Counts>): DatedRankingRow => ({ ...self, day, counts: fullCounts(counts) });
  const rank = (list: DatedRankingRow[]) =>
    placed(summarizeRankingMonth(list, month).rows).find((r) => r.id === participantId)?.rank ?? null;
  return {
    month,
    before: rank(oldCounts ? [...others, row(oldCounts)] : others),
    after: rank([...others, row(newCounts)]),
  };
}

function placeHighlight(month: string, before: number | null, after: number | null): GameHighlight | null {
  if (after === null) return null;
  const name = monthName(month);
  let title: string | null = null;
  if (after === 1 && before !== 1) title = GAME_TEXT.placeLead(name);
  else if (after <= 3 && (before === null || before > 3)) title = GAME_TEXT.placePodium(name, after);
  else if (before === null) title = GAME_TEXT.placeNew(name, after);
  else if (before - after >= 1) title = GAME_TEXT.placeJump(name, before, after);
  return title ? { kind: "place", title, detail: "" } : null;
}

function bestHighlight(found: NewBests): GameHighlight | null {
  if (found.day.length === 1) {
    const [{ metric, value, previous }] = found.day;
    return {
      kind: "best",
      title: GAME_TEXT.newDayBest(metric, value),
      detail: previous ? GAME_TEXT.bestBefore(previous.value, previous.day) : "",
    };
  }
  if (found.day.length > 1)
    return { kind: "best", title: GAME_TEXT.newDayBests(found.day), detail: "" };
  if (found.week)
    return {
      kind: "best",
      title: GAME_TEXT.newWeekBest(found.week.value),
      detail: found.week.previous ? GAME_TEXT.bestBeforeValue(found.week.previous) : "",
    };
  if (found.month)
    return {
      kind: "best",
      title: GAME_TEXT.newMonthBest(found.month.value),
      detail: found.month.previous ? GAME_TEXT.bestBeforeValue(found.month.previous) : "",
    };
  return null;
}

/**
 * Bilanz einer Einreichung aus dem Vergleich vorher und nachher. Höhepunkte
 * nur bei der ersten Einreichung eines Tages (das Ersetzen eines
 * Wins-Imports gilt als erste), höchstens zwei, in fester Rangfolge:
 * Etappe bzw. Serien-Bestwert, Bestwert, Leistungslevel, Wochenziel,
 * Monatsplatz. Ohne Höhepunkt bleibt die Liste leer; nichts wird erfunden.
 */
export function gameMoments({
  before,
  after,
  day,
  firstSubmission,
  monthRecords = null,
  oldCounts,
  participantId,
  now,
}: {
  before: GameInputs;
  after: GameInputs;
  day: string;
  firstSubmission: boolean;
  /** Monatszeilen vor dem Schreiben (nur bei erster Einreichung nötig). */
  monthRecords?: DatedRankingRow[] | null;
  /** Werte dieses Tages vor der Einreichung; fehlt es, aus monthRecords. */
  oldCounts?: Partial<Counts> | null;
  participantId: string;
  now: Date;
}): GameMoments {
  const today = localDay(now, after.settings.timeZone);
  const monday = weekStartOf(today);
  const range = { from: day < monday ? day : monday, to: addDays(monday, 6) };
  const old = gameSummary(before, now, range);
  const fresh = gameSummary(after, now, range);
  const statuses = statusMap(fresh);
  const status = statuses.get(day) ?? null;
  const streak = {
    before: { current: old.streak.current, best: old.streak.best },
    after: { current: fresh.streak.current, best: fresh.streak.best },
  };
  const highlights: GameHighlight[] = [];
  if (firstSubmission) {
    const etappe = etappeCrossed(streak.before.current, streak.after.current);
    const record = newStreakBest(streak.before, streak.after);
    if (etappe)
      highlights.push({
        kind: "etappe",
        title: GAME_TEXT.etappe[etappe][0],
        detail: GAME_TEXT.etappe[etappe][1] + (record !== null ? GAME_TEXT.etappeRecord : ""),
      });
    else if (record !== null)
      highlights.push({ kind: "streak-best", title: GAME_TEXT.streakBest(record), detail: "" });
    const best = bestHighlight(newBests(before, after, day));
    if (best) highlights.push(best);
    const ups = levelUps(before, after);
    if (ups.length) highlights.push({ kind: "level", title: GAME_TEXT.levelUp(ups), detail: "" });
    const goal = after.goal && after.goal > 0 ? after.goal : null;
    if (goal !== null) {
      const week = weekStartOf(day);
      const was = weekSum(before, week).attempts ?? 0;
      const is = weekSum(after, week).attempts ?? 0;
      if (was < goal && goal <= is)
        highlights.push({ kind: "week", title: GAME_TEXT.weekGoalReached(is, goal), detail: "" });
    }
    if (monthRecords) {
      const previous =
        oldCounts !== undefined
          ? oldCounts
          : (monthRecords.find((r) => r.id === participantId && r.day === day)?.counts ?? null);
      const places = monthPlaces(
        monthRecords,
        participantId,
        day,
        previous,
        prepare(after).rows.get(day)?.counts ?? {},
      );
      const place = placeHighlight(places.month, places.before, places.after);
      if (place) highlights.push(place);
    }
  }
  // Als Nächstes: Rest bis zum Wochenziel, solange diese Woche noch ein
  // Calling-Tag folgt; sonst die nächste Etappe; sonst nichts. „Folgt noch“
  // heißt: nach dem eingereichten Tag und nicht vorbei. Heute zählt mit,
  // solange es noch keinen Abschluss hat (Donnerstag am Freitagmorgen).
  const week = weekViewAt(after, today, statuses);
  let nextStep: GameNextStep | null = null;
  const laterCallingDay = Array.from({ length: 7 }, (_, i) => addDays(week.from, i)).some(
    (d) =>
      d > day &&
      (d > today || (d === today && statuses.get(d) === "open")) &&
      isDueDay(d, after.settings, after.pauses),
  );
  if (week.goal !== null && !week.reached && !week.paused && laterCallingDay)
    nextStep = {
      kind: "week",
      text: GAME_TEXT.nextWeek(week.remaining!),
      attempts: week.totals.attempts ?? 0,
      goal: week.goal,
      remaining: week.remaining!,
    };
  else {
    const etappe = nextEtappe(streak.after.current);
    if (etappe) nextStep = { kind: "etappe", text: GAME_TEXT.nextEtappeStep(etappe, streak.after.current), etappe };
  }
  return {
    day,
    status,
    round: roundFor(after, day, status),
    streak,
    highlights: highlights.slice(0, 2),
    nextStep,
  };
}

// ---------------------------------------------------------------------------
// Spieltexte. Ein Ort für die Wortwahl; keine Gedankenstriche, keine
// Punkte-Sprache, keine Wertung und keine Gewichte.

const num = (n: number) => n.toLocaleString("de-DE");
const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("de-DE", { ...options, timeZone: "UTC" });
const SHORT_DAY = dateFormat({ weekday: "short", day: "2-digit", month: "2-digit" });
const DAY_MONTH = dateFormat({ day: "2-digit", month: "2-digit" });
const WEEKDAY = dateFormat({ weekday: "long" });
const MONTH = dateFormat({ month: "long" });
const MONTH_YEAR = dateFormat({ month: "long", year: "numeric" });
const asDate = (day: string) => new Date(`${day}T12:00:00Z`);
/** „Oktober“, aus einem anderen Jahr „Oktober 2025“. */
function monthName(month: string, year?: string) {
  const date = asDate(`${month}-01`);
  return year && month.slice(0, 4) !== year ? MONTH_YEAR.format(date) : MONTH.format(date);
}
/** „heute 10:00 Uhr“, „morgen 10:00 Uhr“ oder „Mo. 10:00 Uhr“. */
function deadlineShort(iso: string, timeZone: string, now: Date) {
  const day = localDay(new Date(iso), timeZone);
  const today = localDay(now, timeZone);
  const clock = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone }).format(
    new Date(iso),
  );
  if (day === today) return `heute ${clock} Uhr`;
  if (day === addDays(today, 1)) return `morgen ${clock} Uhr`;
  const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone }).format(new Date(iso));
  return `${weekday.endsWith(".") ? weekday : `${weekday}.`} ${clock} Uhr`;
}
const UNITS: Record<BestMetric, [string, string]> = {
  attempts: ["Anwahl", "Anwahlen"],
  settingsBooked: ["Setting", "Settings"],
  closingsBooked: ["Closing", "Closings"],
  dealsWon: ["Deal", "Deals"],
};
const amount = (metric: BestMetric, n: number) => `${num(n)} ${UNITS[metric][n === 1 ? 0 : 1]}`;
const dayCount = (n: number) => `${num(n)} ${n === 1 ? "Tag" : "Tage"}`;
/** „a, b und c“ */
const listing = (parts: string[]) =>
  parts.length > 1 ? `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}` : parts.join("");
const WEEKDAY_STATE: Record<WeekDayState, string> = {
  full: "volle Runde",
  submitted: "eingereicht",
  imported: "übernommen",
  open: "offen",
  paused: "Pause",
};

export const GAME_TEXT = {
  // Tagesmarke und volle Runde
  mark: "Tagesmarke",
  markValue: (mark: number) => `${num(mark)} Anwahlen`,
  closingDue: (deadline: string, timeZone: string, now: Date) =>
    `Abschluss bis ${deadlineShort(deadline, timeZone, now)}`,
  /** Ergebnis der Runde; nicht geschafft bleibt neutral. */
  markResult: (attempts: number | null, mark: number, imported: boolean) =>
    `${attempts !== null && attempts >= mark ? "Tagesmarke geschafft" : "Tagesmarke"}: ${num(attempts ?? 0)} von ${num(mark)} Anwahlen${imported ? ", übernommen" : ""}`,
  fullRound: "Volle Runde",
  fullRoundTitle: "Volle Runde. Dein Tag ist drin.",
  dayInTitle: "Dein Tag ist drin.",
  otherDayInTitle: (dayLabel: string) => `${dayLabel} ist drin.`,
  unchangedTitle: "Keine Änderung nötig, dein Tag steht.",
  firstMark:
    "Deine erste Tagesmarke: 50 Anwahlen. Ab drei gemeldeten Calling-Tagen richtet sie sich nach dir.",
  comebackGapTitle: "Willkommen zurück.",
  comebackGapText:
    "Heute reicht: 50 Anwahlen und dein Abschluss. Nichts nachholen, einfach wieder anfangen.",
  comebackPauseTitle: "Pause vorbei.",
  comebackPauseText: (streak: number) =>
    streak > 0
      ? `Heute reicht: 50 Anwahlen und dein Abschluss. Deine Serie wartet bei ${num(streak)}.`
      : "Heute reicht: 50 Anwahlen und dein Abschluss.",
  markToday: (mark: number) => `Tagesmarke heute: ${num(mark)} Anwahlen`,
  markHowTitle: "Wie entsteht deine Tagesmarke?",
  markHowText:
    "Sie richtet sich nach deinen letzten 10 Calling-Tagen und liegt nah an deinem üblichen Tag. Callst du mehr, steigt sie mit. Ist es mal weniger, sinkt sie wieder. Ohne Abzug, ohne Strafe. Ab 50 Anwahlen zählt ein Calling-Tag auch für Aktiver Caller.",
  guideMarkTitle: "Tagesmarke und volle Runde",
  guideMarkText:
    "An jedem Calling-Tag hast du eine Tagesmarke in Anwahlen. Sie richtet sich nach deinen letzten 10 Calling-Tagen. Erreichst du sie und reichst deinen Tag rechtzeitig ein, ist es eine volle Runde. Nach ein paar Calling-Tagen ohne Anwahlen oder nach einer Pause liegt die Marke bei 50, damit der Wiedereinstieg leicht ist. Für Tagesmarke, Bestwerte und Wochenziel zählt dein Stand bis zur Frist: Korrigierst du danach nach oben, zählt das in der Rangliste, hier nicht. Korrigierst du nach unten, gilt der kleinere Wert.",

  // Serie als Flamme
  streakShort: (current: number) => `Serie ${num(current)}`,
  /** Serie 0 an einem offenen Calling-Tag: heute wäre Tag 1. */
  streakFirstDay: "Heute Tag 1",
  streakFirstDayAria: "Serie: startet heute mit Tag 1",
  streakAria: (current: number) => `Serie: ${dayCount(current)}`,
  streakDays: (current: number) => dayCount(current),
  streakStartsToday: "Serie startet mit diesem Tag",
  streakStartsNext: "Serie startet mit deinem nächsten rechtzeitigen Abschluss",
  streakAtRisk: (atRisk: { day: string; deadline: string }, timeZone: string, now: Date) =>
    `Deine Serie hängt an ${WEEKDAY.format(asDate(atRisk.day))}. Bis ${deadlineShort(atRisk.deadline, timeZone, now)}.`,
  streakPaused: (current: number) => `Pause: deine Serie wartet bei ${num(current)}.`,
  nextEtappe: (etappe: number, current: number) => {
    const left = Math.max(0, etappe - current);
    return `Nächste Etappe: ${num(etappe)} Tage. Noch ${num(left)} ${left === 1 ? "rechtzeitiger Abschluss" : "rechtzeitige Abschlüsse"}.`;
  },
  nextEtappeShort: (etappe: number) => `Nächste Etappe: ${num(etappe)} Tage`,
  allEtappen: (best: number) => `Alle Etappen geschafft. Bestwert ${num(best)}.`,
  /** Etappe als Höhepunkt: Titel und Detail. */
  etappe: {
    5: ["5 Tage Serie.", "Eine ganze Calling-Woche, jeder Tag rechtzeitig."],
    10: ["10 Tage Serie.", "Zwei Wochen ohne Lücke."],
    20: ["20 Tage Serie.", "Ein ganzer Calling-Monat."],
    40: ["40 Tage Serie.", "Zwei Monate am Stück."],
    60: ["60 Tage Serie.", "Drei Monate am Stück."],
    100: ["100 Tage Serie.", "Das ist Dranbleiben."],
  } satisfies Record<Etappe, [string, string]>,
  etappeRecord: " So lang wie nie.",
  streakBest: (current: number) => `Neuer Bestwert in deiner Serie: ${dayCount(current)}.`,

  // Bilanz
  /**
   * Zahlenzeile: „127 Anwahlen · 4 Settings · 1 Closing“, Deals nur über 0.
   * Nicht gemeldete Werte fallen weg; ohne jeden Wert leer.
   */
  numbersLine: (counts: Partial<Counts>) => {
    const part = (n: number | null | undefined, one: string, many: string) =>
      typeof n === "number" ? [`${num(n)} ${n === 1 ? one : many}`] : [];
    return [
      ...part(counts.attempts, "Anwahlen", "Anwahlen"),
      ...part(counts.settingsBooked, "Setting", "Settings"),
      ...part(counts.closingsBooked, "Closing", "Closings"),
      ...(counts.dealsWon ? part(counts.dealsWon, "Deal", "Deals") : []),
    ].join(" · ");
  },
  levelUp: (ups: string[]) => `Neues Leistungslevel: ${ups.join(", ")}.`,
  weekGoalReached: (attempts: number, goal: number) =>
    `Wochenziel geschafft: ${num(attempts)} von ${num(goal)} Anwahlen.`,
  placeJump: (month: string, before: number, after: number) =>
    `Dein Tag hat dich im ${month} von Platz ${before} auf Platz ${after} gebracht.`,
  placePodium: (month: string, place: number) => `Du stehst im ${month} jetzt auf dem Podium: Platz ${place}.`,
  placeLead: (month: string) => `Du führst den ${month} an.`,
  placeNew: (month: string, place: number) => `Im ${month} bist du neu dabei: Platz ${place}.`,
  nextWeek: (remaining: number) =>
    `Als Nächstes: Diese Woche noch ${num(remaining)} Anwahlen bis zu deinem Wochenziel.`,
  nextEtappeStep: (etappe: number, current: number) => {
    const left = Math.max(0, etappe - current);
    return `Als Nächstes: Etappe ${num(etappe)} Tage Serie, noch ${num(left)} ${left === 1 ? "rechtzeitiger Abschluss" : "rechtzeitige Abschlüsse"}.`;
  },
  /** Ein Satz für role=status: Titel, Marke, Serie, Höhepunkte. */
  announcement: (
    title: string,
    round: Pick<GameRound, "attempts" | "mark" | "markReached"> | null,
    streak: number,
    highlights: Pick<GameHighlight, "title">[],
  ) =>
    [
      title,
      round
        ? round.markReached
          ? "Tagesmarke geschafft."
          : `Tagesmarke: ${num(round.attempts ?? 0)} von ${num(round.mark)} Anwahlen.`
        : null,
      `Serie ${num(streak)}.`,
      ...highlights.map((h) => h.title),
    ]
      .filter(Boolean)
      .join(" "),

  // Bestwerte und Ehrlichkeitsfrage
  bestsTitle: "Deine Bestwerte",
  bestsEmpty: "Bestwerte erscheinen ab deinem sechsten Tag mit Meldung.",
  bestPill: "Bestwert",
  bestLabel: {
    attempts: "Anwahlen an einem Tag",
    week: "Anwahlen in einer Woche",
    month: "Anwahlen in einem Monat",
    settingsBooked: "Settings an einem Tag",
    closingsBooked: "Closings an einem Tag",
    dealsWon: "Deals an einem Tag",
  },
  bestWeekDate: (weekStart: string) => `Woche ab ${DAY_MONTH.format(asDate(weekStart))}`,
  differs: (metric: BestMetric, value: number | null) =>
    `Nach der Frist erhöht: Für Tagesmarke und Bestwerte ${value === 1 ? "zählt" : "zählen"} ${amount(metric, value ?? 0)}.`,
  newDayBest: (metric: BestMetric, value: number) => `Neuer Bestwert: ${amount(metric, value)} an einem Tag.`,
  bestBefore: (value: number, day: string) => `Bisher ${num(value)} am ${DAY_MONTH.format(asDate(day))}`,
  bestBeforeValue: (value: number) => `Bisher ${num(value)}.`,
  newDayBests: (list: { metric: BestMetric; value: number }[]) =>
    `Neue Bestwerte an einem Tag: ${listing(list.map((b) => amount(b.metric, b.value)))}.`,
  newWeekBest: (value: number) => `Beste Woche bisher: ${amount("attempts", value)}.`,
  newMonthBest: (value: number) => `Bester Monat bisher: ${amount("attempts", value)}.`,
  plausibilitySettings: (settings: number, attempts: number) =>
    `Kurz prüfen: ${amount("settingsBooked", settings)} bei ${amount("attempts", attempts)}. Stimmt das so?`,
  plausibilityOutlier: (attempts: number, usual: number) =>
    `Kurz prüfen: ${amount("attempts", attempts)}. Sonst sind es bei dir meist etwa ${num(usual)}. Stimmt das so?`,
  plausibilityConfirm: "Stimmt so",
  plausibilityCorrect: "Korrigieren",

  // Deine Woche
  weekLabel: "Woche",
  weekProgress: (attempts: number, goal: number) => `${num(attempts)} von ${num(goal)} Anwahlen`,
  weekRemaining: (remaining: number) => `Noch ${num(remaining)} bis zu deinem Wochenziel`,
  weekReached: (attempts: number, goal: number) =>
    `Wochenziel geschafft: ${num(attempts)} von ${num(goal)} Anwahlen`,
  fullRounds: (n: number) =>
    n === 0
      ? "Noch keine volle Runde diese Woche"
      : n === 1
        ? "1 volle Runde diese Woche"
        : `${num(n)} volle Runden diese Woche`,
  weekDayAria: (day: string, state: WeekDayState) =>
    `${WEEKDAY.format(asDate(day))}: ${WEEKDAY_STATE[state]}`,
  weekPaused: "Diese Woche ist pausiert.",
  noGoal: "Kein Wochenziel.",
  setGoal: "Wochenziel festlegen",
  suggestion: (goal: number, value: number) =>
    `Dein Wochenziel liegt bei ${num(goal)} Anwahlen. Mit deiner Tagesmarke passen eher ${num(value)}.`,
  adjustGoal: "Wochenziel anpassen",

  // Gemeinsames Wochenziel
  communityTitle: "Gemeinsames Wochenziel",
  communityProgress: (attempts: number, goal: number) => `${num(attempts)} von ${num(goal)} Anwahlen`,
  communityRemaining: (remaining: number) => `Noch ${num(remaining)} Anwahlen bis Sonntag`,
  communityReached: (attempts: number, goal: number, people: number) =>
    `Geschafft: ${num(attempts)} von ${num(goal)} Anwahlen.${
      people > 0 ? ` ${num(people)} ${people === 1 ? "Caller ist" : "Caller sind"} dabei.` : ""
    }`,
  communityLastWeek: (attempts: number, goal: number, reached: boolean) =>
    `${reached ? "Letzte Woche geschafft" : "Letzte Woche"}: ${num(attempts)} von ${num(goal)} Anwahlen.`,
  communityAria: (attempts: number, goal: number) =>
    // Erst multiplizieren, dann teilen: 4.230 von 6.000 sind genau 70,5 und damit 71.
    `Gemeinsames Wochenziel: ${num(attempts)} von ${num(goal)} Anwahlen, ${num(
      goal > 0 ? Math.round((attempts * 100) / goal) : 0,
    )} Prozent.`,
  communityAdminLabel: "Gemeinsames Wochenziel (Anwahlen)",
  communityAdminHint:
    "Leer lassen: Deal Operator rechnet es aus dem Schnitt der letzten 4 Wochen, abgerundet auf 500, höchstens gut ein Fünftel über der Vorwoche. Ein neuer Wert gilt ab dieser Woche.",
  communityAdminAuto: (goal: number) => `Automatisch diese Woche: ${num(goal)}`,
  communityGuide:
    "Gemeinsames Wochenziel: Alle Anwahlen der Woche von Montag bis Sonntag zählen zusammen, eigene, übernommene und gemeinsame Meldungen, jede genau einmal. Das Ziel legt das Team fest.",
};
