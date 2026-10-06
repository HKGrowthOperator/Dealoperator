"use client";
import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, Target } from "lucide-react";
import {
  defaultCommitmentSettings,
  type Clock,
  type CommitmentSettings,
} from "@/lib/commitment";
import { COMMUNITY_GOAL_MAX, COMMUNITY_GOAL_MIN, GAME_TEXT } from "@/lib/game";
import { Feedback, adminPost } from "./admin-shared";

const WEEKDAYS = [
  { id: 1, short: "Mo", long: "Montag" },
  { id: 2, short: "Di", long: "Dienstag" },
  { id: 3, short: "Mi", long: "Mittwoch" },
  { id: 4, short: "Do", long: "Donnerstag" },
  { id: 5, short: "Fr", long: "Freitag" },
  { id: 6, short: "Sa", long: "Samstag" },
  { id: 7, short: "So", long: "Sonntag" },
];
const two = (n: number) => String(n).padStart(2, "0");
const clockText = (c: Clock) => `${two(c.hour)}:${two(c.minute)}`;
function parseClock(value: string): Clock | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}
const weekdayName = (id: number) =>
  WEEKDAYS.find((d) => d.id === id)?.long ?? "";
/** Nächster Pflicht-Wochentag nach `from` (ohne Pausen). */
function nextWeekday(from: number, days: number[]) {
  for (let i = 1; i <= 7; i++) {
    const candidate = ((from - 1 + i) % 7) + 1;
    if (days.includes(candidate)) return candidate;
  }
  return from;
}

/**
 * Dranbleiben-Regeln: Pflicht-Tage, Frist, Erinnerungszeiten und Schwellen.
 * Gespeichert wird immer das vollständige Regelobjekt; der Server prüft es
 * noch einmal (zum Beispiel: Warnung vor der Frist). Darunter steht das
 * gemeinsame Wochenziel als eigene Karte.
 */
