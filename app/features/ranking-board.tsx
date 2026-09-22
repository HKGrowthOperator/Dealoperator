"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Phone,
  Users,
  Target,
  Trophy,
  CalendarCheck,
  Search,
  RefreshCw,
  Check,
  ShieldCheck,
  Flame,
  MessageCircle,
} from "lucide-react";
import {
  berlinDate,
  metricLabels,
  metrics,
  ranked,
  type Metric,
  type RankingRow,
} from "@/lib/kpis";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { OperatorHeader, OperatorFooter, DiscordCard } from "./operator-shell";
const fmt = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("de-DE");
export default function RankingBoard({
  discordUrl,
  onlyRanking = false,
}: {
  discordUrl?: string;
  onlyRanking?: boolean;
}) {
  const today = berlinDate();
  const [metric, setMetric] = useState<Metric>("attempts");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const [updated, setUpdated] = useState("");
  const [label, setLabel] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch(`/api/ranking?from=${from}&to=${to}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setRows(d.rows);
        setReady(d.ready);
        setLabel(d.label || "");
        setError("");
        setUpdated(
          new Date().toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A changed date range starts a new external request.
    setLoading(true);
    void load();
    const interval = setInterval(() => {
      if (!document.hidden) void load();
    }, 20000);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [from, to, retry]);
  const all = useMemo(() => ranked(rows, metric), [rows, metric]);
  const best = Math.max(
    0,
    ...all.map((r) => r.counts[metric]).filter((v): v is number => v !== null),
  );
  const filtered = all.filter((r) =>
    `${r.name} ${r.company} ${r.role}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  // Gruppensummen entstehen aus denselben angezeigten Datensätzen wie die
  // Rangliste — kein zweiter, fest eingetragener Zahlenstand.
  const reported = (k: Metric) =>
    all.map((r) => r.counts[k]).filter((v): v is number => v !== null);
  const total = (k: Metric) => {
    const values = reported(k);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  function period(type: string) {
    const d = new Date(`${today}T12:00:00Z`);
    if (type === "Woche")
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    if (type === "Monat") d.setUTCDate(1);
    setFrom(d.toISOString().slice(0, 10));
    setTo(today);
  }
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main className="operator-main">
        {!onlyRanking ? (
          <section className="operator-hero">
            <div className="hero-copy">
              <span className="section-kicker">
                <i /> FÜR MENSCHEN, DIE WIRKLICH CALLEN.
              </span>
              <h1>
                Allein am Hörer.
                <br />
                <em>Gemeinsam dran.</em>
              </h1>
              <p>
                Deine Zahlen. Deine Learnings. Deine Crew.
                <br />
                Mach Akquise zu einer Routine, die du durchziehst – mit
                Menschen, die dasselbe vorhaben.
              </p>
              <div className="hero-actions">
                <Link href="/beitreten" className="btn lime">
                  Kostenfrei dabei sein <Users size={19} />
                </Link>
                <a href="#ranking" className="hero-link">
                  Fortschritt der Crew
                </a>
              </div>
              <div className="hero-promise">
                <Check size={16} /> KPI-Tracking, Buddys und Austausch bleiben
                kostenfrei.
              </div>
            </div>
            <div className="hero-routine">
              <div className="routine-eyebrow">
                DEIN RHYTHMUS. MIT RÜCKENWIND.<span>01 — 03</span>
              </div>
              {[
                {
                  icon: Phone,
                  n: "01",
                  title: "Hörer in die Hand.",
                  text: "Fokus setzen. Call-Block starten. Gemeinsam liefern.",
                },
                {
                  icon: MessageCircle,
                  n: "02",
                  title: "Ehrlich zurückblicken.",
                  text: "Zahlen festhalten. Learnings teilen. Nächsten Schritt planen.",
                },
                {
                  icon: Flame,
                  n: "03",
                  title: "Morgen wieder antreten.",
                  text: "Deine Crew hält mit dir die Verbindlichkeit hoch.",
                },
              ].map((r) => (
                <div className="hero-step" key={r.n}>
                  <span className="hero-step-icon">
                    <r.icon size={20} />
                  </span>
                  <div>
                    <strong>{r.title}</strong>
                    <p>{r.text}</p>
                  </div>
                  <small>{r.n}</small>
                </div>
              ))}
              <Link href="/heute?modus=eigen">
                So sieht dein persönlicher Bereich aus{" "}
              </Link>
            </div>
          </section>
        ) : (
          <section className="ranking-title">
            <span className="section-kicker">
              DEIN FORTSCHRITT. IM KREIS DER CREW.
            </span>
            <h1>
              Gemeinsam wird
              <br />
              Dranbleiben sichtbar.
            </h1>
            <p>
              Ein ehrlicher Blick auf unsere Aktivität. Jede Kennzahl zählt für
              sich.
            </p>
          </section>
        )}
        <section id="ranking" className="ranking-section">
          <div className="ranking-heading">
            <div>
              <span className="section-kicker">DIE CREW IN ZAHLEN</span>
              <h2>
                {onlyRanking
                  ? "Das Community-Ranking."
                  : "Gemeinsam passiert mehr."}
              </h2>
              <p>
                Vergleiche Aktivität und Ergebnisse. Finde Menschen, mit denen
                du weiterkommst.
              </p>
            </div>
            {label && <span className="reported-badge">{label}</span>}
          </div>
          {/* Bei einem Fehler wird der zuletzt geladene Stand NICHT als aktuelle
              Gruppenleistung weitergezeigt — sonst stünden dort stillschweigend
              veraltete Zahlen. */}
          {error ? (
            <div className="crew-stats-error" role="alert">
              <strong>Die aktuellen Zahlen sind gerade nicht abrufbar.</strong>
              <p>
                Damit hier kein veralteter Stand als aktuelle Gruppenleistung
                erscheint, blenden wir die Summen aus, bis der Abruf wieder
                funktioniert.
              </p>
              <button
                className="btn secondary"
                onClick={() => setRetry((v) => v + 1)}
              >
                Erneut laden
              </button>
            </div>
          ) : (
          <div className="crew-stats group-performance">
            {[
              {
                icon: Users,
                label: "Profile mit Meldung",
                value: all.length,
                note: "Einzel- und Teamprofile im Zeitraum",
              },
              {
                icon: Phone,
                label: "Calls / Anwahlen",
                value: total("attempts"),
                note: `gemeldet von ${reported("attempts").length}`,
              },
              {
                icon: Target,
                label: "Settings vereinbart",
                value: total("settingsBooked"),
                note: `gemeldet von ${reported("settingsBooked").length}`,
              },
              {
                icon: CalendarCheck,
                label: "Closing-Termine",
                value: total("closingsBooked"),
                note: `gemeldet von ${reported("closingsBooked").length}`,
              },
              {
                icon: Trophy,
                label: "Deals gewonnen",
                value: total("dealsWon"),
                note:
                  total("dealsWon") === null
                    ? "Noch nicht gemeldet"
                    : `gemeldet von ${reported("dealsWon").length}`,
              },
              {
                icon: MessageCircle,
                label: "Entscheidergespräche",
                value: total("decisionMakerConversations"),
                note: `gemeldet von ${reported("decisionMakerConversations").length}`,
              },
              {
                icon: Check,
                label: "Settings durchgeführt",
                value: total("settingsHeld"),
                note: `gemeldet von ${reported("settingsHeld").length}`,
              },
              {
                icon: CalendarCheck,
                label: "Closings durchgeführt",
                value: total("closingsHeld"),
                note: `gemeldet von ${reported("closingsHeld").length}`,
              },
              {
                icon: CalendarCheck,
                label: "Termine ohne Typangabe",
                value: total("legacyMeetings"),
                note: "Zusätzlich · Setting oder Closing noch offen",
              },
            ].map((s) => (
              <div key={s.label}>
                <span>
                  {s.label}
                  <s.icon size={18} />
                </span>
                <strong>{fmt(s.value)}</strong>
                <small>{s.note}</small>
              </div>
            ))}
          </div>
          )}
          <div className="ranking-layout">
            <div className="ranking-card card">
              <div className="ranking-controls">
                <div
                  className="metric-tabs"
                  role="group"
                  aria-label="Ranking-Kennzahl"
                >
                  {metrics.map((k) => (
                    <button
                      className={metric === k ? "active" : ""}
                      key={k}
                      aria-pressed={metric === k}
                      onClick={() => setMetric(k)}
                    >
                      {
                        (
                          {
                            attempts: "Calls",
                            decisionMakerConversations: "Gespräche",
                            settingsBooked: "Settings",
                            settingsHeld: "Settings durchgeführt",
                            closingsBooked: "Closings",
                            closingsHeld: "Closings durchgeführt",
                            dealsWon: "Deals",
                            legacyMeetings: "Termine ohne Typangabe",
                          } satisfies Record<Metric, string>
                        )[k]
                      }
                    </button>
                  ))}
                </div>
                <div className="ranking-dates">
                  <label>
                    Von
                    <input
                      aria-label="Ranking von"
                      type="date"
                      max={to}
                      value={from}
                      onChange={(e) => {
                        if (e.target.value) setFrom(e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Bis
                    <input
                      aria-label="Ranking bis"
                      type="date"
                      min={from}
                      max={today}
                      value={to}
                      onChange={(e) => {
                        if (e.target.value) setTo(e.target.value);
                      }}
                    />
                  </label>
                  <div>
                    {["Heute", "Woche", "Monat"].map((t) => (
                      <button key={t} onClick={() => period(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ranking-search">
                  <Search size={17} />
                  <input
                    aria-label="Caller suchen"
                    placeholder="Name, Firma oder Rolle suchen …"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button
                    onClick={() => setRetry((v) => v + 1)}
                    aria-label="Ranking aktualisieren"
                  >
                    <RefreshCw className={loading ? "spin" : ""} size={17} />
                  </button>
                </div>
              </div>
              {error ? (
                <div className="ranking-empty" role="alert">
                  <h3>Die Zahlen konnten nicht geladen werden.</h3>
                  <p>{error}</p>
                  <button
                    className="btn primary"
                    onClick={() => setRetry((v) => v + 1)}
                  >
                    Erneut versuchen
                  </button>
                </div>
              ) : loading ? (
                <div className="ranking-empty">
                  <RefreshCw className="spin" />
                  <p>Aktueller Stand wird geladen …</p>
                </div>
              ) : filtered.length ? (
                <div className="ranking-table-wrap">
                  <table className="ranking-table">
                    <thead>
                      <tr>
                        <th>Rang</th>
                        <th>Operator</th>
                        <th>{metricLabels[metric]}</th>
                        <th>
                          <span className="sr-only">Profil</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id} data-rank={r.rank ?? undefined}>
                          <td>
                            <span
                              className={`rank-place ${r.rank && r.rank <= 3 ? "top" : ""}`}
                            >
                              {r.rank === 1 ? (
                                <Trophy size={18} />
                              ) : (
                                (r.rank ?? "—")
                              )}
                            </span>
                          </td>
                          <td>
                            <button
                              className="rank-person"
                              onClick={() => setSelectedId(r.id)}
                            >
                              <span className="rank-avatar">
                                {r.name
                                  .split(" ")
                                  .slice(0, 2)
                                  .map((s) => s[0])
                                  .join("")}
                              </span>
                              <span>
                                <strong>{r.name}</strong>
                                <small>
                                  {r.company || r.role || "Teil der Crew"}
                                  {!r.claimed ? " · Profil vorbereitet" : ""}
                                </small>
                              </span>
                            </button>
                          </td>
                          <td>
                            <strong className="rank-value">
                              {fmt(r.counts[metric])}
                            </strong>
                            {r.counts[metric] !== null && best > 0 && (
                              <span
                                className="rank-bar"
                                aria-hidden="true"
                                style={
                                  {
                                    "--p": `${Math.max(4, Math.round(((r.counts[metric] as number) / best) * 100))}%`,
                                  } as React.CSSProperties
                                }
                              />
                            )}
                          </td>
                          <td>
                            <button
                              className="rank-open"
                              onClick={() => setSelectedId(r.id)}
                              aria-label={`Profil von ${r.name} öffnen`}
                            >
                              <Users size={19} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ranking-empty">
                  <span className="empty-icon">
                    <Phone size={26} />
                  </span>
                  <h3>
                    {search
                      ? "Noch kein Treffer."
                      : "Die ersten Zahlen machen den Anfang."}
                  </h3>
                  <p>
                    {search
                      ? "Probiere einen anderen Namen oder eine andere Rolle."
                      : !ready
                        ? "Wir bereiten die ersten Profile und die Anmeldung vor. Hier erscheinen die freigegebenen Tageszahlen der Community."
                        : "Für diesen Zeitraum wurden noch keine Zahlen für das Ranking freigegeben."}
                  </p>
                  {search && (
                    <button className="btn primary" onClick={() => setSearch("")}>
                      Suche zurücksetzen
                    </button>
                  )}
                </div>
              )}
              <div className="ranking-caption">
                <span>
                  {label || "Gemeldete Zahlen"}
                  {updated ? ` · Abgerufen ${updated} Uhr` : ""}
                </span>
                <span>Gleiche Werte = gleicher Rang · — = nicht gemeldet</span>
              </div>
            </div>
            <div className="ranking-aside">
              <DiscordCard url={discordUrl} />
              <div className="claim-teaser">
                <ShieldCheck size={22} />
                <h3>Deine Zahlen sind schon dabei?</h3>
                <p>
                  Übernimm dein vorbereitetes Profil. Deine bisherigen Einträge
                  bleiben erhalten.
                </p>
                <Link className="text-link" href="/profil-uebernehmen">
                  Mein Profil übernehmen
                </Link>
              </div>
            </div>
          </div>
        </section>
        <section className="community-benefits">
          <div>
            <span className="section-kicker">MEHR ALS EINE ZAHL.</span>
            <h2>
              Eine Crew, die
              <br />
              mit dir dranbleibt.
            </h2>
            <p>
              Keine Pflicht zum Dauer-Online-Sein. Eine klare Routine, ehrlicher
              Austausch und Menschen mit demselben Anspruch.
            </p>
          </div>
          <div className="benefit-grid">
            {[
              {
                n: "01",
                title: "Dein Fortschritt",
                text: "Tageszahlen, persönliche Ziele und vier nachvollziehbare KPI-Ränge.",
                url: "/zahlen?modus=eigen",
              },
              {
                n: "02",
                title: "Dein Call-Buddy",
                text: "Finde Menschen mit passender Zielgruppe, Zeit und Motivation.",
                url: "/crew?modus=eigen",
              },
              {
                n: "03",
                title: "Echter Austausch",
                text: "Reflexionen, Einwandtraining und Feedback aus der Praxis.",
                url: "/wissen?modus=eigen",
              },
              {
                n: "04",
                title: "Gemeinsame Sessions",
                text: "Fokusblöcke, Roleplays und Rückblicke mit deiner Crew.",
                url: "/sessions?modus=eigen",
              },
            ].map((b) => (
              <Link href={b.url} key={b.n}>
                <span>{b.n}</span>
                <h3>{b.title}</h3>
                <p>{b.text}</p>
                <small>Kostenfrei</small>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <OperatorFooter />
      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelectedId(null);
        }}
      >
        <DialogContent className="operator-dialog">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              {selected?.company} {selected?.role ? `· ${selected.role}` : ""}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <div className="reported-notice">
                {label || "Gemeldete Zahlen"}{" "}
                · {from} bis {to}
              </div>
              <div className="profile-kpis">
                {metrics
                  .filter(
                    (k) =>
                      k !== "legacyMeetings" || selected.counts[k] !== null,
                  )
                  .map((k) => (
                    <div key={k}>
                      <span>{metricLabels[k]}</span>
                      <strong>{fmt(selected.counts[k])}</strong>
                    </div>
                  ))}
              </div>
              <p className="hint">
                Ränge entstehen aus dem gesamten persönlichen Fortschritt. Diese
                Ansicht zeigt nur den ausgewählten Zeitraum.
              </p>
              {!selected.claimed && (
                <Link
                  className="btn primary"
                  href={`/beitreten?profil=${encodeURIComponent(selected.id)}`}
                >
                  Das sind meine Zahlen
                </Link>
              )}
              <Link className="text-link" href="/crew?modus=eigen">
                Buddys in der Community finden
              </Link>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
