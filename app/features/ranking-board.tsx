"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Phone,
  Users,
  Trophy,
  CalendarCheck,
  Search,
  RefreshCw,
  Check,
  ShieldCheck,
  Headphones,
  Copy,
  Medal,
  Sparkles,
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
  AKQUISE_DAY,
  bookedAppointments,
  formatDay,
  formatMonth,
  metricShortLabels,
  monthSchema,
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
const primaryMetrics: VisibleMetric[] = [
  "attempts",
  "settingsBooked",
  "closingsBooked",
  "dealsWon",
];
const secondaryMetrics: VisibleMetric[] = ["settingsHeld", "closingsHeld"];

type LoadedRanking = {
  key: string;
  data: RankingMonth | null;
  error: string;
  updated: string;
};
export default function RankingBoard({
  discordUrl,
}: {
  discordUrl?: string;
  onlyRanking?: boolean;
}) {
  const params = useSearchParams();
  // Der Einstieg in den Server muss immer ein Ziel haben, auch wenn die Seite
  // ohne übergebene Adresse gerendert wird.
  const discord = discordUrl || DISCORD_INVITE;
  const today = berlinDate();
  const parsedDay = daySchema.safeParse(params.get("day"));
  const parsedMonth = monthSchema.safeParse(params.get("month"));
  const monthly =
    params.has("month") && parsedMonth.success && !params.has("day");
  const day = parsedDay.success ? parsedDay.data : today;
  const month = monthly ? parsedMonth.data : day.slice(0, 7);
  const metric = visibleMetrics.includes(params.get("metric") as VisibleMetric)
    ? (params.get("metric") as VisibleMetric)
    : "attempts";
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState<LoadedRanking | null>(null);
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
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
  const filtered = all.filter((row) =>
    `${row.name} ${row.company} ${row.role}`
      .toLocaleLowerCase("de")
      .includes(search.toLocaleLowerCase("de")),
  );
  const podium = all.filter((row) => (row.counts[metric] ?? 0) > 0).slice(0, 3);
  const best = all[0]?.counts[metric] ?? 0;
  const periodLabel = monthly ? formatMonth(month) : formatDay(day);
  const event = !monthly && day === AKQUISE_DAY;
  const newest = rows.reduce(
    (latest, row) => (row.updatedAt > latest ? row.updatedAt : latest),
    "",
  );

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

  function navigate(
    period: { day: string } | { month: string },
    nextMetric = metric,
  ) {
    const next = new URLSearchParams({ ...period, metric: nextMetric });
    window.history.pushState(null, "", `${window.location.pathname}?${next}`);
    setSelectedId(null);
    setShareMessage("");
  }
  function chooseMetric(value: VisibleMetric) {
    navigate(monthly ? { month } : { day }, value);
  }
  async function share() {
    const url = `${window.location.origin}/ranking?${new URLSearchParams({ ...(monthly ? { month } : { day }), metric })}`;
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
        {/* Steht bewusst außerhalb der Lade- und Fehlerzweige: der Weg zurück
            in den Server darf nie davon abhängen, ob die Zahlen gerade
            abrufbar sind oder ob jemand angemeldet ist. */}
        <section className="rr-intro">
          <div className="rr-intro-copy">
            <span className="rr-eyebrow">
              <span className="rr-live-dot" /> DIE CREW. DIE ZAHLEN.
            </span>
            <h1>
              Zusammen callen.
              <br />
              Gemeinsam <em>dranbleiben.</em>
            </h1>
            <p>
              Hier halten wir fest, was wir gemeinsam erreichen. Auf Discord
              verabreden wir die nächsten Call-Blöcke, teilen Learnings und
              pushen uns gegenseitig.
            </p>
            <div className="rr-intro-actions">
              <a
                className="rr-discord-cta"
                href={discord}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Headphones size={19} />
                Auf Discord weitercallen
              </a>
              <Link href="/beitreten" className="rr-intro-secondary">
                <ShieldCheck size={17} />
                Meine Zahlen &amp; mein Profil
              </Link>
            </div>
          </div>
        </section>

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
              <Sparkles size={15} /> AKQUISE DAY
            </span>
            <p>
              <strong>
                22. September 2026. Gemeinsam den Hörer in die Hand.
              </strong>
              <span>
                Danke an{" "}
                <a
                  href="https://akquise.de"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  akquise.de
                </a>{" "}
                für diesen Tag und an alle, die mitgezogen haben.
              </span>
            </p>
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
            <span>Die Leistung der Crew wird geladen …</span>
          </div>
        ) : (
          data && (
            <>
              <section
                className="rr-scoreboard"
                aria-label={`Gemeinsame Leistung: ${periodLabel}`}
              >
                <div className="rr-scoreboard-top">
                  <span className="rr-eyebrow">
                    {monthly
                      ? "UNSER MONAT"
                      : event
                        ? "DAS HABEN WIR GEMEINSAM ERREICHT"
                        : "UNSER TAG"}
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
                    <small>Hörer in die Hand. Gemeinsam dran.</small>
                  </div>
                  <div>
                    <span>
                      <CalendarCheck size={18} /> Termine vereinbart
                    </span>
                    <strong>{fmt(bookedAppointments(totals))}</strong>
                    <small>Settings & Closings</small>
                  </div>
                  <div>
                    <span>
                      <Trophy size={18} /> Deals gewonnen
                    </span>
                    <strong>{fmt(totals.dealsWon)}</strong>
                    <small>
                      {totals.dealsWon === null
                        ? "Noch nicht gemeldet"
                        : "Aus Einsatz wird Ergebnis."}
                    </small>
                  </div>
                  <div>
                    <span>
                      <Users size={18} /> Am Start
                    </span>
                    <strong>{fmt(people.length)}</strong>
                    <small>
                      {people.length === 1 ? "Person" : "Personen"}
                      {joint.length > 0
                        ? ` · ${joint.length} gemeinsame ${joint.length === 1 ? "Meldung" : "Meldungen"}`
                        : ""}
                    </small>
                  </div>
                </div>
                <div className="rr-score-detail">
                  <span>Davon vereinbart</span>
                  <button onClick={() => chooseMetric("settingsBooked")}>
                    <strong>{fmt(totals.settingsBooked)}</strong> Settings
                  </button>
                  <button onClick={() => chooseMetric("closingsBooked")}>
                    <strong>{fmt(totals.closingsBooked)}</strong> Closings
                  </button>
                </div>
                {data.label && (
                  <p className="rr-snapshot-label">{data.label}</p>
                )}
              </section>

              <section
                className="rr-competition"
                id="ranking"
                aria-label="Community-Ranking"
              >
                <div className="rr-ranking-heading">
                  <div>
                    <span className="rr-eyebrow">
                      {monthly ? "MONATSRANKING" : "TAGESRANKING"}
                    </span>
                    <h2>
                      {monthly
                        ? "Die Crew im Monatsvergleich."
                        : "Wer hat abgeliefert?"}
                    </h2>
                  </div>
                  <span>{periodLabel}</span>
                </div>
                <div
                  className="rr-metric-bar"
                  role="group"
                  aria-label="Ranking-Kennzahl"
                >
                  {primaryMetrics.map((key) => (
                    <button
                      key={key}
                      aria-pressed={metric === key}
                      onClick={() => chooseMetric(key)}
                    >
                      {metricShortLabels[key]}
                    </button>
                  ))}
                  <label className="rr-more-metrics">
                    <span className="sr-only">Weitere Kennzahlen</span>
                    <select
                      aria-label="Weitere Kennzahlen"
                      value={secondaryMetrics.includes(metric) ? metric : ""}
                      onChange={(e) => {
                        if (e.target.value)
                          chooseMetric(e.target.value as VisibleMetric);
                      }}
                    >
                      <option value="" disabled>
                        Durchgeführte Termine
                      </option>
                      {secondaryMetrics.map((key) => (
                        <option value={key} key={key}>
                          {metricShortLabels[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="rr-ranking-context">
                  <span>
                    Sortiert nach <strong>{metricLabels[metric]}</strong>
                  </span>
                </div>
                {podium.length > 0 && (
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
                            {row.company || "Teil der Crew"}
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
                        Gemeldet: {metricShortLabels[metric]}{" "}
                        <span>
                          {search
                            ? `${filtered.length} von ${all.length}`
                            : all.length}
                        </span>
                      </h3>
                      <label className="rr-search">
                        <Search size={17} />
                        <input
                          aria-label="Caller suchen"
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
                    {filtered.length ? (
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
                                  {row.company ||
                                    (row.claimed
                                      ? "Teil der Crew"
                                      : "Profil vorbereitet")}
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
                              : "Dieser Tag gehört noch euch."}
                        </h3>
                        <p>
                          {search
                            ? "Versuche einen anderen Namen."
                            : people.length > 0
                              ? "Für andere Kennzahlen gibt es Meldungen — wechsle oben die Auswahl."
                              : `Für ${monthly ? "diesen Monat" : "diesen Tag"} sind noch keine öffentlichen Zahlen gemeldet. Wähle einen Tag im Archiv oder halte deinen nächsten Call-Block fest.`}
                        </p>
                        {!search && (
                          <Link href="/beitreten" className="btn primary">
                            Meine Zahlen eintragen
                          </Link>
                        )}
                      </div>
                    )}
                    {joint.length > 0 && (
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
                      <span>
                        Nur Personen mit einer Meldung für diese Kennzahl. 0 ist
                        eine Meldung.
                      </span>
                      <span>Gleiche Werte teilen sich einen Rang.</span>
                    </div>
                    {newest && (
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
                          ? "Archiv schließen"
                          : "Verlauf & Tagesarchiv"}
                      </button>
                      {discord && (
                        <a
                          href={discord}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Headphones size={16} />
                          Discord
                        </a>
                      )}
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
                        onDay={(value) => {
                          navigate({ day: value });
                          setArchiveOpen(false);
                        }}
                      />
                      <div className="rr-discord">
                        <Headphones size={23} />
                        <h3>
                          Die Zahlen hier.
                          <br />
                          Die Energie auf Discord.
                        </h3>
                        <p>
                          Zusammen callen, Wins teilen und morgen wieder
                          antreten. Deine Crew wartet.
                        </p>
                        {discord ? (
                          <a
                            className="btn primary"
                            href={discord}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Zur Crew auf Discord
                          </a>
                        ) : (
                          <Link
                            className="btn primary"
                            href="/community?modus=eigen"
                          >
                            Community entdecken
                          </Link>
                        )}
                        <small>
                          Buddys, Austausch & KPI-Tracking sind kostenfrei.
                        </small>
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
                  <h2>Das sind deine Zahlen?</h2>
                  <p>
                    Wähle dein vorbereitetes Profil aus. Nach E-Mail-Bestätigung
                    und Freigabe durch unser Team machst du mit deiner
                    bisherigen Historie weiter.
                  </p>
                </div>
                <Link className="btn primary" href="/beitreten">
                  Mein Profil auswählen
                </Link>
              </section>
            </>
          )
        )}
      </main>
      <OperatorFooter />
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
                : selected?.company || "Teil der Deal Operator Crew"}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <div className="rr-profile-period">
                <CalendarCheck size={16} />
                {periodLabel}
                {event && <span>Akquise Day</span>}
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
                    href={`/beitreten?profil=${encodeURIComponent(selected.id)}`}
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
