"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Flame,
  LoaderCircle,
  MessageCircle,
  Undo2,
  Users,
} from "lucide-react";
import type { DayStatus } from "@/lib/commitment";
import {
  CLOSING_CHANGED,
  approvedPauses,
  fetchClosingState,
  formatFullDay,
  formatMoment,
  formatShortDay,
  postJson,
  todayIn,
  type ClosingState,
  type PauseEntry,
} from "./closing-form";
import "../commitment.css";

/*
 * Dranbleiben sichtbar machen: Serien, aktive Tage, Monatskalender und
 * Pausen. Alle Werte kommen aus /api/closing und folgen denselben Regeln wie
 * Erinnerungen und Ranking. Wochenenden sind keine Pflicht-Tage.
 */

const STATUS: Record<DayStatus, { label: string; legend: string }> = {
  called: { label: "Calling-Tag", legend: "Fristgerecht mit Anwahlen" },
  reflected: { label: "Reflektiert", legend: "Fristgerecht, ohne Anwahlen" },
  late: { label: "Verspätet", legend: "Nach der Frist: Zahlen zählen, Serie nicht" },
  missed: { label: "Fehlt", legend: "Frist vorbei, kein Abschluss" },
  open: { label: "Offen", legend: "Frist läuft noch" },
  bonus: { label: "Bonus", legend: "Freiwillig am freien Tag" },
  free: { label: "Frei", legend: "Kein Pflicht-Tag" },
  paused: { label: "Pause", legend: "Genehmigte Pause" },
  "before-start": { label: "Vor dem Start", legend: "Vor deinem Start" },
  future: { label: "Noch nicht", legend: "Liegt in der Zukunft" },
};
const LEGEND: DayStatus[] = [
  "called",
  "reflected",
  "open",
  "late",
  "missed",
  "bonus",
  "free",
  "paused",
];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const PAUSE_LABEL: Record<PauseEntry["status"], string> = {
  requested: "Beantragt",
  approved: "Genehmigt",
  rejected: "Nicht genehmigt",
};

