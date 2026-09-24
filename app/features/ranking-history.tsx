"use client";
import { useState } from "react";
import type { VisibleMetric } from "@/lib/kpis";
import {
  eventLabel,
  formatDay,
  formatMonth,
  metricShortLabels,
  monthRange,
  type RankingDay,
  type RankingEvent,
} from "@/lib/ranking-history";

const fmt = (value: number | null) =>
  value === null ? "–" : value.toLocaleString("de-DE");

/**
 * Verlauf eines Monats: ein Balken je Tag (Einzelwert, keine laufende
 * Summe) und darunter die Tage mit Meldungen samt Platz 1. Ein Tag öffnet
 * sein Tagesranking. Kalender, Diagramm und Gewinner stehen nicht mehr als
 * gleichwertige Blöcke nebeneinander.
 */
export default function RankingHistory({
  month,
  days,
  metric,
  selectedDay,
  today,
  events,
  onDay,
}: {
  month: string;
  days: RankingDay[];
  metric: VisibleMetric;
  selectedDay?: string;
  today: string;
  /** Gekennzeichnete Tage (Akquise Days). Nur Kennzeichnung, keine Wertung. */
  events: RankingEvent[];
  onDay: (day: string) => void;
}) {
  const [all, setAll] = useState(false);
  const lastDay = Number(monthRange(month, today).last.slice(-2));
  const calendarDays = Array.from(
    { length: lastDay },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
  const byDay = new Map(days.map((day) => [day.day, day]));
  const eventByDay = new Map(events.map((event) => [event.day, event]));
  const max = Math.max(1, ...days.map((day) => day.counts[metric] ?? 0));
  const reported = days.toReversed();
  const shown = all ? reported : reported.slice(0, 5);
  const unit = metricShortLabels[metric];
  return (
    <section className="rb-history" aria-labelledby="rb-history-title">
      <div className="rb-section-head">
        <h2 id="rb-history-title">Verlauf {formatMonth(month)}</h2>
        <span>{unit} je Tag, keine laufende Summe</span>
      </div>
      <div className="rb-chart" aria-hidden="true">
        {calendarDays.map((day) => {
          const entry = byDay.get(day);
          const value = entry?.counts[metric] ?? null;
          const event = eventByDay.get(day);
          return (
            <button
              key={day}
              type="button"
              tabIndex={-1}
              disabled={day > today || !entry}
              title={`${formatDay(day)}: ${entry ? `${fmt(value)} ${unit}` : "keine Meldung"}${event ? ` · ${eventLabel(event)}` : ""}`}
              data-selected={selectedDay === day || undefined}
              data-event={event ? "" : undefined}
              data-missing={value === null || undefined}
              onClick={() => onDay(day)}
            >
              <span
                style={{
                  height: value === null ? "2px" : `${Math.max(3, (value / max) * 100)}%`,
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="rb-chart-axis" aria-hidden="true">
        <span>1.</span>
        <span>15.</span>
        <span>{lastDay}.</span>
      </div>
      {reported.length ? (
        <>
          <ol className="rb-days" aria-label={`Tage mit Meldungen im ${formatMonth(month)}`}>
            {shown.map((day) => {
              const leader = day.leaders[metric];
              const event = eventByDay.get(day.day);
              return (
                <li key={day.day}>
                  <button
                    type="button"
                    aria-current={selectedDay === day.day ? "date" : undefined}
                    onClick={() => onDay(day.day)}
                  >
                    <span className="rb-day-date">
                      {formatDay(day.day, true)}
                      {event && <em>{event.title}</em>}
                    </span>
                    <span className="rb-day-leader">
                      {leader
                        ? `Platz 1: ${leader.people.map((p) => p.name).join(" und ")}`
                        : "Kein Platz 1"}
                    </span>
                    <strong>
                      {fmt(day.counts[metric])}
                      <small>{unit}</small>
                    </strong>
                  </button>
                </li>
              );
            })}
          </ol>
          {reported.length > 5 && (
            <button type="button" className="do-link rb-more" onClick={() => setAll((v) => !v)}>
              {all ? "Weniger Tage zeigen" : `Alle ${reported.length} Tage zeigen`}
            </button>
          )}
        </>
      ) : (
        <p className="rb-quiet">In diesem Monat gibt es noch keine öffentlichen Meldungen.</p>
      )}
    </section>
  );
}
