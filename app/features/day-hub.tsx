import Link from "next/link";
import { CalendarDays, Check, CircleCheck, CircleDashed, Clock3, NotebookPen } from "lucide-react";
import type { HomeState } from "@/server/home";
import { formatDay } from "@/lib/ranking-history";
import { dayState, earlierState, formatWeekday, type DayState } from "./day-state";
import DayProgress from "./day-progress";
import type { ClosingState } from "./closing-form";

const ICONS = {
  clock: Clock3,
  check: Check,
  "circle-check": CircleCheck,
  dashed: CircleDashed,
  draft: NotebookPen,
} as const;

/**
 * Mein Tag ohne gewählten Tag: der eigene Stand für heute mit dem nächsten
 * Schritt, ein noch offener Calling-Tag davor, darunter Serie und Level.
 * Das Formular selbst öffnet sich mit ?tag=… (Ansehen, Korrektur, Nachtrag)
 * oder über die Reflexionen, wo der eigene Tag zuerst kommt.
 */
export default function DayHub({
  home,
  closing,
  today,
}: {
  home: HomeState;
  closing: ClosingState | null;
  today: string;
}) {
  const state = dayState(home, "hub");
  const earlier = earlierState(home);
  const status = home.today?.status;
  return (
    <>
      <div className="do-page-head">
        <div>
          <h1>Mein Tag</h1>
          <p>
            {formatWeekday(today)}, {formatDay(today)}
          </p>
        </div>
      </div>
      {earlier && <StateCard state={earlier} kicker="Noch offen" id="md-hub-earlier" />}
      <StateCard state={state} kicker="Heute" id="md-hub-today">
        {home.participant && (
          <p className="rb-me-more">
            <Link className="do-link" href={`/tagesabschluss?tag=${today}`}>
              <CalendarDays size={16} aria-hidden="true" />
              {status === "done"
                ? "Eintrag ansehen oder korrigieren"
                : status === "imported"
                  ? "Übernommene Zahlen ansehen"
                  : "Formular hier öffnen, auch für frühere Tage"}
            </Link>
          </p>
        )}
      </StateCard>
      <DayProgress initial={closing} />
    </>
  );
}

function StateCard({
  state,
  kicker,
  id,
  children,
}: {
  state: DayState;
  kicker: string;
  id: string;
  children?: React.ReactNode;
}) {
  const Icon = ICONS[state.icon];
  return (
    <section className="rb-me md-hub" data-tone={state.tone} aria-labelledby={id}>
      <span className="rb-me-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div className="rb-me-text">
        <p className="rb-me-kicker">{kicker}</p>
        <h2 id={id}>{state.title}</h2>
        <p>{state.text}</p>
      </div>
      <Link
        className={`do-button ${state.tone === "done" ? "do-button-secondary" : "do-button-primary"}`}
        href={state.href}
      >
        {state.action}
      </Link>
      {children}
    </section>
  );
}