function shiftMonth(month: string, n: number) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function monthName(month: string) {
  return new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-15T12:00:00Z`));
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Kompakte Serienanzeige mit Hauptaktion, z. B. für die Übersicht. */
export function StreakStrip() {
  const [state, setState] = useState<ClosingState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      fetchClosingState(undefined, controller.signal)
        .then((fresh) => {
          setState(fresh);
          setError("");
        })
        .catch((e: Error) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    void refresh();
    window.addEventListener(CLOSING_CHANGED, refresh);
    return () => {
      controller.abort();
      window.removeEventListener(CLOSING_CHANGED, refresh);
    };
  }, []);

  const today = state ? todayIn(state.settings.timeZone) : null;
  const todayClosed = !!state?.closings.some((c) => c.day === today && c.origin === "closing");
  const hasDraft = !!state?.drafts.some((d) => d.day === today);
  const risk = state?.summary?.atRisk ?? null;
  const target = risk && !todayClosed ? `/tagesabschluss?tag=${risk.day}` : "/tagesabschluss";
  const statusLine = !state
    ? error || "Dein Stand wird geladen …"
    : !state.eligibility.participant
      ? "Für deinen Tagesabschluss fehlt noch ein persönliches Profil."
      : risk
        ? `Offen: ${formatShortDay(risk.day)}, fristgerecht bis ${formatMoment(risk.deadline, state.settings.timeZone)}.`
        : todayClosed
          ? "Heute eingereicht. Dein Tag zählt."
          : hasDraft
            ? "Entwurf für heute gespeichert. Er zählt erst nach dem Einreichen."
            : "Zahlen und Reflexion in einem Abschluss. Zählt erst nach dem Einreichen.";

  return (
    <section className="cm-strip" aria-label="Tagesabschluss und Serien">
      <div className="cm-strip-main">
        <span className="cm-strip-icon" aria-hidden="true">
          {todayClosed ? <CircleCheck size={22} /> : <Flame size={22} />}
        </span>
        <div>
          <strong>Dein Tagesabschluss</strong>
          <p className={risk ? "warn" : ""}>{statusLine}</p>
        </div>
      </div>
      {state?.summary && (
        <dl className="cm-strip-stats">
          <div>
            <dt>Calling-Serie</dt>
            <dd>{state.summary.calling.current}</dd>
          </div>
          <div>
            <dt>Reflexions-Serie</dt>
            <dd>{state.summary.reflection.current}</dd>
          </div>
        </dl>
      )}
      <div className="cm-strip-actions">
        <Link className="btn primary" href={target}>
          {todayClosed ? "Tagesabschluss ansehen" : "Tagesabschluss"}
        </Link>
        <Link className="cm-link" href="/reflexionen">
          <MessageCircle size={15} aria-hidden="true" /> Reflexionen der anderen
        </Link>
      </div>
    </section>
  );
}

export default function CommitmentDashboard({
  initial,
}: {
  initial?: ClosingState | null;
}) {
  const uid = useId();
  const [data, setData] = useState<ClosingState | null>(initial ?? null);
  const [month, setMonth] = useState<string>(
    () => initial?.calendar?.month ?? todayIn(initial?.settings.timeZone).slice(0, 7),
  );
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState("");
  const [pauseForm, setPauseForm] = useState({ from: "", to: "", reason: "" });
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseMessage, setPauseMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );

  // Nur die jeweils letzte Anfrage darf den Stand setzen.
  const request = useRef(0);
  const monthRef = useRef(month);
  const load = useCallback(async (target: string) => {
    const id = ++request.current;
    setLoading(true);
    try {
      const fresh = await fetchClosingState(target);
      if (id !== request.current) return;
      setData(fresh);
      setError("");
    } catch (e) {
      if (id === request.current) setError((e as Error).message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);
  function changeMonth(target: string) {
    monthRef.current = target;
    setMonth(target);
    void load(target);
  }

  // Ohne vorgeladenen Stand einmal selbst laden; nach jedem Einreichen
  // den angezeigten Monat auffrischen.
  useEffect(() => {
    const controller = new AbortController();
    if (!initial)
      fetchClosingState(monthRef.current, controller.signal)
        .then((fresh) => setData(fresh))
        .catch((e: Error) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    const refresh = () => void load(monthRef.current);
    window.addEventListener(CLOSING_CHANGED, refresh);
    return () => {
      controller.abort();
      window.removeEventListener(CLOSING_CHANGED, refresh);
    };
  }, [initial, load]);

  if (!data)
    return (
      <section className="cm-card cm-dashboard" aria-busy={loading}>
        <h2>Dranbleiben</h2>
        {error ? (
          <p className="cm-alert error" role="alert">
            {error}
          </p>
        ) : (
          <p className="cm-loading">
            <LoaderCircle className="spin" size={18} aria-hidden="true" /> Deine Serien werden
            geladen …
          </p>
        )}
      </section>
    );

  const { summary, calendar, settings } = data;
  const tz = settings.timeZone;
  const today = todayIn(tz);
  const thisMonth = today.slice(0, 7);
  const startMonth = data.trackingStart?.slice(0, 7) ?? thisMonth;

  if (!data.eligibility.participant || !summary)
    return (
      <section className="cm-card cm-dashboard">
        <h2>Dranbleiben</h2>
        <p className="cm-muted">
          Serien, aktive Tage und dein Kalender erscheinen, sobald du ein persönliches
          Profil hast und deinen ersten Tagesabschluss einreichst.
        </p>
      </section>
    );

  // Kalenderraster: Montag zuerst, leere Zellen bis zum ersten Tag.
  const days = calendar?.month === month ? calendar.days : [];
  const lead = days.length
    ? (new Date(`${days[0].day}T12:00:00Z`).getUTCDay() + 6) % 7
    : 0;
  const pauses = approvedPauses(data.pauses);
  const catchUp = days.filter(
    (d) =>
      (d.status === "open" || d.status === "missed") &&
      (!data.firstClosableDay || d.day >= data.firstClosableDay),
  );
  const workdays = settings.callingWeekdays
    .slice()
    .sort()
    .map((n) => WEEKDAYS[n - 1])
    .join(", ");

  async function requestPause(e: React.FormEvent) {
    e.preventDefault();
    setPauseMessage(null);
    if (!pauseForm.from || !pauseForm.to) {
      setPauseMessage({ tone: "error", text: "Bitte Beginn und Ende der Pause angeben." });
      return;
    }
    if (pauseForm.from < today) {
      setPauseMessage({
        tone: "error",
        text: "Eine Pause beginnt frühestens heute. Für vergangene Tage wende dich bitte an das Team.",
      });
      return;
    }
    if (pauseForm.to < pauseForm.from) {
      setPauseMessage({ tone: "error", text: "Das Ende der Pause liegt vor dem Beginn." });
      return;
    }
    if ((Date.parse(pauseForm.to) - Date.parse(pauseForm.from)) / 86_400_000 > 62) {
      setPauseMessage({
        tone: "error",
        text: "Eine Pause kann höchstens zwei Monate am Stück dauern.",
      });
      return;
    }
    setPauseBusy(true);
    try {
      await postJson("/api/closing", {
        action: "pause",
        value: { from: pauseForm.from, to: pauseForm.to, reason: pauseForm.reason.trim() },
      });
      setPauseForm({ from: "", to: "", reason: "" });
      setPauseMessage({
        tone: "ok",
        text: "Dein Antrag ist beim Team. Bis zur Freigabe gelten die Tage weiter als Pflicht-Tage.",
      });
      await load(month);
    } catch (err) {
      setPauseMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setPauseBusy(false);
    }
  }

  async function withdraw(id: string) {
    setPauseBusy(true);
    setPauseMessage(null);
    try {
      await postJson("/api/closing", { action: "withdrawPause", value: { id } });
      setPauseMessage({ tone: "ok", text: "Der Antrag ist zurückgezogen." });
      await load(month);
    } catch (err) {
      setPauseMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setPauseBusy(false);
    }
  }

  return (
    <section className="cm-card cm-dashboard" aria-labelledby={`${uid}-title`}>
      <header className="cm-section-head">
        <div>
          <p className="cm-kicker">DRANBLEIBEN</p>
          <h2 id={`${uid}-title`}>Deine Serien</h2>
        </div>
        <p className="cm-muted">
          Pflicht-Tage sind {workdays}. Frist ist {settings.deadlineHour}:00 Uhr am nächsten
          Pflicht-Tag, Freitag also bis Montagvormittag. Wochenenden zählen nicht.
        </p>
      </header>

      <dl className="cm-stats">
        <div className="accent">
          <dt>Calling-Serie</dt>
          <dd>
            <strong>{summary.calling.current}</strong>
            <span>Bestwert {summary.calling.best}</span>
          </dd>
          <p>Fristgerecht abgeschlossene Pflicht-Tage mit Anwahlen in Folge.</p>
        </div>
        <div>
          <dt>Reflexions-Serie</dt>
          <dd>
            <strong>{summary.reflection.current}</strong>
            <span>Bestwert {summary.reflection.best}</span>
          </dd>
          <p>Fristgerecht abgeschlossene Pflicht-Tage, auch ohne Anwahlen.</p>
        </div>
        <div>
          <dt>Aktive Tage</dt>
          <dd>
            <strong>{summary.activeDays}</strong>
            <span>mit Anwahlen</span>
          </dd>
          <p>
            {data.trackingStart
              ? `Seit deinem Start am ${formatFullDay(data.trackingStart)}.`
              : "Ab deinem ersten Tagesabschluss."}
          </p>
        </div>
        <div>
          <dt>Abgeschlossene Tage</dt>
          <dd>
            <strong>{summary.closedDays}</strong>
            <span>eingereicht</span>
          </dd>
          <p>Jeder vollständig eingereichte Tag, auch am Wochenende.</p>
        </div>
      </dl>

      {summary.atRisk && (
        <div className="cm-alert warn">
          <Clock3 size={18} aria-hidden="true" />
          <div>
            <p>
              Dein Abschluss für {formatShortDay(summary.atRisk.day)} ist noch offen. Fristgerecht
              bis {formatMoment(summary.atRisk.deadline, tz)}. Deine laufende Serie hängt daran.
            </p>
            <Link className="btn primary" href={`/tagesabschluss?tag=${summary.atRisk.day}`}>
              Jetzt abschließen
            </Link>
          </div>
        </div>
      )}
      {summary.needsTeamReview ? (
        <div className="cm-alert info">
          <Users size={18} aria-hidden="true" />
          <p>
            Dir fehlen {plural(summary.missingOpen, "Abschluss", "Abschlüsse")}. Das Team meldet
            sich persönlich bei dir und fragt, ob alles passt. Das ist nur eine Nachfrage. Du kannst
            fehlende Tage jederzeit nachtragen oder eine Pause beantragen.
          </p>
        </div>
      ) : summary.missingOpen > 0 ? (
        <p className="cm-muted">
          Es fehlen {plural(summary.missingOpen, "Abschluss", "Abschlüsse")} nach Frist. Nachgetragen
          zählen die Zahlen, die Serie beginnt mit dem nächsten fristgerechten Tag neu.
        </p>
      ) : null}
      {summary.inactive && (
        <div className="cm-alert info">
          <Flame size={18} aria-hidden="true" />
          <p>
            Zuletzt gab es mehr als {settings.inactivityAfterDays} Pflicht-Tage ohne dokumentierte
            Anwahlen. Das passiert. Ein kurzer Calling-Block reicht, um wieder einzusteigen. Wenn du
            gerade Abstand brauchst, beantrage unten eine Pause.
          </p>
        </div>
      )}

      <div className="cm-calendar" aria-busy={loading}>
        <div className="cm-calendar-head">
          <button
            type="button"
            className="cm-icon-button"
            aria-label="Vorheriger Monat"
            disabled={loading || month <= startMonth}
            onClick={() => changeMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft size={20} />
          </button>
          <h3 aria-live="polite">
            <CalendarDays size={17} aria-hidden="true" /> {monthName(month)}
          </h3>
          <button
            type="button"
            className="cm-icon-button"
            aria-label="Nächster Monat"
            disabled={loading || month >= thisMonth}
            onClick={() => changeMonth(shiftMonth(month, 1))}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        {error && (
          <p className="cm-alert error" role="alert">
            {error}
          </p>
        )}
        <div className="cm-weekdays" aria-hidden="true">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <ol className="cm-days" aria-label={`Kalender ${monthName(month)}`}>
          {Array.from({ length: lead }, (_, i) => (
            <li key={`lead-${i}`} className="cm-day empty" aria-hidden="true" />
          ))}
          {days.map((d) => {
            const info = STATUS[d.status];
            const extra =
              d.attempts !== null && d.attempts !== undefined && d.status !== "future"
                ? `, ${d.attempts} Anwahlen`
                : "";
            return (
              <li
                key={d.day}
                className={`cm-day s-${d.status} ${d.day === today ? "today" : ""}`}
                aria-label={`${formatShortDay(d.day)}: ${info.label}${extra}${d.day === today ? ", heute" : ""}`}
                title={`${formatShortDay(d.day)} · ${info.legend}`}
              >
                <span>{Number(d.day.slice(8))}</span>
              </li>
            );
          })}
        </ol>
        <ul className="cm-legend" aria-label="Legende">
          {LEGEND.map((s) => (
            <li key={s}>
              <span className={`cm-swatch s-${s}`} aria-hidden="true" />
              <span>
                <strong>{STATUS[s].label}</strong> {STATUS[s].legend}
              </span>
            </li>
          ))}
        </ul>
        {calendar?.month === month && (
          <p className="cm-muted">
            Im {monthName(month)}: {plural(calendar.closedDays, "Tag", "Tage")} abgeschlossen,{" "}
            {plural(calendar.activeDays, "Tag", "Tage")} mit Anwahlen.
          </p>
        )}
        {catchUp.length > 0 && (
          <div className="cm-catchup">
            <h4>Noch offen in diesem Monat</h4>
            <ul>
              {catchUp.map((d) => (
                <li key={d.day}>
                  <span>
                    {formatShortDay(d.day)} ·{" "}
                    {d.status === "open" && d.deadline
                      ? `fristgerecht bis ${formatMoment(d.deadline, tz)}`
                      : "Frist vorbei, Nachtragen zählt für die Zahlen"}
                  </span>
                  <Link className="btn secondary" href={`/tagesabschluss?tag=${d.day}`}>
                    {d.status === "open" ? "Abschließen" : "Nachtragen"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="cm-pauses">
        <h3>Pause beantragen</h3>
        <p className="cm-muted">
          Urlaub, Krankheit oder bewusster Abstand: Genehmigte Pausen nehmen die Tage aus der
          Pflicht, deine Serie wartet so lange. Eine Pause beginnt frühestens heute und dauert
          höchstens zwei Monate am Stück. Das Team gibt den Antrag frei; für vergangene Tage wende
          dich direkt an das Team.
        </p>
        {pauses.some((p) => p.from <= today && today <= p.to) && (
          <p className="cm-alert info">Du bist gerade in einer genehmigten Pause.</p>
        )}
        <form className="cm-pause-form" onSubmit={requestPause}>
          <label>
            Von
            <input
              type="date"
              required
              min={today}
              value={pauseForm.from}
              onChange={(e) => setPauseForm((f) => ({ ...f, from: e.target.value }))}
            />
          </label>
          <label>
            Bis
            <input
              type="date"
              required
              min={pauseForm.from || today}
              value={pauseForm.to}
              onChange={(e) => setPauseForm((f) => ({ ...f, to: e.target.value }))}
            />
          </label>
          <label className="wide">
            Anlass <span className="cm-optional">(freiwillig, nur für das Team)</span>
            <input
              type="text"
              maxLength={300}
              value={pauseForm.reason}
              placeholder="Zum Beispiel: Urlaub"
              onChange={(e) => setPauseForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </label>
          <button type="submit" className="btn secondary" disabled={pauseBusy}>
            {pauseBusy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
            Pause beantragen
          </button>
        </form>
        {pauseMessage && (
          <p
            className={`cm-alert ${pauseMessage.tone === "ok" ? "ok" : "error"}`}
            role={pauseMessage.tone === "error" ? "alert" : "status"}
          >
            {pauseMessage.text}
          </p>
        )}
        {data.pauses.length > 0 && (
          <ul className="cm-pause-list">
            {data.pauses.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>
                    {formatShortDay(p.from)} bis {formatShortDay(p.to)}
                  </strong>
                  <span className={`cm-pill p-${p.status}`}>{PAUSE_LABEL[p.status]}</span>
                  {p.reason && <small>{p.reason}</small>}
                </div>
                {p.status === "requested" && (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={pauseBusy}
                    onClick={() => void withdraw(p.id)}
                  >
                    <Undo2 size={15} aria-hidden="true" /> Zurückziehen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
