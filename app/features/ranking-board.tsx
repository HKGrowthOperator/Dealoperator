"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BellRing,
  CalendarCheck,
  ChartColumn,
  Check,
  ClipboardCheck,
  Copy,
  Flame,
  Handshake,
  Headphones,
  HeartHandshake,
  Medal,
  MessagesSquare,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import {
  aggregate,
  berlinDate,
  daySchema,
  isJoint,
  metricLabels,
  visibleMetrics,
  ranked,
  soloRows,
  type VisibleMetric,
} from "@/lib/kpis";
import {
  eventLabel,
  formatDay,
  formatMonth,
  metricShortLabels,
  monthRange,
  monthSchema,
  withPermanentEvents,
  type RankingEvent,
  type RankingMonth,
} from "@/lib/ranking-history";
import { DISCORD_INVITE } from "@/lib/discord";
import { SPLIT_NOTE, jointReport, splitOrigin } from "@/lib/joint-reports";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { OperatorHeader, OperatorFooter } from "./operator-shell";
import RankingHistory from "./ranking-history";

const fmt = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("de-DE");
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((part) => part !== "&" && part !== "und")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

/**
 * Getrennte Ranglisten. Dranbleiben ist eine eigene Wertung aus den Serien,
 * kein Mischwert aus Kennzahlen.
 */
const COMMITMENT = "dranbleiben";
type Choice = VisibleMetric | typeof COMMITMENT;
const primaryMetrics: VisibleMetric[] = [
  "attempts",
  "settingsBooked",
  "closingsBooked",
];
const secondaryMetrics: VisibleMetric[] = [
  "dealsWon",
  "settingsHeld",
  "closingsHeld",
];

type LoadedRanking = {
  key: string;
  data: RankingMonth | null;
  error: string;
  updated: string;
};
/** Öffentliche Dranbleiben-Zeile. Nie ein privater Status. */
type CommitmentRow = {
  id: string;
  name: string;
  company: string;
  streak: { current: number; best: number };
  activeDays: number;
  closedDays: number;
};
type LoadedCommitment = { key: string; rows: CommitmentRow[]; error: string };

function validEvents(value: unknown): RankingEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (event): event is RankingEvent =>
      !!event &&
      typeof event.day === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(event.day) &&
      typeof event.title === "string" &&
      event.title.length > 0,
  );
}
function validCommitment(value: unknown): CommitmentRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is CommitmentRow =>
      !!row &&
      typeof row.id === "string" &&
      typeof row.name === "string" &&
      typeof row.streak?.current === "number" &&
      typeof row.activeDays === "number",
  );
}

/**
 * Plätze für die bereits sortierte Serverliste. Gleiche Serien und gleiche
 * aktive Tage teilen sich einen Platz.
 */
function placeCommitment(rows: CommitmentRow[]) {
  const signature = (row: CommitmentRow) =>
    `${row.streak.current}|${row.activeDays}`;
  const places: number[] = [];
  rows.forEach((row, index) => {
    places.push(
      index > 0 && signature(rows[index - 1]) === signature(row)
        ? places[index - 1]
        : index + 1,
    );
  });
  return rows.map((row, index) => ({ ...row, rank: places[index] }));
}

const steps = [
  {
    icon: Headphones,
    title: "Beim Callen dranbleiben",
    text: "Du callst mit den anderen? Hier hältst du fest, was dabei rauskommt, und siehst, wie du vorankommst.",
  },
  {
    icon: ClipboardCheck,
    title: "Täglich festhalten",
    text: "Anwahlen, Settings und Closings plus eine kurze Reflexion: Was lief gut, was machst du beim nächsten Calling-Tag besser?",
  },
  {
    icon: TrendingUp,
    title: "Fortschritt sehen",
    text: "Tageswerte im Verlauf, der Monat im Überblick und deine Serie. Die gemeinsame Summe steht dabei vor den Einzelplätzen.",
  },
  {
    icon: BellRing,
    title: "Erinnert werden",
    text: "Wenn du Erinnerungen auf deinem Gerät einschaltest, kommt abends ein Hinweis, falls dein Abschluss noch fehlt. Es geht auch ohne.",
  },
  {
    icon: HeartHandshake,
    title: "Sich gegenseitig stützen",
    text: "Lies die Learnings der anderen. Antworten kannst du auf Discord, wenn du magst.",
    reflections: true,
    discord: "Discord öffnen",
  },
] as const;

