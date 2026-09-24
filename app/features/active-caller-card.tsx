import Link from "next/link";
import { Flame, Lock, TriangleAlert } from "lucide-react";
import {
  ACTIVE_LOST_AFTER_IDLE,
  ACTIVE_MIN_ATTEMPTS,
  ACTIVE_RUN_DAYS,
  type ActiveCaller,
} from "@/lib/active-caller";
import "../active-caller.css";

const day = (value: string) =>
  new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );

/**
 * Rang „Aktiver Caller“: freigeschaltet mit 5 Calling-Tagen am Stück mit
 * mindestens 50 Anwahlen, weg nach 3 Calling-Tagen in Folge ohne Anwahlen.
 * Schaltet Sessions & Roleplay frei; im Discord gibt es dafür die gleichnamige
 * Rolle.
 */
export default function ActiveCallerCard({
  state,
  team = false,
  compact = false,
}: {
  state: ActiveCaller | undefined;
  team?: boolean;
  compact?: boolean;
}) {
  if (!state) return null;
  const left = Math.max(0, ACTIVE_RUN_DAYS - state.run);
  const dots = (
    <span className="ac-dots" aria-hidden="true">
      {Array.from({ length: ACTIVE_RUN_DAYS }, (_, i) => (
        <span key={i} data-on={i < Math.min(state.run, ACTIVE_RUN_DAYS) || state.active ? "" : undefined} />
      ))}
    </span>
  );
  if (state.active)
    return (
      <section className="ac-card" data-active="" data-compact={compact ? "" : undefined} aria-label="Aktiver Caller">
        <span className="ac-icon" aria-hidden="true">
          <Flame size={22} />
        </span>
        <div>
          <p className="ac-kicker">Aktive Calling-Tage</p>
          <strong>Du bist Aktiver Caller</strong>
          <p>
            {state.since ? `Freigeschaltet am ${day(state.since)}. ` : ""}
            Sessions &amp; Roleplay stehen dir offen, im Discord trägst du den Rang
            „Aktiver Caller“.
          </p>
          {state.idle > 0 && (
            <p className="ac-warn">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>
                {state.idle === 1 ? "1 Calling-Tag" : `${state.idle} Calling-Tage`} ohne Anwahlen. Nach{" "}
                {ACTIVE_LOST_AFTER_IDLE} in Folge ist der Rang weg.
              </span>
            </p>
          )}
        </div>
      </section>
    );
  return (
    <section className="ac-card" data-compact={compact ? "" : undefined} aria-label="Aktiver Caller">
      <span className="ac-icon" aria-hidden="true">
        <Lock size={20} />
      </span>
      <div>
        <p className="ac-kicker">Aktive Calling-Tage</p>
        <strong>
          {left === 1 ? "Noch 1 aktiver Calling-Tag" : `Noch ${left} aktive Calling-Tage`} bis
          zum Rang „Aktiver Caller“
        </strong>
        <div className="ac-progress">
          {dots}
          <span>
            {Math.min(state.run, ACTIVE_RUN_DAYS)} von {ACTIVE_RUN_DAYS} Tagen am Stück mit
            mindestens {ACTIVE_MIN_ATTEMPTS} Anwahlen
          </span>
        </div>
        {!compact && (
          <p>
            Damit schaltest du Sessions &amp; Roleplay frei und bekommst im Discord den Rang
            „Aktiver Caller“. Nach {ACTIVE_LOST_AFTER_IDLE} Calling-Tagen in Folge ohne
            Anwahlen ist er wieder weg.
            {team ? " Als Team hast du schon jetzt Zugang zu allen Sessions." : ""}
          </p>
        )}
        {state.lostAt && (
          <p className="ac-warn">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>
              Am {day(state.lostAt)} nach {ACTIVE_LOST_AFTER_IDLE} Calling-Tagen ohne Anwahlen
              verloren. Mit {ACTIVE_RUN_DAYS} Tagen am Stück ist er wieder da.
            </span>
          </p>
        )}
        {compact && (
          <Link className="ac-link" href="/sessions?modus=eigen">
            Was du damit freischaltest
          </Link>
        )}
      </div>
    </section>
  );
}
