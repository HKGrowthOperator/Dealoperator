"use client";
import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { aggregate, emptyCounts, progress, type Counts } from "@/lib/kpis";
import { focusTrack, levelCard } from "@/lib/levels";
import { CLOSING_CHANGED, fetchClosingState, type ClosingState } from "./closing-form";

/**
 * Kompakter Stand unter dem Tagesabschluss: Abschluss-Serie und das
 * Leistungslevel, das als Nächstes erreichbar ist. Details stehen unter
 * „Mein Fortschritt“.
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
  const level = focusTrack(
    progress(
      aggregate(state.closings.map((c) => ({ ...emptyCounts(), ...c.counts }) as Counts)),
    ).map(levelCard),
  );
  return (
    <section className="md-progress" aria-label="Mein Fortschritt kurz">
      <div>
        <span className="md-progress-label">Abschluss-Serie</span>
        <strong>
          {streak.current} {streak.current === 1 ? "Tag" : "Tage"}
        </strong>
        <small>Bestwert {streak.best}</small>
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
