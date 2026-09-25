"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Clock3,
  ExternalLink,
  Handshake,
  Headphones,
  Link2,
  Medal,
  NotebookPen,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  UsersRound,
  X,
} from "lucide-react";
import {
  aggregate,
  berlinDate,
  daySchema,
  isJoint,
  metricLabels,
  visibleMetrics,
  placed,
  soloRows,
  type Counts,
  type RankingRow,
} from "@/lib/kpis";
import {
  eventLabel,
  formatDay,
  formatMonth,
  monthRange,
  monthSchema,
  withPermanentEvents,
  type RankingEvent,
  type RankingMonth,
} from "@/lib/ranking-history";
import { DISCORD_INVITE } from "@/lib/discord";
import { SPLIT_NOTE, jointReport, splitOrigin } from "@/lib/joint-reports";
import type { HomeState } from "@/server/home";
import { OperatorHeader, OperatorFooter, type Viewer } from "./operator-shell";
import RankingHistory from "./ranking-history";

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : v.toLocaleString("de-DE");

/**
 * Eine Rangliste: die Reihenfolge folgt der verdeckten Wertung (placed()),
 * gezeigt werden die Zahlen selbst. Die Abschluss-Serie ist eine eigene
 * Wertung aus den Tagesabschlüssen und steht als zweite Ansicht daneben.
 */
const COMMITMENT = "dranbleiben";
const RANKING = "rangliste";
type Choice = typeof RANKING | typeof COMMITMENT;
/** Die drei Zahlen jeder Zeile, in fester Reihenfolge. */
const SHOWN = ["attempts", "settingsBooked", "closingsBooked"] as const;
const SHOWN_LABEL = { attempts: "Anwahlen", settingsBooked: "Settings", closingsBooked: "Closings" } as const;
/** „127 Anwahlen · 4 Settings · 0 Closings“, dazu Deals, wenn gemeldet und über 0. */
function numbersLine(counts: Counts) {
  const parts = SHOWN.map((k) => `${fmt(counts[k])} ${SHOWN_LABEL[k]}`);
  if (counts.dealsWon) parts.push(`${fmt(counts.dealsWon)} ${counts.dealsWon === 1 ? "Deal" : "Deals"}`);
  return parts.join(" · ");
}
/** Die Zahlen einer Zeile nebeneinander; keine davon ist „die“ Wertung. */
function NumberTrio({ counts, compact = false }: { counts: Counts; compact?: boolean }) {
  return (
    <span className="rb-trio" data-compact={compact || undefined}>
      {SHOWN.map((k) => (
        <span key={k}>
          <strong>{fmt(counts[k])}</strong>
          <small>{SHOWN_LABEL[k]}</small>
        </span>
      ))}
      {!!counts.dealsWon && (
        <span>
          <strong>{fmt(counts.dealsWon)}</strong>
          <small>{counts.dealsWon === 1 ? "Deal" : "Deals"}</small>
        </span>
      )}
    </span>
  );
}

