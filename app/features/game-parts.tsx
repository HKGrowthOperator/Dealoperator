import { useId, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Check, Flame as FlameGlyph } from "lucide-react";
import {
  ETAPPEN,
  GAME_TEXT,
  nextEtappe,
  type FlameState,
  type WeekDayState,
} from "@/lib/game";

/*
 * Darstellungsbausteine der Tagesrunde (lib/game.ts), die mehrere Seiten
 * teilen: Ring der Tagesmarke, Flamme der Serie, Etappenleiste, Tagesreihe,
 * Wochenbalken und die Serienzahl. Reine Anzeige ohne Zustand und ohne Daten,
 * deshalb ohne "use client": nutzbar in Server- und Client-Komponenten.
 * Stile in app/game.css. Bewegung nur über transform, opacity und
 * stroke-dashoffset; bei reduzierter Bewegung steht sofort der Endzustand.
 * Symbole sind aria-hidden, die Bedeutung trägt der Text daneben.
 */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
/** Anteil 0 bis 1; NaN und Werte außerhalb werden begrenzt. */
const clampShare = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const num = (n: number) => n.toLocaleString("de-DE");
const vars = (values: Record<`--${string}`, string | number>) => values as CSSProperties;

// ---------------------------------------------------------------------------
// Ring der Tagesmarke

/** Umfang des Rings im 20er-Raster (2π · 8,75), gleich in app/game.css. */
const RING = 54.98;

/**
 * Kleiner Fortschrittsring. Offen: leer, blau umrandet. Anteilig: blauer
 * Bogen. Geschafft: grün geschlossen mit Häkchen. Nie rot, auch nicht bei
 * einer verfehlten Marke.
 *
 * Mit animate füllt sich der Bogen beim Einblenden einmal von leer bis zum
 * Anteil (360 ms nach delay); bei geschafft springt danach das Häkchen auf.
 */
