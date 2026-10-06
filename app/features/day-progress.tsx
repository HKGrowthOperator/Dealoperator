"use client";
import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { aggregate, emptyCounts, progress, type Counts } from "@/lib/kpis";
import { focusTrack, levelCard } from "@/lib/levels";
import { GAME_TEXT, flameState, nextEtappe } from "@/lib/game";
import { CLOSING_CHANGED, fetchClosingState, type ClosingState } from "./closing-form";
import { Flame } from "./game-parts";
import "../game-progress.css";

/**
 * Kompakter Stand unter dem Tagesabschluss: Serie mit Flamme und nächster
 * Etappe, dazu das Leistungslevel, das als Nächstes erreichbar ist. Details
 * stehen unter „Mein Fortschritt“. Bewusst ohne Tagesmarke: unter dem
 * Formular gibt es keine Vorschau beim Eintippen.
 */
export default function DayProgress({ initial }: { initial: ClosingState | null }) {
  const [state, setState] = useState<ClosingState | null>(initial);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      fetchClosingState(undefined, controller.signal)
        .then(setState)
        .catch(() => undefined);
    if (!initial) void refresh();
    window.addEventListener(CLOSING_CHANGED, refresh);
    return () => {
      controller.abort();
      window.removeEventListener(CLOSING_CHANGED, refresh);
    };
  }, [initial]);
  if (!state?.eligibility.participant) return null;
  const streak = state.summary?.streak ?? { current: 0, best: 0 };
  // Flamme aus der Tagesrunde (privat, mit Gefahr und Pause); ohne sie nur
  // nach der Länge, denn summary.atRisk meldet auch den offenen heutigen Tag.
  const flame = state.game?.streak.flame ?? flameState(streak, null, false);
  const next = nextEtappe(streak.current);
  const level = focusTrack(
    progress(
      aggregate(state.closings.map((c) => ({ ...emptyCounts(), ...c.counts }) as Counts)),
    ).map(levelCard),
  );
  // Noch nichts erreicht: eine Zeile statt einer leeren Karte.
  if (streak.current === 0 && streak.best === 0 && level.value === 0)
    return (
      <p className="md-progress-empty">
        Serie und Leistungslevel starten mit deinem ersten Tagesabschluss.{" "}
        <Link className="do-link" href="/heute?modus=eigen">
          Mein Fortschritt
        </Link>
      </p>
    );
  return (
    <section className="md-progress" aria-label="Mein Fortschritt kurz">
      <div>
        <span className="md-progress-label">Serie</span>
        <strong className="gp-flame-value">
          <Flame state={flame} size={20} />
          {streak.current > 0 ? GAME_TEXT.streakDays(streak.current) : "Noch keine"}
        </strong>
        {/* Unterwegs die nächste Etappe; bei 0 und nach allen Etappen der Bestwert. */}
        <small>
          {streak.current > 0 && next
            ? GAME_TEXT.nextEtappeShort(next)
            : streak.best > 0
              ? `Bestwert ${streak.best}`
              : "Startet mit dem nächsten rechtzeitigen Tagesabschluss"}
        </small>
      </div>
      <div>
        <span className="md-progress-label">Leistungslevel</span>
        <strong>
          {level.label}
          {level.level > 0 ? ` · ${level.title}` : ""}
        </strong>
        <span className="lv-bar lv-bar-small" aria-hidden="true">
          <i style={{ "--p": `${level.percent}%` } as CSSProperties} />
        </span>
        <small>{level.remainingText}</small>
      </div>
      <Link className="do-link" href="/heute?modus=eigen">
        Mein Fortschritt
      </Link>
    </section>
  );
}