type Loaded = {
  key: string;
  data: (RankingMonth & { day?: string; latest?: { day: string; fallback: boolean } }) | null;
  error: string;
  updated: string;
};
/** Öffentliche Serien-Zeile. Nie ein privater Status. */
type CommitmentRow = {
  id: string;
  name: string;
  company: string;
  /** Rang „Aktiver Caller“. */
  active?: boolean;
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
/** Gleiche Serien und gleiche aktive Tage teilen sich einen Platz. */
function placeCommitment(rows: CommitmentRow[]) {
  const signature = (row: CommitmentRow) => `${row.streak.current}|${row.activeDays}`;
  const places: number[] = [];
  rows.forEach((row, index) => {
    places.push(
      index > 0 && signature(rows[index - 1]) === signature(row) ? places[index - 1] : index + 1,
    );
  });
  return rows.map((row, index) => ({ ...row, rank: places[index] }));
}
/** Spitzenplatz für die Gestaltung: 1 bis 3, nur mit positivem Wert. */
const medal = (place: number, value: number | null | undefined) =>
  value && value > 0 && place <= 3 ? (["gold", "silver", "bronze"] as const)[place - 1] : undefined;

/** Dieselben drei Schritte wie auf /so-funktionierts. */
const steps = [
  {
    title: "Callen",
    text: "Du callst wie gewohnt, an Calling-Tagen von Montag bis Freitag.",
  },
  {
    title: "Zahlen eintragen",
    text: "Anwahlen, Settings und Closings eintragen, dazu zwei kurze Fragen: Was lief gut, was machst du beim nächsten Mal besser?",
  },
  {
    title: "Sehen, was entsteht",
    text: "Mit deiner Zustimmung zählen deine Zahlen in der gemeinsamen Summe und in der Rangliste. Unter Reflexionen liest du, was bei anderen funktioniert hat.",
  },
];

/** Tag bzw. Monat um n verschieben (Kalenderrechnung ohne Zeitzone). */
function shiftDay(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function shiftMonth(month: string, n: number) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default function RankingBoard({
  discordUrl,
  onlyRanking = false,
  viewer = null,
  home = null,
}: {
  discordUrl?: string;
  /** /ranking: nur Ergebnisse, ohne Einstieg und Erklärung. */
  onlyRanking?: boolean;
  /** Anmeldestand vom Server. */
  viewer?: Viewer | null;
  /** Persönlicher Stand für den Abschnitt „Mein Tag“. */
  home?: HomeState | null;
}) {
  const params = useSearchParams();
  const discord = discordUrl || DISCORD_INVITE;
  const today = berlinDate();
  const parsedDay = daySchema.safeParse(params.get("day"));
  const parsedMonth = monthSchema.safeParse(params.get("month"));
  const monthly = params.has("month") && parsedMonth.success && !params.has("day");
  // Ohne gewählten Zeitraum: heute bzw. der letzte gemeldete Tag.
  const latestMode = !parsedDay.success && !monthly;
  // Ältere Links tragen noch eine Kennzahl im Parameter; sie führen alle
  // zur einen Rangliste. Nur die Abschluss-Serie ist eine eigene Ansicht.
  const choice: Choice = params.get("metric") === COMMITMENT ? COMMITMENT : RANKING;
  const commitmentView = choice === COMMITMENT;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [eventList, setEventList] = useState<RankingEvent[] | null>(null);
  const [commitment, setCommitment] = useState<LoadedCommitment | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const requestKey = latestMode
    ? "latest"
    : monthly
      ? `month/${parsedMonth.data}`
      : `day/${parsedDay.data}`;
  const current = loaded?.key === requestKey ? loaded : null;
  const data = current?.data ?? null;
  const loading = !current;
  const error = current?.error || "";
  const day = parsedDay.success ? parsedDay.data : (data?.latest?.day ?? today);
  const month = monthly ? parsedMonth.data! : day.slice(0, 7);
  const fallback = latestMode && !!data?.latest?.fallback;

  const rows = useMemo(() => data?.rows || [], [data]);
  // ranked() lässt gemeinsame Meldungen nicht antreten. Die Summe rechnet mit
  // allen Zeilen, damit jede Meldung genau einmal zählt.
  const all = useMemo(() => placed(rows), [rows]);
  const totals = useMemo(() => aggregate(rows.map((row) => row.counts)), [rows]);
  const joint = useMemo(() => rows.filter(isJoint), [rows]);
  const people = useMemo(() => soloRows(rows), [rows]);
  const needle = search.trim().toLocaleLowerCase("de");
  const matches = (row: { name: string; company: string }) =>
    `${row.name} ${row.company}`.toLocaleLowerCase("de").includes(needle);
  const filtered = all.filter(matches);
  const best = all[0]?.score ?? 0;
  const ownId = home?.participant?.id ?? null;
  const own = ownId ? all.find((row) => row.id === ownId) : undefined;
  const periodLabel = monthly ? formatMonth(month) : formatDay(day);
  const newest = rows.reduce((latest, row) => (row.updatedAt > latest ? row.updatedAt : latest), "");

  const events = useMemo(() => withPermanentEvents(eventList), [eventList]);
  const eventByDay = useMemo(() => new Map(events.map((e) => [e.day, e])), [events]);
  const event = monthly ? undefined : eventByDay.get(day);
  const upcoming = events
    .filter((item) => item.day > today)
    .toSorted((a, b) => a.day.localeCompare(b.day))[0];

  // Abschluss-Serie: Stand heute, aktive Tage im gewählten Monat.
  const range = monthRange(month, today);
  const commitmentKey = `${range.from}/${range.to}`;
  const commitmentState = commitment?.key === commitmentKey ? commitment : null;
  const commitmentRows = useMemo(
    () => placeCommitment(commitmentState?.rows || []),
    [commitmentState],
  );
  const commitmentFiltered = commitmentRows.filter(matches);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const url = latestMode
      ? "/api/ranking/month?latest=1"
      : monthly
        ? `/api/ranking/month?month=${parsedMonth.data}`
        : `/api/ranking/month?month=${parsedDay.data!.slice(0, 7)}&day=${parsedDay.data}`;
    async function load() {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw Error(payload.error || "Die Zahlen sind gerade nicht abrufbar.");
        if (!controller.signal.aborted)
          setLoaded({
            key: requestKey,
            data: payload,
            error: "",
            updated: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
          });
      } catch (e) {
        if (!controller.signal.aborted)
          setLoaded({ key: requestKey, data: null, error: (e as Error).message, updated: "" });
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
    // Die URL-Teile stecken vollständig in requestKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, retry]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/events", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw Error(payload.error);
        if (!controller.signal.aborted) setEventList(validEvents(payload.events));
      })
      .catch(() => {
        // Nicht erreichbar: der feste Akquise Day bleibt als Rückfall.
        if (!controller.signal.aborted) setEventList([]);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!commitmentView) return;
    const controller = new AbortController();
    const [from, to] = commitmentKey.split("/");
    fetch(`/api/ranking/dranbleiben?from=${from}&to=${to}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw Error(payload.error || "Die Serien sind gerade nicht abrufbar.");
        if (!controller.signal.aborted)
          setCommitment({ key: commitmentKey, rows: validCommitment(payload.rows), error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setCommitment({ key: commitmentKey, rows: [], error: (e as Error).message });
      });
    return () => controller.abort();
  }, [commitmentKey, commitmentView, retry]);

  function navigate(period: { day: string } | { month: string } | null, nextChoice: Choice = choice) {
    const next = new URLSearchParams(period ?? {});
    if (nextChoice === COMMITMENT) next.set("metric", nextChoice);
    const query = next.toString();
    window.history.pushState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    setOpenId(null);
    setShareMessage("");
  }
  function choose(value: Choice) {
    navigate(latestMode ? null : monthly ? { month } : { day }, value);
  }
  async function share() {
    const url = `${window.location.origin}/ranking?${new URLSearchParams({ ...(monthly ? { month } : { day }), ...(commitmentView ? { metric: COMMITMENT } : {}) })}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("Link kopiert");
    } catch {
      setShareMessage("Kopiere den Link aus der Adressleiste.");
    }
  }
  function showOwn() {
    if (own) showRow(own.id);
  }
  /** Zeile öffnen, hinscrollen und kurz aufleuchten lassen. */
  function showRow(id: string) {
    setSearch("");
    setOpenId(id);
    window.setTimeout(() => {
      const row = document.getElementById(`rb-row-${id}`);
      if (!row) return;
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      // Kurzes, ruhiges Aufleuchten der eigenen Zeile.
      row.removeAttribute("data-flash");
      void row.offsetWidth;
      row.setAttribute("data-flash", "");
    }, 0);
  }

  const signedIn = viewer?.signedIn ?? !!home;
  const KPI_ICON = { attempts: Phone, settingsBooked: CalendarCheck, closingsBooked: Handshake, people: UsersRound } as const;
  const kpis: { key: keyof typeof KPI_ICON; label: string; value: number | null; note: string }[] = [
    { key: "attempts", label: "Anwahlen", value: totals.attempts, note: totals.attempts === null ? "Noch nicht gemeldet" : monthly ? "im Monat" : "an diesem Tag" },
    { key: "settingsBooked", label: "Settings", value: totals.settingsBooked, note: totals.settingsBooked === null ? "Noch nicht gemeldet" : "vereinbart" },
    { key: "closingsBooked", label: "Closings", value: totals.closingsBooked, note: totals.closingsBooked === null ? "Noch nicht gemeldet" : "vereinbart" },
    { key: "people", label: "Am Start", value: people.length, note: people.length === 1 ? "Person mit Meldung" : "Personen mit Meldung" },
  ];

  return (
    <div className="operator-site">
      <OperatorHeader discordUrl={discord} viewer={viewer} />
      <main id="inhalt" className="do-page rb">
        {!onlyRanking && !signedIn && (
          <section className="rb-intro" aria-labelledby="rb-title">
            <h1 id="rb-title">Zusammen callen. Gemeinsam dranbleiben.</h1>
            <p>
              Hier siehst du, was alle zusammen schaffen, und hältst deinen eigenen Calling-Tag fest,
              kostenfrei.
            </p>
            <div className="rb-intro-actions">
              <Link className="do-button do-button-primary" href="/starten?weg=neu">
                Kostenfrei starten
              </Link>
              <Link className="do-button do-button-secondary" href="/starten?weg=profil">
                Meine Zahlen sind schon hier
              </Link>
            </div>
          </section>
        )}
        {(onlyRanking || signedIn) && <h1 className="do-sr">Ergebnisse</h1>}
        {signedIn && home && <PersonalPanel home={home} />}
        {signedIn && home?.participant && <DiscordPanel url={discord} />}

        <section className="rb-results" id="ergebnisse" aria-labelledby="rb-results-title">
          <div className="rb-results-head">
            <div>
              <h2 id="rb-results-title">Gemeinsam erreicht</h2>
              <p className="rb-period">
                <span className="rb-period-date">{periodLabel}</span>
                {fallback && <span className="rb-tag">Letzter gemeldeter Tag</span>}
                {event && (
                  <span className="rb-tag rb-tag-event">
                    <Sparkles size={14} aria-hidden="true" /> {event.title}
                  </span>
                )}
                {(monthly || day !== today) && (
                  <button type="button" className="rb-today" onClick={() => navigate({ day: today })}>
                    Zu heute
                  </button>
                )}
              </p>
            </div>
            <div className="rb-period-tools">
              <div className="rb-segment" role="group" aria-label="Zeitraum">
                <button
                  type="button"
                  aria-pressed={!monthly}
                  onClick={() =>
                    navigate(
                      month === today.slice(0, 7)
                        ? null
                        : { day: data?.days.at(-1)?.day ?? `${month}-01` },
                    )
                  }
                >
                  Tag
                </button>
                <button type="button" aria-pressed={monthly} onClick={() => navigate({ month })}>
                  Monat
                </button>
              </div>
              {/* Das Datum steht schon links; hier nur blättern und wählen. */}
              <div className="rb-stepper" role="group" aria-label={monthly ? "Monat wechseln" : "Tag wechseln"}>
                <button
                  type="button"
                  aria-label={monthly ? "Vorheriger Monat" : "Vorheriger Tag"}
                  onClick={() =>
                    navigate(monthly ? { month: shiftMonth(month, -1) } : { day: shiftDay(day, -1) })
                  }
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                {!monthly && (
                  <label className="rb-date-pick">
                    <CalendarDays size={18} aria-hidden="true" />
                    <span className="do-sr">Tag wählen</span>
                    <input
                      type="date"
                      min="2000-01-01"
                      max={today}
                      value={day}
                      onClick={(e) => {
                        try {
                          e.currentTarget.showPicker?.();
                        } catch {
                          /* ältere Browser öffnen den Kalender selbst */
                        }
                      }}
                      onChange={(e) => {
                        const parsed = daySchema.safeParse(e.target.value);
                        if (parsed.success) navigate({ day: parsed.data });
                      }}
                    />
                  </label>
                )}
                <button
                  type="button"
                  aria-label={monthly ? "Nächster Monat" : "Nächster Tag"}
                  disabled={monthly ? month >= today.slice(0, 7) : day >= today}
                  onClick={() =>
                    navigate(monthly ? { month: shiftMonth(month, 1) } : { day: shiftDay(day, 1) })
                  }
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          {event && (event.thanks || event.url) && (
            <p className="rb-note rb-note-event">
              {event.thanks}{" "}
              {event.url && (
                <a href={event.url} target="_blank" rel="noopener noreferrer">
                  {event.partner || event.url.replace(/^https:\/\//, "")}
                </a>
              )}
            </p>
          )}

          {error ? (
            <div className="rb-state" role="alert">
              <p>
                <strong>Die Zahlen sind gerade nicht abrufbar.</strong> {error}
              </p>
              <button type="button" className="do-button do-button-secondary" onClick={() => setRetry((v) => v + 1)}>
                Erneut laden
              </button>
            </div>
          ) : (
            <div className="rb-kpis" data-loading={loading || undefined} aria-busy={loading}>
              {kpis.map((kpi) => (
                <div key={kpi.key} className="rb-kpi">
                  <span className="rb-kpi-label">
                    {(() => {
                      const Icon = KPI_ICON[kpi.key as keyof typeof KPI_ICON];
                      return Icon ? <Icon size={17} aria-hidden="true" /> : null;
                    })()}
                    {kpi.label}
                  </span>
                  <strong key={`${requestKey}-${kpi.key}`} className="rb-kpi-value">
                    {loading ? " " : fmt(kpi.value)}
                  </strong>
                  <span className="rb-kpi-note">{loading ? "Wird geladen" : kpi.note}</span>
                </div>
              ))}
            </div>
          )}
          {!error && !loading && (
            <p className="rb-kpi-foot">
              {totals.dealsWon !== null && (
                <span>
                  {fmt(totals.dealsWon)} {totals.dealsWon === 1 ? "Deal gewonnen" : "Deals gewonnen"}
                </span>
              )}
              {joint.length > 0 && (
                <span>
                  {joint.length} gemeinsame {joint.length === 1 ? "Meldung" : "Meldungen"}
                </span>
              )}
              {data?.label && <span>{data.label}</span>}
            </p>
          )}
          {!error && !loading && upcoming && (
            <p className="rb-upcoming">
              <CalendarDays size={16} aria-hidden="true" /> Geplant: {eventLabel(upcoming)} am{" "}
              {formatDay(upcoming.day)}
            </p>
          )}
        </section>

        <section className="rb-ranking" id="ranking" aria-labelledby="rb-ranking-title">
          <div className="rb-section-head">
            <h2 id="rb-ranking-title">Rangliste</h2>
            <span>
              {commitmentView
                ? "Abschluss-Serie, Stand heute"
                : monthly
                  ? formatMonth(month)
                  : formatDay(day, true)}
            </span>
          </div>
          <div className="rb-filters">
            <div className="rb-tabs" role="group" aria-label="Ansicht">
              <button type="button" aria-pressed={!commitmentView} onClick={() => choose(RANKING)}>
                Rangliste
              </button>
              <button type="button" aria-pressed={commitmentView} onClick={() => choose(COMMITMENT)}>
                Abschluss-Serie
              </button>
            </div>
            <label className="rb-search">
              <Search size={18} aria-hidden="true" />
              <span className="do-sr">Namen suchen</span>
              <input
                ref={searchRef}
                type="search"
                placeholder="Namen suchen"
                autoComplete="off"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Suche leeren">
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </label>
          </div>
          {!signedIn && !commitmentView && !loading && !error && filtered.length > 0 && (
            <p className="rb-claim-hint">
              Dein Name steht hier? Antippen und „Das sind meine Zahlen“ wählen.
            </p>
          )}
          {!commitmentView && ownId && !loading && !error && (
            <p className="rb-own">
              {own ? (
                <button type="button" onClick={showOwn}>
                  <span className="rb-own-place">{own.rank}.</span>
                  <span>Dein Platz mit {numbersLine(own.counts)}</span>
                </button>
              ) : (
                <span className="rb-own-empty">
                  {monthly ? "In diesem Monat" : "An diesem Tag"} bist du in dieser Rangliste nicht dabei.
                </span>
              )}
            </p>
          )}

          {!commitmentView && !loading && !error && !search && (
            <Podium rows={filtered} ownId={ownId} onShow={showRow} />
          )}
          {commitmentView ? (
            <CommitmentList state={commitmentState} rows={commitmentFiltered} total={commitmentRows.length} search={search} ownId={ownId} month={month} onRetry={() => setRetry((v) => v + 1)} />
          ) : loading ? (
            <ol className="rb-list" aria-busy="true" aria-label="Rangliste wird geladen">
              {Array.from({ length: 5 }, (_, i) => (
                <li key={i} className="rb-skeleton" />
              ))}
            </ol>
          ) : error ? null : filtered.length ? (
            <ol className="rb-list" key={requestKey} aria-label="Rangliste">
              {filtered.map((row, index) => (
                <RankRow
                  key={row.id}
                  row={row}
                  best={best}
                  index={index}
                  own={row.id === ownId}
                  open={openId === row.id}
                  periodLabel={periodLabel}
                  monthly={monthly}
                  signedIn={signedIn}
                  onToggle={() => setOpenId((id) => (id === row.id ? null : row.id))}
                />
              ))}
            </ol>
          ) : (
            <div className="rb-empty">
              <p>
                <strong>
                  {search
                    ? "Kein Name gefunden."
                    : `Für ${monthly ? "diesen Monat" : "diesen Tag"} ist noch nichts gemeldet.`}
                </strong>{" "}
                {search
                  ? "Prüfe die Schreibweise oder such nach dem Nachnamen."
                  : "Wähle einen anderen Tag im Verlauf."}
              </p>
            </div>
          )}

          {!commitmentView && !loading && joint.length > 0 && (
            <details className="rb-joint">
              <summary>
                Gemeinsame Meldungen ({joint.length})<span>kein eigener Platz</span>
              </summary>
              <ul>
                {joint.map((row) => {
                  const origin = jointReport(row.key);
                  return (
                    <li key={row.id}>
                      <span>
                        {row.name}
                        {origin && <small>{origin.reportedAt} Uhr · je zur Hälfte aufgeteilt</small>}
                      </span>
                      <strong>{fmt(origin?.report.attempts ?? row.counts.attempts ?? null)}</strong>
                    </li>
                  );
                })}
              </ul>
              <p>
                Gemeinsam erbrachte Leistung tritt nicht gegen einzelne Personen an. Die Werte stecken
                bereits in den Einzelzahlen und zählen nicht doppelt.
              </p>
            </details>
          )}
          {!loading && !error && (
            <div className="rb-list-foot">
              <p>
                {commitmentView
                  ? "Die Serie zählt jeden rechtzeitig eingereichten Tagesabschluss an Calling-Tagen, auch mit 0 Anwahlen."
                  : "Gleichstände teilen sich einen Platz. 0 ist eine Meldung, keine Meldung ist keine 0."}
              </p>
              <div>
                {newest && !commitmentView && (
                  <span>
                    Stand{" "}
                    {new Date(newest).toLocaleString("de-DE", {
                      timeZone: "Europe/Berlin",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    Uhr
                  </span>
                )}
                <button type="button" className="rb-share" onClick={share}>
                  <Link2 size={16} aria-hidden="true" />
                  {shareMessage || "Link zu dieser Ansicht kopieren"}
                </button>
              </div>
            </div>
          )}
        </section>

        {data && !error && (
          <RankingHistory
            month={month}
            days={data.days}
            selectedDay={monthly ? undefined : day}
            today={today}
            events={events}
            onDay={(value) => {
              navigate({ day: value });
              document.getElementById("rb-results-title")?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          />
        )}

        <section className="rb-exchange" aria-label="Austausch">
          <Link href="/reflexionen">
            <strong>Reflexionen lesen</strong>
            <span>Was bei anderen heute funktioniert hat.</span>
          </Link>
          <a href={discord} target="_blank" rel="noopener noreferrer">
            <strong>Call-Partner im Discord finden</strong>
            <span>Sessions, Roleplay und gemeinsames Callen. Öffnet Discord.</span>
          </a>
        </section>

        {!onlyRanking && !signedIn && (
          <section className="rb-how" id="so-funktionierts" aria-labelledby="rb-how-title">
            <h2 id="rb-how-title">So funktioniert’s</h2>
            <ol>
              {steps.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
            <p className="rb-how-foot">
              Kostenfrei. Mehr zu Serie, Level und wer was sieht:{" "}
              <Link className="do-link" href="/so-funktionierts">
                So funktioniert’s im Detail
              </Link>
            </p>
          </section>
        )}
      </main>
      <OperatorFooter discordUrl={discord} showAdmin={!!viewer?.team || !!home?.team} />
    </div>
  );
}

const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" });
function formatWeekday(day: string) {
  return WEEKDAY.format(new Date(`${day}T12:00:00Z`));
}
function formatDeadline(iso: string) {
  return `${new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso))} Uhr`;
}

/** Kompakter Abschnitt „Mein Tag“ auf der Startseite, je nach Stand. */
function PersonalPanel({ home }: { home: HomeState }) {
  const state = (() => {
    if (!home.participant) {
      if (home.request && ["pending", "info_needed"].includes(home.request.status))
        return {
          icon: Clock3,
          tone: "wait",
          title:
            home.request.status === "info_needed"
              ? "Das Team hat eine Rückfrage zu deiner Profilübernahme."
              : "Deine Profilübernahme wird geprüft.",
          text: "Sobald das Team freigibt, trägst du hier deinen Tag ein.",
          href: "/status",
          action: home.request.status === "info_needed" ? "Rückfrage beantworten" : "Stand ansehen",
        };
      return {
        icon: CircleDashed,
        tone: "open",
        title: "Dein Konto hat noch kein Profil.",
        text: "Leg ein Profil an oder übernimm deine Zahlen, wenn du schon in der Rangliste stehst.",
        href: "/start",
        action: "Profil einrichten",
      };
    }
    const t = home.today!;
    if (home.earlier && t.status !== "done")
      return {
        icon: Clock3,
        tone: "open",
        title: `Dein Abschluss für ${formatWeekday(home.earlier.day)} ist noch offen.`,
        text: `Bis ${formatDeadline(home.earlier.deadline)} zählt er noch für deine Serie.`,
        href: `/tagesabschluss?tag=${home.earlier.day}`,
        action: `${formatWeekday(home.earlier.day)} abschließen`,
      };
    if (t.status === "done")
      return {
        icon: CircleCheck,
        tone: "done",
        title: "Heute abgeschlossen.",
        text: "Deine Zahlen und deine Reflexion sind eingereicht.",
        href: "/tagesabschluss",
        action: "Meinen Tag ansehen",
      };
    if (t.status === "imported")
      return {
        icon: Check,
        tone: "done",
        title: "Deine Zahlen für heute sind eingetragen.",
        text: "Das Team hat sie übernommen.",
        href: "/tagesabschluss",
        action: "Meinen Tag ansehen",
      };
    if (t.status === "draft")
      return {
        icon: NotebookPen,
        tone: "draft",
        title: "Dein Entwurf für heute ist gespeichert.",
        text: "Er zählt, sobald du ihn einreichst.",
        href: "/tagesabschluss",
        action: "Fortsetzen",
      };
    return {
      icon: CircleDashed,
      tone: "open",
      title: t.due ? "Dein Abschluss für heute ist noch offen." : "Heute ist kein Calling-Tag.",
      text: t.due
        ? "Zahlen und zwei kurze Fragen, dann zählt dein Tag."
        : "Ein Abschluss ist freiwillig und zählt als Bonus.",
      href: "/tagesabschluss",
      action: "Zahlen eintragen",
    };
  })();
  const Icon = state.icon;
  return (
    <section className="rb-me" data-tone={state.tone} aria-labelledby="rb-me-title">
      <span className="rb-me-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div className="rb-me-text">
        <p className="rb-me-kicker">Mein Tag</p>
        <h2 id="rb-me-title">{state.title}</h2>
        <p>{state.text}</p>
      </div>
      <Link
        className={`do-button ${state.tone === "done" ? "do-button-secondary" : "do-button-primary"}`}
        href={state.href}
      >
        {state.action}
      </Link>
      {home.participant && (
        <p className="rb-me-more">
          <span>Jemanden zum Üben oder für Feedback?</span>
          <Link className="do-link" href="/partner?modus=eigen">
            <UsersRound size={16} aria-hidden="true" />
            Call-Partner finden
          </Link>
        </p>
      )}
    </section>
  );
}
/** Discord ist für Calls da. In einem Satz, was dort passiert, und ein Knopf. */
function DiscordPanel({ url }: { url: string }) {
  return (
    <section className="rb-discord" aria-labelledby="rb-discord-title">
      <span className="rb-discord-icon" aria-hidden="true">
        <Headphones size={22} />
      </span>
      <div className="rb-me-text">
        <p className="rb-me-kicker">Discord</p>
        <h2 id="rb-discord-title">Calls, Sessions und Roleplays laufen im Discord.</h2>
        <p>
          Dort trefft ihr euch zum Üben, findet Call-Partner und pusht euch gegenseitig. Zahlen
          und Reflexionen bleiben hier.
        </p>
      </div>
      <a className="do-button do-button-secondary" href={url} target="_blank" rel="noopener noreferrer">
        Discord öffnen
        <ExternalLink size={16} aria-hidden="true" />
        <span className="do-sr">(neues Fenster)</span>
      </a>
    </section>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

/**
 * Podium der Plätze 1 bis 3. Je Platz eine Karte; wer gleichauf liegt, steht
 * in derselben Karte. Die vollständige Rangliste folgt darunter.
 */
function Podium({
  rows,
  ownId,
  onShow,
}: {
  rows: (RankingRow & { rank: number; score: number })[];
  ownId: string | null;
  onShow: (id: string) => void;
}) {
  const places: { rank: number; rows: (RankingRow & { rank: number; score: number })[] }[] = [];
  for (const row of rows) {
    if (row.score <= 0 || row.rank > 3) continue;
    const place = places.find((p) => p.rank === row.rank);
    if (place) place.rows.push(row);
    else places.push({ rank: row.rank, rows: [row] });
  }
  // Mit nur einer Person wiederholte das Podium bloß die einzige Zeile der Liste.
  if (places.reduce((sum, place) => sum + place.rows.length, 0) < 2) return null;
  return (
    <ol className="rb-podium" data-count={places.length} aria-label="Spitzenplätze">
      {places.map((place) => {
        const tier = (["gold", "silver", "bronze"] as const)[place.rank - 1];
        const Icon = place.rank === 1 ? Trophy : Medal;
        const first = place.rows[0];
        const single = place.rows.length === 1;
        const own = place.rows.some((r) => r.id === ownId);
        return (
          <li key={place.rank} data-medal={tier} data-own={own || undefined}>
            <button type="button" onClick={() => onShow(first.id)}>
              <span className="rb-podium-place">
                <Icon size={15} aria-hidden="true" />
                Platz {place.rank}
                {!single && <span className="rb-podium-tie">gleichauf</span>}
              </span>
              <span className="rb-podium-avatars" aria-hidden="true">
                {place.rows.slice(0, 3).map((r) => (
                  <span key={r.id}>{initials(r.name)}</span>
                ))}
                {place.rows.length > 3 && <span>+{place.rows.length - 3}</span>}
              </span>
              {single ? (
                <>
                  <span className="rb-podium-who">
                    <strong>{first.name}</strong>
                    {first.company && <small>{first.company}</small>}
                  </span>
                  <span className="rb-podium-value">
                    <NumberTrio counts={first.counts} compact />
                  </span>
                </>
              ) : (
                /* Gleichauf heißt gleiche Wertung, nicht gleiche Zahlen: jede
                   Person mit ihren eigenen. */
                <span className="rb-podium-who rb-podium-tied">
                  {place.rows.map((r) => (
                    <span key={r.id}>
                      <strong>{r.name}</strong>
                      <small>{numbersLine(r.counts)}</small>
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function RankRow({
  row,
  best,
  index,
  own,
  open,
  periodLabel,
  monthly,
  signedIn,
  onToggle,
}: {
  row: RankingRow & { rank: number; score: number };
  best: number;
  index: number;
  own: boolean;
  open: boolean;
  periodLabel: string;
  monthly: boolean;
  signedIn: boolean;
  onToggle: () => void;
}) {
  const tier = medal(row.rank, row.score);
  const origin = splitOrigin(row.key);
  return (
    <li
      id={`rb-row-${row.id}`}
      data-medal={tier}
      data-own={own || undefined}
      data-open={open || undefined}
      style={{ "--i": Math.min(index, 10) } as CSSProperties}
    >
      <button
        type="button"
        className="rb-row"
        aria-expanded={open}
        aria-controls={`rb-detail-${row.id}`}
        onClick={onToggle}
      >
        <span className="rb-place">
          <span className="do-sr">Platz </span>
          {row.rank}
        </span>
        <span className="rb-name">
          <strong>
            {row.name}
            {own && <em className="rb-you">Du</em>}
          </strong>
          {row.company && <small>{row.company}</small>}
          <span className="rb-bar" aria-hidden="true">
            <i
              style={{
                transform: `scaleX(${best > 0 ? row.score / best : 0})`,
              }}
            />
          </span>
        </span>
        <span className="rb-value">
          <NumberTrio counts={row.counts} />
        </span>
        <ChevronDown className="rb-chevron" size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="rb-detail" id={`rb-detail-${row.id}`}>
          <p className="rb-detail-period">{periodLabel}</p>
          <dl>
            {visibleMetrics.map((key) => (
              <div key={key}>
                <dt>{metricLabels[key]}</dt>
                <dd>{fmt(row.counts[key])}</dd>
              </div>
            ))}
          </dl>
          {origin ? (
            <p className="rb-detail-note">
              <strong>{SPLIT_NOTE}</strong> Die gemeinsame Meldung von {origin.name} um{" "}
              {origin.reportedAt} Uhr ist je zur Hälfte auf die Beteiligten gerechnet. Es sind
              zugeteilte, keine einzeln gemeldeten Werte.
              {origin.kept.map((k) => (
                <span key={k.metric}> {k.why}</span>
              ))}
            </p>
          ) : (
            <p className="rb-detail-note">
              Werte für {monthly ? "den Monat" : "diesen Tag"}. Nicht gemeldete Kennzahlen bleiben offen.
            </p>
          )}
          {row.claimed ? (
            <p className="rb-detail-claimed">
              <ShieldCheck size={16} aria-hidden="true" /> Dieses Profil gehört bereits zu einem Konto.
            </p>
          ) : (
            !own && (
              <Link
                className="do-button do-button-secondary"
                href={`/starten?profil=${encodeURIComponent(row.id)}`}
              >
                Das sind meine Zahlen
              </Link>
            )
          )}
          {!row.claimed && signedIn && (
            <p className="rb-detail-hint">Du wirst mit deinem Konto zur Übernahme geführt.</p>
          )}
        </div>
      )}
    </li>
  );
}

function CommitmentList({
  state,
  rows,
  total,
  search,
  ownId,
  month,
  onRetry,
}: {
  state: LoadedCommitment | null;
  rows: (CommitmentRow & { rank: number })[];
  total: number;
  search: string;
  ownId: string | null;
  month: string;
  onRetry: () => void;
}) {
  if (!state)
    return (
      <ol className="rb-list" aria-busy="true" aria-label="Serien werden geladen">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="rb-skeleton" />
        ))}
      </ol>
    );
  if (state.error)
    return (
      <div className="rb-state" role="alert">
        <p>
          <strong>Die Serien sind gerade nicht abrufbar.</strong> {state.error}
        </p>
        <button type="button" className="do-button do-button-secondary" onClick={onRetry}>
          Erneut laden
        </button>
      </div>
    );
  if (!rows.length)
    return (
      <div className="rb-empty">
        <p>
          <strong>{search ? "Kein Name gefunden." : "Noch keine öffentlichen Serien."}</strong>{" "}
          {search
            ? "Prüfe die Schreibweise."
            : "Hier erscheinen Personen, die ihren Tagesabschluss selbst einreichen und der öffentlichen Anzeige zugestimmt haben."}
        </p>
      </div>
    );
  return (
    <ol className="rb-list" aria-label={`Rangliste Abschluss-Serie, ${search ? `${rows.length} von ${total}` : total} Personen`}>
      {rows.map((row, index) => (
        <li
          key={row.id}
          data-medal={medal(row.rank, row.streak.current)}
          data-own={row.id === ownId || undefined}
          style={{ "--i": Math.min(index, 10) } as CSSProperties}
        >
          <div className="rb-row rb-row-static">
            <span className="rb-place">
              <span className="do-sr">Platz </span>
              {row.rank}
            </span>
            <span className="rb-name">
              <strong>
                {row.name}
                {row.id === ownId && <em className="rb-you">Du</em>}
              </strong>
              <small>
                {row.activeDays} aktive {row.activeDays === 1 ? "Tag" : "Tage"} im {formatMonth(month)}
                {row.active ? " · Aktiver Caller" : ""}
              </small>
            </span>
            <span className="rb-value">
              <strong>{fmt(row.streak.current)}</strong>
              <small>{row.streak.current === 1 ? "Tag Serie" : "Tage Serie"}</small>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