export function GameRing({
  value,
  done,
  size = 20,
  animate = false,
  delay = 0,
  className,
}: {
  /** Anteil 0 bis 1, etwa Anwahlen durch Marke. */
  value: number;
  /** Geschafft erzwingen oder verhindern; ohne Angabe ab Anteil 1. */
  done?: boolean;
  /** Kantenlänge in px. */
  size?: number;
  animate?: boolean;
  /** Verzögerung der Füllung in ms. */
  delay?: number;
  className?: string;
}) {
  const share = clampShare(value);
  const reached = done ?? share >= 1;
  const state = reached ? "done" : share > 0 ? "part" : "open";
  return (
    <svg
      className={cx("gm-ring", className)}
      data-state={state}
      data-animate={animate ? "" : undefined}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      style={vars({ "--gm-delay": `${delay}ms` })}
    >
      <circle className="gm-ring-track" cx="10" cy="10" r="8.75" />
      {state !== "open" && (
        <circle
          className="gm-ring-arc"
          cx="10"
          cy="10"
          r="8.75"
          transform="rotate(-90 10 10)"
          style={{ strokeDashoffset: reached ? 0 : RING * (1 - share) }}
        />
      )}
      {reached && (
        <g className="gm-ring-done">
          <circle cx="10" cy="10" r="10" />
          <path d="M6 10.3 8.7 13 14 7.4" />
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Flamme der Serie

/**
 * Die Flamme gehört nur der Serie. Zustand aus flameState() in lib/game.ts:
 * none grau umrandet, short blau, glow blau mit ruhendem Schein, long Verlauf
 * von Cyan zu Blau, risk amber, paused grau gefüllt. Nie Gold. Öffentlich
 * nur mit flameState(streak, null, false), also nie amber oder pausiert.
 *
 * celebrate: einmaliger weicher Schein für eine gerade erreichte Etappe
 * (900 ms nach delay), kein Dauerpuls.
 */
export function Flame({
  state,
  size = 20,
  celebrate = false,
  delay = 0,
  className,
}: {
  state: FlameState;
  /** Kantenlänge in px. */
  size?: number;
  celebrate?: boolean;
  /** Verzögerung des Scheins in ms. */
  delay?: number;
  className?: string;
}) {
  // Eigene Kennung je Flamme, damit mehrere Verläufe auf einer Seite sich
  // nicht gegenseitig überschreiben.
  const gradient = `gm-flame-${useId().replace(/[^\w-]/g, "")}`;
  const long = state === "long";
  return (
    <span
      className={cx("gm-flame", className)}
      data-state={state}
      data-celebrate={celebrate ? "" : undefined}
      aria-hidden="true"
      style={vars({ "--gm-size": `${size}px`, "--gm-delay": `${delay}ms` })}
    >
      <FlameGlyph
        size={size}
        aria-hidden="true"
        focusable="false"
        {...(long ? { fill: `url(#${gradient})`, stroke: `url(#${gradient})` } : {})}
      >
        {long && (
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="gm-flame-tip" />
              <stop offset="1" className="gm-flame-base" />
            </linearGradient>
          </defs>
        )}
      </FlameGlyph>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Etappenleiste

/**
 * Dünne Linie mit den sechs Etappen (5, 10, 20, 40, 60, 100) über die volle
 * Breite: erreichte gefüllt, die nächste umrandet. Die Linie füllt sich bis
 * zur zuletzt erreichten Etappe und anteilig weiter zur nächsten. Ohne label
 * aria-hidden; der Satz zur nächsten Etappe steht darunter.
 */
export function EtappenLeiste({
  current,
  label,
  className,
}: {
  /** Laufende Serie (streak.current). */
  current: number;
  /** Optional ein Satz für Screenreader; dann role="img". */
  label?: string;
  className?: string;
}) {
  const streak = Number.isFinite(current) ? Math.max(0, current) : 0;
  const next = nextEtappe(streak);
  const last = ETAPPEN.filter((n) => streak >= n).length - 1;
  const line =
    next === null
      ? 1
      : last < 0
        ? 0
        : (last + (streak - ETAPPEN[last]) / (next - ETAPPEN[last])) / (ETAPPEN.length - 1);
  return (
    <div
      className={cx("gm-etappen", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={vars({ "--gm-share": line })}
    >
      <span className="gm-etappen-line">
        <i />
      </span>
      <ol>
        {ETAPPEN.map((n) => (
          <li key={n} data-state={streak >= n ? "reached" : n === next ? "next" : undefined}>
            <span className="gm-etappen-dot" />
            <span className="gm-etappen-label">{n}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tagesreihe

export type TagesreiheDay = {
  day: string;
  state: WeekDayState;
  today?: boolean;
  /** Mit href wird das Feld zum Link (Tippfläche 44 px). */
  href?: string;
};

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const weekdayShort = (day: string) => WEEKDAY_SHORT[new Date(`${day}T12:00:00Z`).getUTCDay()];

/**
 * Je Calling-Wochentag ein Feld (WeekView.days): volle Runde grün gefüllt,
 * eingereicht oder übernommen blau umrandet, offen grau, Pause schraffiert,
 * heute zusätzlich umrandet. Rein zur Anzeige, keine zweite Serie.
 * note steht rechts daneben, am schmalen Handy darunter.
 */
export function Tagesreihe({
  days,
  note,
  label,
  className,
}: {
  days: TagesreiheDay[];
  /** Etwa GAME_TEXT.fullRounds(n). */
  note?: ReactNode;
  /** Optional ein Name für die Liste. */
  label?: string;
  className?: string;
}) {
  return (
    <div className={cx("gm-week", className)}>
      <ol className="gm-days" aria-label={label}>
        {days.map((d) => {
          const aria = GAME_TEXT.weekDayAria(d.day, d.state);
          const content = (
            <>
              <span className="gm-day-box" aria-hidden="true">
                {d.state === "full" && <Check size={16} strokeWidth={3} />}
              </span>
              <span className="gm-day-name" aria-hidden="true">
                {weekdayShort(d.day)}
              </span>
            </>
          );
          return (
            <li key={d.day} data-state={d.state} data-today={d.today ? "" : undefined}>
              {d.href ? (
                <Link
                  className="gm-day"
                  href={d.href}
                  aria-label={aria}
                  aria-current={d.today ? "date" : undefined}
                >
                  {content}
                </Link>
              ) : (
                <span
                  className="gm-day"
                  role="img"
                  aria-label={aria}
                  aria-current={d.today ? "date" : undefined}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {note && <p className="gm-week-note">{note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wochenbalken

/**
 * Balken für das Wochenziel auf der Spur von .lv-bar (8 px, small 6 px), der
 * Anteil über transform scaleX; Änderungen gleiten in 320 ms. Hell: blau,
 * geschafft grün. Dunkel (gemeinsames Wochenziel in .rb-results): Cyan,
 * geschafft Gold. Mit animate füllt er sich beim Einblenden einmal von leer.
 * Ohne label aria-hidden; die Zahlen stehen daneben.
 */
export function Wochenbalken({
  value,
  goal,
  size = "default",
  tone = "light",
  animate = false,
  delay = 0,
  label,
  className,
}: {
  /** Anwahlen bisher. */
  value: number;
  /** Wochenziel; ohne Ziel (0) bleibt der Balken leer. */
  goal: number;
  size?: "default" | "small";
  tone?: "light" | "dark";
  animate?: boolean;
  /** Verzögerung der Füllung in ms. */
  delay?: number;
  /** Optional ein Satz für Screenreader, etwa GAME_TEXT.communityAria(); dann role="img". */
  label?: string;
  className?: string;
}) {
  const reached = goal > 0 && value >= goal;
  return (
    <span
      className={cx("lv-bar", size === "small" && "lv-bar-small", "gm-bar", className)}
      data-tone={tone}
      data-reached={reached ? "" : undefined}
      data-animate={animate ? "" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={vars({
        "--gm-share": goal > 0 ? clampShare(value / goal) : 0,
        "--gm-delay": `${delay}ms`,
      })}
    >
      <i />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Serienzahl

/**
 * Zahl der Serie. Mit animate wechselt sie beim Einblenden genau einmal von
 * from (Standard value - 1) auf value: die alte gleitet 8 px nach oben und
 * blendet aus, die neue kommt von unten (280 ms nach delay). Beide liegen in
 * derselben Rasterzelle, die Breite bleibt fest.
 */
export function SerienZahl({
  value,
  from = value - 1,
  animate = false,
  delay = 0,
  className,
}: {
  value: number;
  /** Stand vor dem Wechsel. */
  from?: number;
  animate?: boolean;
  /** Verzögerung des Wechsels in ms. */
  delay?: number;
  className?: string;
}) {
  if (!animate || from < 0 || from === value)
    return <span className={cx("gm-count", className)}>{num(value)}</span>;
  return (
    <span
      className={cx("gm-count", className)}
      data-animate=""
      style={vars({ "--gm-delay": `${delay}ms` })}
    >
      <span className="gm-count-old" aria-hidden="true">
        {num(from)}
      </span>
      <span className="gm-count-new">{num(value)}</span>
    </span>
  );
}