export default function RankingBoard({
  discordUrl,
  onlyRanking = false,
}: {
  discordUrl?: string;
  /** /ranking: nur Ergebnisse, ohne Einstiegserklärung. */
  onlyRanking?: boolean;
}) {
  const params = useSearchParams();
  const discord = discordUrl || DISCORD_INVITE;
  const today = berlinDate();
  const parsedDay = daySchema.safeParse(params.get("day"));
  const parsedMonth = monthSchema.safeParse(params.get("month"));
  const monthly =
    params.has("month") && parsedMonth.success && !params.has("day");
  const day = parsedDay.success ? parsedDay.data : today;
  const month = monthly ? parsedMonth.data : day.slice(0, 7);
  const requested = params.get("metric");
  const choice: Choice =
    requested === COMMITMENT
      ? COMMITMENT
      : visibleMetrics.includes(requested as VisibleMetric)
        ? (requested as VisibleMetric)
        : "attempts";
  const commitmentView = choice === COMMITMENT;
  // Verlauf und Profil brauchen eine Kennzahl; bei Dranbleiben die Anwahlen.
  const metric: VisibleMetric = commitmentView ? "attempts" : choice;
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState<LoadedRanking | null>(null);
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [eventList, setEventList] = useState<RankingEvent[] | null>(null);
  const [commitment, setCommitment] = useState<LoadedCommitment | null>(null);
  const requestKey = `${month}/${monthly ? "month" : day}`;
  const current = loaded?.key === requestKey ? loaded : null;
  const data = current?.data;
  const loading = !current;
  const error = current?.error || "";
  const rows = useMemo(() => data?.rows || [], [data]);
  // ranked() lässt gemeinsame Meldungen nicht antreten. Die Gesamtleistung
  // rechnet weiter mit allen Zeilen, damit jede Meldung genau einmal zählt.
  const all = useMemo(() => ranked(rows, metric), [rows, metric]);
  const totals = useMemo(
    () => aggregate(rows.map((row) => row.counts)),
    [rows],
  );
  const joint = useMemo(() => rows.filter(isJoint), [rows]);
  const people = useMemo(() => soloRows(rows), [rows]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const needle = search.toLocaleLowerCase("de");
  const filtered = all.filter((row) =>
    `${row.name} ${row.company} ${row.role}`
      .toLocaleLowerCase("de")
      .includes(needle),
  );
  const podium = all.filter((row) => (row.counts[metric] ?? 0) > 0).slice(0, 3);
  const best = all[0]?.counts[metric] ?? 0;
  const periodLabel = monthly ? formatMonth(month) : formatDay(day);
  const newest = rows.reduce(
    (latest, row) => (row.updatedAt > latest ? row.updatedAt : latest),
    "",
  );

  // Gekennzeichnete Tage kommen vom Server. Ohne Antwort bleibt der
  // Akquise Day vom 22.09.2026 trotzdem gekennzeichnet.
  const events = useMemo(() => withPermanentEvents(eventList), [eventList]);
  const eventByDay = useMemo(
    () => new Map(events.map((event) => [event.day, event])),
    [events],
  );
  const event = monthly ? undefined : eventByDay.get(day);
  const otherEvents = events
    .filter(
      (item) =>
        item.day.startsWith(`${month}-`) &&
        item.day <= today &&
        (monthly || item.day !== day),
    )
    .toSorted((a, b) => a.day.localeCompare(b.day));
  // Geplante Event-Tage: nur als Hinweis, ein Ranking gibt es erst am Tag.
  const upcoming = events
    .filter((item) => item.day > today)
    .toSorted((a, b) => a.day.localeCompare(b.day))[0];

  // Dranbleiben: Serien mit Stand heute, aktive Tage im gewählten Monat.
  const range = monthRange(month, today);
  const commitmentKey = `${range.from}/${range.to}`;
  const commitmentState =
    commitment?.key === commitmentKey ? commitment : null;
  const commitmentRows = useMemo(
    () => placeCommitment(commitmentState?.rows || []),
    [commitmentState],
  );
  const commitmentFiltered = commitmentRows.filter((row) =>
    `${row.name} ${row.company}`.toLocaleLowerCase("de").includes(needle),
  );
  const runningStreaks = commitmentState?.error
    ? null
    : commitmentState
      ? commitmentState.rows.filter((row) => row.streak.current > 0).length
      : null;
  const latestReported =
    !monthly && data && rows.length === 0
      ? data.days.filter((entry) => entry.day !== day).at(-1)
      : undefined;

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function load() {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(
          `/api/ranking/month?month=${month}${monthly ? "" : `&day=${day}`}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await response.json();
        if (!response.ok)
          throw Error(
            payload.error || "Die Zahlen sind gerade nicht abrufbar.",
          );
        if (!controller.signal.aborted)
          setLoaded({
            key: requestKey,
            data: payload,
            error: "",
            updated: new Date().toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          });
      } catch (error) {
        // A failed refresh hides both the old totals and the old history.
        if (!controller.signal.aborted)
          setLoaded({
            key: requestKey,
            data: null,
            error: (error as Error).message,
            updated: "",
          });
      } finally {
        busy = false;
      }
    }
    void load();
    const interval = setInterval(() => {
      if (!document.hidden) void load();
    }, 20000);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [requestKey, month, day, monthly, retry]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/events", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw Error(payload.error);
        if (!controller.signal.aborted)
          setEventList(validEvents(payload.events));
      })
      .catch(() => {
        // Nicht erreichbar: der feste Akquise Day bleibt als Rückfall.
        if (!controller.signal.aborted) setEventList([]);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const [from, to] = commitmentKey.split("/");
    fetch(`/api/ranking/dranbleiben?from=${from}&to=${to}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw Error(
            payload.error || "Die Serien sind gerade nicht abrufbar.",
          );
        if (!controller.signal.aborted)
          setCommitment({
            key: commitmentKey,
            rows: validCommitment(payload.rows),
            error: "",
          });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setCommitment({
            key: commitmentKey,
            rows: [],
            error: (e as Error).message,
          });
      });
    return () => controller.abort();
  }, [commitmentKey, retry]);

  function navigate(
    period: { day: string } | { month: string },
    nextChoice: Choice = choice,
  ) {
    const next = new URLSearchParams({ ...period, metric: nextChoice });
    window.history.pushState(null, "", `${window.location.pathname}?${next}`);
    setSelectedId(null);
    setShareMessage("");
  }
  function choose(value: Choice) {
    navigate(monthly ? { month } : { day }, value);
  }
  async function share() {
    const url = `${window.location.origin}/ranking?${new URLSearchParams({ ...(monthly ? { month } : { day }), metric: choice })}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("Link kopiert");
    } catch {
      setShareMessage("Kopiere den Link aus der Adressleiste.");
    }
  }
  return (
    <div className="operator-site rr-site">
      <OperatorHeader discordUrl={discord} />
      <main className="rr-main">
        {onlyRanking ? (
          <section className="rr-intro rr-intro-compact">
            <span className="rr-eyebrow">
              <span className="rr-live-dot" /> ERGEBNISSE
            </span>
            <h1>Was alle zusammen schaffen.</h1>
            <p>
              Erst die gemeinsame Summe, dann die Einzelplätze. Tag und Monat getrennt,
              jede Kennzahl mit eigener Rangliste. Fehlende Meldungen zählen
              nicht als null.
            </p>
            <div className="rr-intro-actions">
              <Link href="/tagesabschluss" className="rr-cta-primary">
                <ClipboardCheck size={18} />
                Tagesabschluss machen
              </Link>
            </div>
          </section>
        ) : (
          <section className="rr-intro rr-hero" aria-labelledby="rr-title">
            <div className="rr-intro-copy">
              <span className="rr-eyebrow">
                <span className="rr-live-dot" /> FÜRS GEMEINSAME CALLEN
              </span>
              <h1 id="rr-title">
                Zusammen callen.
                <br />
                Gemeinsam <em>dranbleiben.</em>
              </h1>
              <p>
                Deal Operator unterstützt dich beim gemeinsamen Callen:
                regelmäßig dranbleiben, jeden Calling-Tag Zahlen und Learnings
                festhalten und sehen, wie du und alle, die mitcallen,
                vorankommen.
              </p>
              <div className="rr-intro-actions">
                <Link href="/tagesabschluss" className="rr-cta-primary">
                  <ClipboardCheck size={18} />
                  Tagesabschluss machen
                </Link>
                <a href="#ergebnisse" className="rr-intro-secondary">
                  <ChartColumn size={17} />
                  Ergebnisse ansehen
                </a>
              </div>
              <p className="rr-intro-note">
                Neu hier? <Link href="/starten">Kostenfrei starten</Link>
              </p>
            </div>
            <ol
              className="rr-steps"
              id="so-funktionierts"
              aria-label="So hilft dir Deal Operator dranzubleiben"
            >
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.title}
                    style={{ "--step": index } as CSSProperties}
                  >
                    <span className="rr-step-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <div>
                      <strong className="rr-step-title">{step.title}</strong>
                      <p>{step.text}</p>
                      {("reflections" in step || "discord" in step) && (
                        <span className="rr-step-links">
                          {"reflections" in step && (
                            <Link href="/reflexionen">Reflexionen lesen</Link>
                          )}
                          {"discord" in step && typeof step.discord === "string" && (
                            <a
                              href={discord}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {step.discord}
                            </a>
                          )}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <div className="rr-results-anchor" id="ergebnisse">
          {!onlyRanking && (
            <div className="rr-section-head">
              <span className="rr-eyebrow">ERGEBNISSE</span>
              <h2>Erst die gemeinsame Summe, dann die Einzelplätze.</h2>
            </div>
          )}
        </div>

        <section className="rr-toolbar" aria-label="Ranking-Zeitraum">
          <div className="rr-segment" role="group" aria-label="Ansicht">
            <button
              aria-pressed={!monthly}
              onClick={() =>
                navigate({
                  day: month === today.slice(0, 7) ? today : `${month}-01`,
                })
              }
            >
              Tag
            </button>
            <button aria-pressed={monthly} onClick={() => navigate({ month })}>
              Monat
            </button>
          </div>
          <label className="rr-period-input">
            <CalendarCheck size={17} />
            <span className="sr-only">
              {monthly ? "Ranking-Monat" : "Ranking-Tag"}
            </span>
            <input
              aria-label={monthly ? "Ranking-Monat" : "Ranking-Tag"}
              type={monthly ? "month" : "date"}
              min={monthly ? "2000-01" : "2000-01-01"}
              max={monthly ? today.slice(0, 7) : today}
              value={monthly ? month : day}
              onChange={(e) => {
                const parsed = (monthly ? monthSchema : daySchema).safeParse(
                  e.target.value,
                );
                if (parsed.success)
                  navigate(
                    monthly ? { month: parsed.data } : { day: parsed.data },
                  );
              }}
            />
          </label>
          <button
            className="rr-plain-button"
            onClick={() => navigate({ day: today })}
          >
            Heute
          </button>
          <span className="rr-toolbar-spacer" />
          <span className="rr-refresh-label">
            {error
              ? "Abruf fehlgeschlagen"
              : loading
                ? "Lädt …"
                : `Aktualisiert ${current?.updated}`}
          </span>
          <button
            className="rr-icon-button"
            onClick={() => setRetry((value) => value + 1)}
            aria-label="Ranking aktualisieren"
          >
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
          <button className="rr-share-button" onClick={share}>
            <Copy size={16} />
            <span>Ranking teilen</span>
          </button>
          {shareMessage && (
            <span className="rr-share-feedback" role="status">
              {shareMessage}
            </span>
          )}
        </section>

        {event && (
          <div className="rr-event-banner">
            <span className="rr-event-tag">
              <Sparkles size={15} /> {event.title.toLocaleUpperCase("de")}
            </span>
            <p>
              <strong>
                {eventLabel(event)} · {formatDay(event.day)}
              </strong>
              {event.thanks && <span>{event.thanks}</span>}
              {event.url && (
                <a href={event.url} target="_blank" rel="noopener noreferrer">
                  {event.partner || event.url.replace(/^https:\/\//, "")}
                </a>
              )}
              <small>
                Unten siehst du das Tagesranking dieses Tages. Die Leistung
                steckt genau einmal in Tages- und Monatswerten, ohne
                Zusatzwertung.
              </small>
            </p>
          </div>
        )}
        {(otherEvents.length > 0 || upcoming) && (
          <div className="rr-event-strip" aria-label="Gekennzeichnete Tage">
            {upcoming && (
              <p className="rr-event-upcoming">
                <CalendarCheck size={14} />
                <span>
                  Geplant: {eventLabel(upcoming)} am {formatDay(upcoming.day)}
                </span>
              </p>
            )}
            {otherEvents.map((item) => (
              <button
                key={item.day}
                onClick={() => navigate({ day: item.day })}
              >
                <Sparkles size={14} />
                <span>
                  {formatDay(item.day, true)} · {eventLabel(item)}
                </span>
                <small>Tagesranking ansehen</small>
              </button>
            ))}
          </div>
        )}

        {error ? (
          <div className="rr-state rr-glass" role="alert">
            <h2>Die Zahlen sind gerade nicht abrufbar.</h2>
            <p>{error}</p>
            <button
              className="btn primary"
              onClick={() => setRetry((value) => value + 1)}
            >
              Erneut laden
            </button>
          </div>
        ) : loading ? (
          <div className="rr-skeleton" role="status">
            <RefreshCw size={22} className="spin" />
            <span>Die gemeinsamen Zahlen werden geladen …</span>
          </div>
        ) : (
          data && (
            <>
              <section
                className="rr-scoreboard"
                aria-label={`Gruppenleistung: ${periodLabel}`}
              >
                <div className="rr-scoreboard-top">
                  <span className="rr-eyebrow">
                    {monthly
                      ? "GRUPPENLEISTUNG · MONAT"
                      : event
                        ? `GRUPPENLEISTUNG · ${event.title.toLocaleUpperCase("de")}`
                        : "GRUPPENLEISTUNG · TAG"}
                  </span>
                  <span className="rr-period-label">{periodLabel}</span>
                </div>
                <div className="rr-score-grid">
                  <div className="rr-main-score">
                    <span>
                      <Phone size={18} /> Anwahlen
                    </span>
                    <strong key={`${requestKey}-calls`}>
                      {fmt(totals.attempts)}
                    </strong>
                    <small>
                      {totals.attempts === null
                        ? "Noch nicht gemeldet"
                        : monthly
                          ? "Summe dieses Monats"
                          : "Tageswert"}
                    </small>
                  </div>
                  <div>
                    <span>
                      <CalendarCheck size={18} /> Settings
                    </span>
                    <strong>{fmt(totals.settingsBooked)}</strong>
                    <small>
                      {totals.settingsBooked === null
                        ? "Noch nicht gemeldet"
                        : "vereinbart"}
                    </small>
                  </div>
                  <div>
                    <span>
                      <Handshake size={18} /> Closings
                    </span>
                    <strong>{fmt(totals.closingsBooked)}</strong>
                    <small>
                      {totals.closingsBooked === null
                        ? "Noch nicht gemeldet"
                        : "vereinbart"}
                    </small>
                  </div>
                  <div>
                    <span>
                      <Users size={18} /> Am Start
                    </span>
                    <strong>{fmt(people.length)}</strong>
                    <small>
                      {people.length === 1 ? "Person" : "Personen"} mit Meldung
                      {joint.length > 0
                        ? ` · ${joint.length} gemeinsame ${joint.length === 1 ? "Meldung" : "Meldungen"}`
                        : ""}
                    </small>
                  </div>
                </div>
                <div className="rr-score-detail">
                  <button onClick={() => choose("dealsWon")}>
                    <strong>{fmt(totals.dealsWon)}</strong>{" "}
                    {totals.dealsWon === 1 ? "Deal gewonnen" : "Deals gewonnen"}
                  </button>
                  {runningStreaks !== null && (
                    <button onClick={() => choose(COMMITMENT)}>
                      <Flame size={13} />
                      <strong>{fmt(runningStreaks)}</strong>
                      {runningStreaks === 1 ? "laufende Serie" : "laufende Serien"}
                    </button>
                  )}
                </div>
                {latestReported && (
                  <p className="rr-score-hint">
                    Für diesen Tag ist noch nichts gemeldet.{" "}
                    <button
                      onClick={() => navigate({ day: latestReported.day })}
                    >
                      Letzten Tag mit Meldungen ansehen (
                      {formatDay(latestReported.day, true)})
                    </button>
                  </p>
                )}
                {data.label && (
                  <p className="rr-snapshot-label">{data.label}</p>
                )}
              </section>

              <section
                className="rr-competition"
                id="ranking"
                aria-label="Einzelplätze"
              >
                <div className="rr-ranking-heading">
                  <div>
                    <span className="rr-eyebrow">
                      EINZELPLÄTZE · {monthly ? "MONAT" : "TAG"}
                    </span>
                    <h2>
                      {commitmentView
                        ? "Serien"
                        : monthly
                          ? "Monatsranking"
                          : event
                            ? `Tagesranking ${event.title}`
                            : "Tagesranking"}
                    </h2>
                  </div>
                  <span>{periodLabel}</span>
                </div>
                <div
                  className="rr-metric-bar"
                  role="group"
                  aria-label="Rangliste wählen"
                >
                  {primaryMetrics.map((key) => (
                    <button
                      key={key}
                      aria-pressed={choice === key}
                      onClick={() => choose(key)}
                    >
                      {metricShortLabels[key]}
                    </button>
                  ))}
                  <button
                    aria-pressed={commitmentView}
                    onClick={() => choose(COMMITMENT)}
                    className="rr-commit-tab"
                  >
                    <Flame size={14} /> Dranbleiben
                  </button>
                  <label className="rr-more-metrics">
                    <span className="sr-only">Weitere Kennzahlen</span>
                    <select
                      aria-label="Weitere Kennzahlen"
                      value={
                        secondaryMetrics.includes(choice as VisibleMetric)
                          ? choice
                          : ""
                      }
                      onChange={(e) => {
                        if (e.target.value)
                          choose(e.target.value as VisibleMetric);
                      }}
                    >
                      <option value="" disabled>
                        Weitere Kennzahlen
                      </option>
                      {secondaryMetrics.map((key) => (
                        <option value={key} key={key}>
                          {metricLabels[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="rr-ranking-context">
                  {commitmentView ? (
                    <span>
                      Sortiert nach aktueller <strong>Serie</strong>, dann
                      aktiven Tagen.
                    </span>
                  ) : (
                    <span>
                      Sortiert nach <strong>{metricLabels[metric]}</strong>
                      {monthly ? " im Monat" : " an diesem Tag"}. Jede
                      Kennzahl hat ihre eigene Rangliste.
                    </span>
                  )}
                </div>
                {!commitmentView && podium.length > 0 && (
                  <div
                    className="rr-podium"
                    key={`${requestKey}-${metric}`}
                    aria-label={`Spitzenplätze nach ${metricLabels[metric]}`}
                  >
                    {podium.map((row, index) => (
                      <button
                        className="rr-podium-card"
                        key={row.id}
                        data-place={row.rank}
                        data-position={index}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <div className="rr-podium-top">
                          <span>
                            {row.rank === 1 ? (
                              <Trophy size={16} />
                            ) : (
                              <Medal size={16} />
                            )}{" "}
                            PLATZ {row.rank}
                          </span>
                        </div>
                        <span className="rr-podium-avatar">
                          {initials(row.name)}
                        </span>
                        <span className="rr-podium-person">
                          <h3>{row.name}</h3>
                          <span className="rr-podium-role">
                            {row.company || "Caller"}
                          </span>
                        </span>
                        <span className="rr-podium-score">
                          <strong className="rr-podium-value">
                            {fmt(row.counts[metric])}
                          </strong>
                          <span className="rr-podium-metric">
                            {metricShortLabels[metric]}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="rr-board-layout">
                  <div className="rr-leaderboard rr-glass">
                    <div className="rr-list-top">
                      <h3>
                        {commitmentView
                          ? "Dranbleiben"
                          : `Gemeldet: ${metricShortLabels[metric]}`}{" "}
                        <span>
                          {commitmentView
                            ? search
                              ? `${commitmentFiltered.length} von ${commitmentRows.length}`
                              : commitmentRows.length
                            : search
                              ? `${filtered.length} von ${all.length}`
                              : all.length}
                        </span>
                      </h3>
                      <label className="rr-search">
                        <Search size={17} />
                        <input
                          aria-label="Person suchen"
                          placeholder="Name suchen"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                          <button
                            onClick={() => setSearch("")}
                            aria-label="Suche zurücksetzen"
                          >
                            ×
                          </button>
                        )}
                      </label>
                    </div>
                    {commitmentView ? (
                      !commitmentState ? (
                        <div className="rr-empty" role="status">
                          <RefreshCw size={24} className="spin" />
                          <p>Die Serien werden geladen …</p>
                        </div>
                      ) : commitmentState.error ? (
                        <div className="rr-empty" role="alert">
                          <h3>Die Serien sind gerade nicht abrufbar.</h3>
                          <p>{commitmentState.error}</p>
                          <button
                            className="btn primary"
                            onClick={() => setRetry((value) => value + 1)}
                          >
                            Erneut laden
                          </button>
                        </div>
                      ) : commitmentFiltered.length ? (
                        <ol
                          className="rr-rank-list rr-commit-list"
                          aria-label="Rangliste Dranbleiben"
                        >
                          {commitmentFiltered.map((row, index) => (
                            <li
                              key={row.id}
                              data-place={row.rank}
                              style={
                                {
                                  "--row-delay": `${Math.min(index, 12) * 22}ms`,
                                } as CSSProperties
                              }
                            >
                              <div className="rr-commit-row">
                                <span className="rr-place">
                                  <span className="sr-only">Platz </span>
                                  {row.rank}
                                </span>
                                <span className="rr-rank-name">
                                  <strong>{row.name}</strong>
                                  <small>{row.company || "Caller"}</small>
                                </span>
                                <dl className="rr-commit-stats">
                                  <div data-lead="true">
                                    <dt>Serie</dt>
                                    <dd>
                                      <strong>
                                        {fmt(row.streak.current)}
                                      </strong>
                                      <small>
                                        Bestwert {fmt(row.streak.best)}
                                      </small>
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Aktive Tage</dt>
                                    <dd>
                                      <strong>{fmt(row.activeDays)}</strong>
                                      <small>
                                        {fmt(row.closedDays)}{" "}
                                        {row.closedDays === 1
                                          ? "Abschluss"
                                          : "Abschlüsse"}
                                      </small>
                                    </dd>
                                  </div>
                                </dl>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="rr-empty">
                          <Flame size={27} />
                          <h3>
                            {search
                              ? "Kein Profil gefunden."
                              : "Noch keine öffentlichen Serien."}
                          </h3>
                          <p>
                            {search
                              ? "Versuche einen anderen Namen."
                              : "Hier erscheinen Personen, die ihren Tagesabschluss selbst einreichen und der öffentlichen Anzeige zugestimmt haben."}
                          </p>
                          {!search && (
                            <Link
                              href="/tagesabschluss"
                              className="btn primary"
                            >
                              Tagesabschluss machen
                            </Link>
                          )}
                        </div>
                      )
                    ) : filtered.length ? (
                      <ol
                        className="rr-rank-list"
                        key={`${requestKey}-${metric}`}
                        aria-label={`Rangliste nach ${metricLabels[metric]}`}
                      >
                        {filtered.map((row, index) => (
                          <li
                            key={row.id}
                            data-place={row.rank ?? undefined}
                            style={
                              {
                                "--row-delay": `${Math.min(index, 12) * 22}ms`,
                              } as CSSProperties
                            }
                          >
                            <button
                              className="rr-rank-row"
                              onClick={() => setSelectedId(row.id)}
                              aria-label={`${row.name}, Platz ${row.rank}, ${fmt(row.counts[metric])} ${metricShortLabels[metric]}`}
                            >
                              <span className="rr-place">{row.rank}</span>
                              <span className="rr-rank-name">
                                <strong>
                                  {row.name}
                                  {row.claimed && (
                                    <ShieldCheck
                                      size={13}
                                      aria-label="Profil übernommen"
                                    />
                                  )}
                                </strong>
                                <small>
                                  {row.company || "Caller"}
                                </small>
                              </span>
                              <span className="rr-rank-value">
                                <strong>{fmt(row.counts[metric])}</strong>
                                <small>{metricShortLabels[metric]}</small>
                              </span>
                              <span className="rr-progress" aria-hidden="true">
                                <i
                                  style={{
                                    width:
                                      best > 0 && row.counts[metric] !== null
                                        ? `${(row.counts[metric]! / best) * 100}%`
                                        : "0%",
                                  }}
                                />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="rr-empty">
                        <Phone size={27} />
                        <h3>
                          {search
                            ? "Kein Profil gefunden."
                            : people.length > 0
                              ? `Noch keine Meldung für ${metricShortLabels[metric]}.`
                              : "Für diesen Zeitraum ist noch nichts gemeldet."}
                        </h3>
                        <p>
                          {search
                            ? "Versuche einen anderen Namen."
                            : people.length > 0
                              ? "Für andere Kennzahlen gibt es Meldungen. Wechsle oben die Auswahl."
                              : `Für ${monthly ? "diesen Monat" : "diesen Tag"} sind noch keine öffentlichen Zahlen gemeldet. Wähle einen Tag im Archiv oder halte deinen Calling-Tag im Tagesabschluss fest.`}
                        </p>
                        {!search && (
                          <Link href="/tagesabschluss" className="btn primary">
                            Tagesabschluss machen
                          </Link>
                        )}
                      </div>
                    )}
                    {!commitmentView && joint.length > 0 && (
                      <div className="rr-joint">
                        <div className="rr-joint-head">
                          <h4>Gemeinsame Meldungen</h4>
                          <span>Quelle, kein eigener Rang</span>
                        </div>
                        <ul>
                          {joint.map((row) => {
                            const origin = jointReport(row.key);
                            const reported = origin?.report[metric];
                            return (
                              <li key={row.id}>
                                <button onClick={() => setSelectedId(row.id)}>
                                  <Users size={15} />
                                  <span>
                                    {row.name}
                                    {origin && (
                                      <small>
                                        {origin.reportedAt} Uhr · 50/50
                                        aufgeteilt
                                      </small>
                                    )}
                                  </span>
                                  <strong>
                                    {fmt(
                                      reported ?? row.counts[metric] ?? null,
                                    )}
                                  </strong>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                        <p>
                          Eine gemeinsam erbrachte Leistung tritt nicht gegen
                          einzelne Personen an. Die gezeigten Werte sind die
                          Originalmeldung; sie stecken bereits in den
                          Einzelzahlen und werden nicht zusätzlich gezählt.
                        </p>
                      </div>
                    )}
                    <div className="rr-table-caption">
                      {commitmentView ? (
                        <>
                          <span>
                            Die Serie zählt jeden rechtzeitig eingereichten
                            Tagesabschluss mit Reflexion an Calling-Tagen, auch
                            mit 0 Anwahlen. Wochenenden sind keine
                            Calling-Tage.
                          </span>
                          <span>
                            Serie: Stand heute. Aktive Tage und Abschlüsse:{" "}
                            {formatMonth(month)}. Nur eigene Tagesabschlüsse
                            mit öffentlicher Anzeige.
                          </span>
                        </>
                      ) : (
                        <>
                          <span>
                            Nur Personen mit einer Meldung für diese Kennzahl.
                            0 ist eine Meldung, keine Meldung ist keine 0.
                          </span>
                          <span>Gleiche Werte teilen sich einen Rang.</span>
                        </>
                      )}
                    </div>
                    {!commitmentView && newest && (
                      <p className="rr-data-updated">
                        Letzte Meldung aktualisiert am{" "}
                        {new Date(newest).toLocaleString("de-DE", {
                          timeZone: "Europe/Berlin",
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        Uhr
                      </p>
                    )}
                  </div>
                  <aside className="rr-aside">
                    <div className="rr-mobile-tools">
                      <button
                        aria-expanded={archiveOpen}
                        aria-controls="ranking-archive"
                        onClick={() => setArchiveOpen((open) => !open)}
                      >
                        <CalendarCheck size={16} />
                        {archiveOpen
                          ? "Verlauf schließen"
                          : "Tagesverlauf & Archiv"}
                      </button>
                      <Link href="/reflexionen">
                        <MessagesSquare size={16} />
                        Reflexionen
                      </Link>
                    </div>
                    <div
                      className="rr-aside-content"
                      id="ranking-archive"
                      data-expanded={archiveOpen}
                    >
                      <RankingHistory
                        month={month}
                        days={data.days}
                        metric={metric}
                        selectedDay={monthly ? undefined : day}
                        today={today}
                        events={events}
                        onDay={(value) => {
                          navigate({ day: value });
                          setArchiveOpen(false);
                        }}
                      />
                      <div className="rr-exchange rr-glass">
                        <span className="rr-eyebrow">
                          <MessagesSquare size={14} /> AUSTAUSCH
                        </span>
                        <h3>Learnings teilen, Call-Partner finden.</h3>
                        <p>
                          Angemeldet mit eigenem Profil und hinterlegter
                          Telefonnummer liest du unter Reflexionen, was bei
                          anderen funktioniert hat. Antworten und die Suche
                          nach einem Call-Partner gehen auf Discord, wenn du
                          magst.
                        </p>
                        <div className="rr-exchange-links">
                          <Link href="/reflexionen">Reflexionen lesen</Link>
                          <a
                            href={discord}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Headphones size={15} />
                            Discord öffnen
                          </a>
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>
              </section>
              <section className="rr-next-step rr-glass">
                <div className="rr-next-icon">
                  <ShieldCheck size={27} />
                </div>
                <div>
                  <h2>Deine Zahlen stehen schon im Ranking?</h2>
                  <p>
                    Wenn du deine Zahlen künftig selbst eintragen möchtest,
                    kannst du dein Profil übernehmen, nach E-Mail-Bestätigung
                    und kurzer Prüfung durch das Team.
                  </p>
                </div>
                <Link className="btn primary" href="/starten">
                  Zahlen übernehmen
                </Link>
              </section>
            </>
          )
        )}
      </main>
      <OperatorFooter discordUrl={discord} />
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="operator-dialog rr-profile-dialog">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              {selected && isJoint(selected)
                ? "Gemeinsam gemeldete Leistung mehrerer Personen"
                : selected?.company || "Caller"}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <div className="rr-profile-period">
                <CalendarCheck size={16} />
                {periodLabel}
                {event && <span>{event.title}</span>}
              </div>
              <div className="profile-kpis">
                {visibleMetrics.map((key) => (
                  <div key={key}>
                    <span>{metricLabels[key]}</span>
                    <strong>{fmt(selected.counts[key])}</strong>
                  </div>
                ))}
              </div>
              {(() => {
                const origin = splitOrigin(selected.key);
                const own = jointReport(selected.key);
                if (origin)
                  return (
                    <p className="rr-split-note">
                      <strong>{SPLIT_NOTE}</strong>
                      Die gemeinsame Meldung von {origin.name} um{" "}
                      {origin.reportedAt} Uhr wurde je zur Hälfte auf die
                      beteiligten Personen gerechnet. Es sind zugeteilte, keine
                      einzeln gemeldeten Werte.
                      {origin.kept.map((k) => (
                        <span key={k.metric}>{k.why}</span>
                      ))}
                    </p>
                  );
                if (own)
                  return (
                    <p className="rr-split-note">
                      <strong>
                        Gemeinsame Meldung um {own.reportedAt} Uhr
                      </strong>
                      Ursprünglich gemeldet:{" "}
                      {visibleMetrics
                        .filter((m) => own.report[m] != null)
                        .map((m) => `${own.report[m]} ${metricLabels[m]}`)
                        .join(", ") || "keine öffentliche Kennzahl"}
                      {own.report.legacyMeetings != null
                        ? `, ${own.report.legacyMeetings} Termine ohne Typangabe`
                        : ""}
                      . Diese Werte sind 50/50 auf{" "}
                      {own.parts.map((p) => p.name).join(" und ")} verteilt und
                      stecken dort in den Einzelzahlen. Sie werden hier nicht
                      noch einmal mitgezählt.
                      {own.kept.map((k) => (
                        <span key={k.metric}>{k.why}</span>
                      ))}
                    </p>
                  );
                return (
                  <p className="hint">
                    Die Werte gelten für{" "}
                    {monthly ? "den ausgewählten Monat" : "diesen Tag"}. Gleiche
                    Werte teilen sich einen Rang. Nicht gemeldete Kennzahlen
                    bleiben offen.
                  </p>
                );
              })()}
              {isJoint(selected) ? (
                <p className="hint">
                  Diese Meldung gehört mehreren Personen und lässt sich nicht
                  als persönliches Profil übernehmen. Melde dich mit deinen
                  eigenen Zahlen an.
                </p>
              ) : (
                !selected.claimed && (
                  <Link
                    className="btn primary"
                    href={`/starten?profil=${encodeURIComponent(selected.id)}`}
                  >
                    <Check size={17} />
                    Das sind meine Zahlen
                  </Link>
                )
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
