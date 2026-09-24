"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  Undo2,
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
  called: { label: "Gecallt", legend: "Rechtzeitig mit Anwahlen" },
  reflected: { label: "Reflektiert", legend: "Rechtzeitig, ohne Anwahlen" },
  late: { label: "Später", legend: "Später eingereicht: Zahlen zählen, Serie nicht" },
  imported: { label: "Übernommen", legend: "Zahlen aus der Gruppe, ohne Reflexion" },
  missed: { label: "Ohne Abschluss", legend: "Nachtragen geht jederzeit" },
  open: { label: "Offen", legend: "Noch rechtzeitig möglich" },
  bonus: { label: "Bonus", legend: "Freiwillig am freien Tag" },
  free: { label: "Frei", legend: "Kein Calling-Tag" },
  paused: { label: "Pause", legend: "Bestätigte Pause" },
  "before-start": { label: "Vor dem Start", legend: "Vor deinem Start" },
  future: { label: "Noch nicht", legend: "Liegt in der Zukunft" },
};
const LEGEND: DayStatus[] = [
  "called",
  "reflected",
  "open",
  "late",
  "imported",
  "missed",
  "bonus",
  "free",
  "paused",
];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const PAUSE_LABEL: Record<PauseEntry["status"], string> = {
  requested: "Gemeldet",
  approved: "Bestätigt",
  rejected: "Nicht bestätigt",
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
        text: "Deine Pause ist beim Team gemeldet. Bis das Team sie bestätigt, zählen die Tage weiter als Calling-Tage.",
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
      setPauseMessage({ tone: "ok", text: "Deine Pausenmeldung ist zurückgezogen." });
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
        <h2 id={`${uid}-title`}>Abschluss-Serie</h2>
      </header>
      <details className="cm-rules-note">
        <summary>So zählt die Serie</summary>
        <p>
          Calling-Tage sind {workdays}. Rechtzeitig ist ein Abschluss mit Reflexion bis{" "}
          {settings.deadlineHour}:00 Uhr am nächsten Calling-Tag, für Freitag also bis
          Montagvormittag. Auch ein Tag mit 0 Anwahlen hält die Serie am Laufen.
          Wochenenden und bestätigte Pausen zählen nicht. Übernommene Zahlen aus der
          Gruppe zählen in Rangliste und Summen, für die Serie braucht es den eigenen
          Abschluss.
        </p>
      </details>

      <dl className="cm-stats">
        <div>
          <dt>Serie</dt>
          <dd>
            <strong>{summary.streak.current}</strong>
            <span>
              {summary.streak.current === 1 ? "Tag" : "Tage"}, Bestwert {summary.streak.best}
            </span>
          </dd>
          <p>
            {summary.streak.current > 0
              ? "Rechtzeitige Abschlüsse in Folge."
              : "Startet mit deinem nächsten rechtzeitigen Abschluss."}
          </p>
        </div>
        <div>
          <dt>Tage mit Anwahlen</dt>
          <dd>
            <strong>{summary.activeDays}</strong>
          </dd>
          <p>
            {data.trackingStart
              ? `Seit ${formatFullDay(data.trackingStart)}, eigene und übernommene.`
              : "Ab deinem ersten Tagesabschluss."}
          </p>
        </div>
        <div>
          <dt>Abschlüsse</dt>
          <dd>
            <strong>{summary.closedDays}</strong>
          </dd>
          <p>Eigene Tagesabschlüsse, auch am Wochenende.</p>
        </div>
      </dl>

      {summary.atRisk && (
        <div className="cm-alert warn">
          <Clock3 size={18} aria-hidden="true" />
          <div>
            <p>
              Dein Abschluss für {formatShortDay(summary.atRisk.day)} ist noch offen. Bis{" "}
              {formatMoment(summary.atRisk.deadline, tz)} zählt er noch für deine Serie.
            </p>
            <Link className="do-button do-button-primary" href={`/tagesabschluss?tag=${summary.atRisk.day}`}>
              {formatShortDay(summary.atRisk.day)} abschließen
            </Link>
          </div>
        </div>
      )}
      {(summary.missingOpen > 0 || summary.inactive) && (
        <p className="cm-note">
          {summary.missingOpen > 0
            ? `${plural(summary.missingOpen, "Calling-Tag", "Calling-Tage")} ohne Abschluss. Nachgetragen zählen die Zahlen.`
            : "Zuletzt gab es ein paar Calling-Tage ohne Anwahlen."}{" "}
          {summary.inactive
            ? "Ein kurzer Calling-Block reicht zum Wiedereinstieg; brauchst du Abstand, melde eine Pause."
            : ""}
        </p>
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
          {LEGEND.filter((s) => days.some((d) => d.status === s)).map((s) => (
            <li key={s}>
              <span className={`cm-swatch s-${s}`} aria-hidden="true" />
              <span>
                <strong>{STATUS[s].label}</strong>{" "}
                <span className="cm-legend-text">{STATUS[s].legend}</span>
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
          <details className="cm-catchup" open={catchUp.length <= 2 || undefined}>
            <summary>
              Noch offen in diesem Monat: {plural(catchUp.length, "Tag", "Tage")}
            </summary>
            <ul>
              {catchUp.map((d) => (
                <li key={d.day}>
                  <Link href={`/tagesabschluss?tag=${d.day}`}>
                    <span>{formatShortDay(d.day)}</span>
                    <span className="cm-catchup-hint">
                      {d.status === "open" && d.deadline
                        ? `Abschließen, rechtzeitig bis ${formatMoment(d.deadline, tz)}`
                        : "Nachtragen"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <details className="cm-pauses" open={data.pauses.some((p) => p.status === "requested") || undefined}>
        <summary>
          <h3>Pause melden</h3>
        </summary>
        <p className="cm-muted">
          Urlaub, Krankheit oder bewusster Abstand sind okay. In einer bestätigten Pause zählen die
          Tage nicht für deine Serie, sie wartet so lange. Eine Pause beginnt frühestens heute und
          dauert höchstens zwei Monate am Stück. Das Team bestätigt sie kurz; für vergangene Tage
          wende dich direkt an das Team.
        </p>
        {pauses.some((p) => p.from <= today && today <= p.to) && (
          <p className="cm-alert info">Du bist gerade in einer bestätigten Pause.</p>
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
            Pause melden
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
      </details>
    </section>
  );
}