export function RulesPanel({
  rules,
  onSaved,
}: {
  rules: CommitmentSettings;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CommitmentSettings>(rules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(rules);
  const days = form.callingWeekdays.toSorted((a, b) => a - b);
  const warningMinutes = form.streakWarning.hour * 60 + form.streakWarning.minute;
  const localProblem = !days.length
    ? "Wähle mindestens einen Calling-Tag."
    : warningMinutes >= form.deadlineHour * 60
      ? "Die Serien-Warnung muss vor der Frist liegen."
      : "";
  const lastDay = days.at(-1);
  const example =
    lastDay !== undefined
      ? `${weekdayName(lastDay)} kann bis ${weekdayName(nextWeekday(lastDay, days))} ${two(form.deadlineHour)}:00 Uhr abgeschlossen werden.`
      : "";
  const free = WEEKDAYS.filter((d) => !days.includes(d.id));

  function update(patch: Partial<CommitmentSettings>) {
    setForm((current) => ({ ...current, ...patch }));
    setSuccess("");
  }
  function toggleDay(id: number) {
    update({
      callingWeekdays: form.callingWeekdays.includes(id)
        ? form.callingWeekdays.filter((d) => d !== id)
        : [...form.callingWeekdays, id].toSorted((a, b) => a - b),
    });
  }
  async function save() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const saved = await adminPost<CommitmentSettings>("saveRules", {
        ...form,
        callingWeekdays: days,
      });
      setForm(saved);
      setSuccess("Gespeichert. Die Regeln gelten ab sofort für Anzeige und Erinnerungen.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="adm-card" aria-labelledby="adm-rules-title">
        <div className="adm-card-head">
          <span className="adm-card-icon" aria-hidden="true">
            <SlidersHorizontal size={19} />
          </span>
          <div>
            <h2 id="adm-rules-title">Dranbleiben-Regeln</h2>
            <p>
              Diese Werte steuern die Serie, Fristen, Erinnerungen und die
              Teamprüfung. Sie gelten für alle Mitglieder gleich. Zeitzone:{" "}
              {form.timeZone}.
            </p>
          </div>
        </div>

        <fieldset className="adm-fieldset">
          <legend>Calling-Tage</legend>
          <p className="adm-hint">
            An diesen Wochentagen wird ein Tagesabschluss erwartet. Andere Tage
            sind frei: keine Erinnerung, kein Serienverlust. Ein freiwilliger
            Abschluss an einem freien Tag zählt trotzdem.
          </p>
          <div className="adm-weekdays">
            {WEEKDAYS.map((d) => (
              <label key={d.id} data-checked={form.callingWeekdays.includes(d.id)}>
                <input
                  type="checkbox"
                  checked={form.callingWeekdays.includes(d.id)}
                  onChange={() => toggleDay(d.id)}
                />
                <span aria-hidden="true">{d.short}</span>
                <span className="sr-only">{d.long}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="adm-grid">
          <label className="adm-field">
            <span>Frist am nächsten Calling-Tag</span>
            <select
              value={form.deadlineHour}
              onChange={(e) => update({ deadlineHour: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {two(h)}:00 Uhr
                </option>
              ))}
            </select>
            <small>
              Bis dahin gilt ein Tag als fristgerecht abgeschlossen. Später
              eingereichte Zahlen zählen, die Serie reißt aber.
            </small>
          </label>
          <label className="adm-field">
            <span>Abenderinnerung</span>
            <input
              type="time"
              value={clockText(form.eveningReminder)}
              onChange={(e) => {
                const c = parseClock(e.target.value);
                if (c) update({ eveningReminder: c });
              }}
            />
            <small>
              Push am Calling-Tag, wenn der eigene Abschluss noch fehlt. Nie am
              Wochenende, während einer Pause oder nach dem Einreichen.
            </small>
          </label>
          <label className="adm-field">
            <span>Serien-Warnung</span>
            <input
              type="time"
              value={clockText(form.streakWarning)}
              onChange={(e) => {
                const c = parseClock(e.target.value);
                if (c) update({ streakWarning: c });
              }}
            />
            <small>
              Am nächsten Calling-Tag vor der Frist, nur wenn eine laufende Serie
              wirklich in Gefahr ist. Muss vor der Frist liegen.
            </small>
          </label>
          <label className="adm-field">
            <span>Inaktiv ab</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              value={form.inactivityAfterDays}
              onChange={(e) =>
                update({
                  inactivityAfterDays: Math.max(
                    1,
                    Math.min(30, Math.round(Number(e.target.value) || 1)),
                  ),
                })
              }
            />
            <small>
              Mehr als so viele abgelaufene Calling-Tage in Folge ohne Anwahlen
              führen zum Status „inaktiv“. Nur sichtbar für die Person und das
              Team.
            </small>
          </label>
          <label className="adm-field">
            <span>Teamprüfung ab</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              value={form.reviewAfterMissing}
              onChange={(e) =>
                update({
                  reviewAfterMissing: Math.max(
                    1,
                    Math.min(30, Math.round(Number(e.target.value) || 1)),
                  ),
                })
              }
            />
            <small>
              So viele offene fehlende Abschlüsse erzeugen einen Eintrag in der
              Team-Inbox. Kein automatischer Ausschluss, bitte persönlich
              nachfragen.
            </small>
          </label>
        </div>

        <div className="adm-explain" aria-live="polite">
          <strong>So wirkt es gerade</strong>
          <ul>
            <li>
              Calling-Tage:{" "}
              {days.length
                ? days.map((d) => weekdayName(d)).join(", ")
                : "keine ausgewählt"}
              {free.length
                ? `. Frei: ${free.map((d) => d.long).join(", ")}.`
                : "."}
            </li>
            {example && (
              <li>
                Frist: {two(form.deadlineHour)}:00 Uhr am nächsten Calling-Tag.{" "}
                {example}
              </li>
            )}
            <li>
              Erinnerung um {clockText(form.eveningReminder)} Uhr, Warnung um{" "}
              {clockText(form.streakWarning)} Uhr, jeweils nur mit
              Gerätezustimmung.
            </li>
            <li>
              Inaktiv nach mehr als {form.inactivityAfterDays} Calling-Tagen ohne
              Anwahlen. Teamprüfung ab {form.reviewAfterMissing} offenen fehlenden
              Abschlüssen.
            </li>
          </ul>
        </div>

        <Feedback error={error || (dirty ? localProblem : "")} success={success} />
        <div className="adm-actions">
          <button
            className="btn primary"
            disabled={!dirty || busy || !!localProblem}
            onClick={save}
          >
            {busy ? "Speichert …" : "Regeln speichern"}
          </button>
          <button
            className="btn secondary"
            disabled={busy || !dirty}
            onClick={() => {
              setForm(rules);
              setError("");
            }}
          >
            Änderungen verwerfen
          </button>
          <button
            className="btn secondary"
            disabled={
              busy ||
              JSON.stringify(form) === JSON.stringify(defaultCommitmentSettings)
            }
            onClick={() => update({ ...defaultCommitmentSettings })}
          >
            Startwerte einsetzen
          </button>
        </div>
      </section>
      <CommunityGoalPanel />
    </>
  );
}

// ---------------------------------------------------------------------------
// Gemeinsames Wochenziel

type CommunityRules = {
  /** Montag der laufenden Woche. */
  weekStart: string;
  /** Teamwert, der diese Woche gilt; null heißt automatisch. */
  team: number | null;
  /** Was die Automatik diese Woche rechnet. */
  auto: number;
};
const num = (v: number) => v.toLocaleString("de-DE");
const goalRange = `Das gemeinsame Wochenziel liegt zwischen ${num(COMMUNITY_GOAL_MIN)} und ${num(COMMUNITY_GOAL_MAX)} Anwahlen.`;
/** „6000“ oder „6.000“ ergibt 6000, leer ergibt null, alles andere NaN. */
function parseGoal(value: string): number | null {
  const text = value.replace(/\s/g, "");
  if (!text) return null;
  return /^(\d+|\d{1,3}(\.\d{3})+)$/.test(text) ? Number(text.replaceAll(".", "")) : Number.NaN;
}
const fieldText = (team: number | null) => (team === null ? "" : String(team));

/**
 * Gemeinsames Wochenziel aller Anwahlen für „Gemeinsam erreicht“. Ein
 * Teamwert gilt ab dieser Woche; leer heißt, Deal Operator rechnet es aus
 * dem Schnitt der letzten 4 Wochen. Der Server prüft Grenzen und Format noch
 * einmal (server/settings.ts).
 */
export function CommunityGoalPanel() {
  const [state, setState] = useState<CommunityRules | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const loaded = await adminPost<CommunityRules>("communityRules");
      setState(loaded);
      setValue(fieldText(loaded.team));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const parsed = parseGoal(value);
  const dirty = !!state && (Number.isNaN(parsed) || parsed !== state.team);
  const localProblem = Number.isNaN(parsed)
    ? "Bitte eine ganze Zahl eintragen."
    : parsed !== null && (parsed < COMMUNITY_GOAL_MIN || parsed > COMMUNITY_GOAL_MAX)
      ? goalRange
      : "";

  async function save() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const saved = await adminPost<CommunityRules>("saveCommunityRules", { attempts: parsed });
      setState(saved);
      setValue(fieldText(saved.team));
      setSuccess(
        saved.team === null
          ? `Gespeichert. Ab dieser Woche gilt wieder das automatische Ziel: ${num(saved.auto)} Anwahlen.`
          : `Gespeichert. Ab dieser Woche gilt ein gemeinsames Wochenziel von ${num(saved.team)} Anwahlen.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adm-card" aria-labelledby="adm-community-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <Target size={19} />
        </span>
        <div>
          <h2 id="adm-community-title">{GAME_TEXT.communityTitle}</h2>
          <p>
            Steht für alle sichtbar unter „Gemeinsam erreicht“ auf der Startseite und in der
            Rangliste: alle Anwahlen von Montag bis Sonntag zusammen, ohne Namen.
          </p>
        </div>
      </div>

      {!state ? (
        error ? (
          <>
            <Feedback error={error} />
            <div className="adm-actions">
              <button className="btn secondary" onClick={() => void load()}>
                Erneut laden
              </button>
            </div>
          </>
        ) : (
          <p className="adm-hint" role="status">
            Wird geladen …
          </p>
        )
      ) : (
        <>
          <label className="adm-field adm-field-narrow">
            <span>{GAME_TEXT.communityAdminLabel}</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="automatisch"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSuccess("");
              }}
            />
            <small>{GAME_TEXT.communityAdminHint}</small>
            <small>{GAME_TEXT.communityAdminAuto(state.auto)}</small>
          </label>

          <Feedback error={error || (dirty ? localProblem : "")} success={success} />
          <div className="adm-actions">
            <button
              className="btn primary"
              disabled={!dirty || busy || !!localProblem}
              onClick={save}
            >
              {busy ? "Speichert …" : "Wochenziel speichern"}
            </button>
            <button
              className="btn secondary"
              disabled={busy || !dirty}
              onClick={() => {
                setValue(fieldText(state.team));
                setError("");
              }}
            >
              Änderungen verwerfen
            </button>
          </div>
        </>
      )}
    </section>
  );
}
