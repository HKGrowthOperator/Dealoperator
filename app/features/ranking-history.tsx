"use client";
import { useState } from "react";
import { CalendarDays, Trophy } from "lucide-react";
import type { VisibleMetric } from "@/lib/kpis";
import {
  AKQUISE_DAY,
  formatDay,
  formatMonth,
  metricShortLabels,
  monthRange,
  type RankingDay,
} from "@/lib/ranking-history";

const fmt = (value: number | null) =>
  value === null ? "—" : value.toLocaleString("de-DE");
export default function RankingHistory({
  month,
  days,
  metric,
  selectedDay,
  today,
  onDay,
}: {
  month: string;
  days: RankingDay[];
  metric: VisibleMetric;
  selectedDay?: string;
  today: string;
  onDay: (day: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const lastDay = Number(monthRange(month, today).last.slice(-2));
  const calendarDays = Array.from(
    { length: lastDay },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
  const byDay = new Map(days.map((day) => [day.day, day]));
  const max = Math.max(1, ...days.map((day) => day.counts[metric] ?? 0));
  const highlighted = byDay.get(
    hovered || selectedDay || days.at(-1)?.day || "",
  );
  const leaders = days.filter((day) => day.leaders[metric]).toReversed();
  const offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const label = (day: string) => {
    const entry = byDay.get(day);
    const winner = entry?.leaders[metric];
    return `${formatDay(day)}${day === AKQUISE_DAY ? ", Akquise Day" : ""}: ${entry ? `${fmt(entry.counts[metric])} ${metricShortLabels[metric]}` : "keine Meldung"}${winner ? `. Platz 1: ${winner.people.map((person) => person.name).join(", ")} mit ${fmt(winner.value)}` : ""}`;
  };
  return (
    <section
      className="rr-history rr-glass"
      aria-label="Tagesverlauf und Archiv"
    >
      <div className="rr-panel-heading">
        <span className="rr-eyebrow">
          <CalendarDays size={15} /> DEIN MONAT IM BLICK
        </span>
        <h2>{formatMonth(month)}</h2>
        <p>Jeder Balken ein Tag. Jeder Tag ein neuer Start.</p>
      </div>
      <div className="rr-chart-reading" aria-live="polite">
        <div>
          <span>
            {highlighted ? formatDay(highlighted.day, true) : "Tagesleistung"}
          </span>
          <strong>{fmt(highlighted?.counts[metric] ?? null)}</strong>
        </div>
        <span>
          {metricShortLabels[metric]}
          <small>
            {days.length} {days.length === 1 ? "Tag" : "Tage"} mit Meldungen
          </small>
        </span>
      </div>
      <div
        className="rr-daily-chart"
        role="group"
        aria-label={`${metricShortLabels[metric]} pro Tag. Tag auswählen, um sein Ranking zu öffnen.`}
        onMouseLeave={() => setHovered(null)}
      >
        {calendarDays.map((day) => {
          const entry = byDay.get(day);
          const value = entry?.counts[metric] ?? null;
          return (
            <button
              key={day}
              disabled={day > today}
              aria-label={label(day)}
              title={label(day)}
              aria-pressed={selectedDay === day}
              data-selected={selectedDay === day}
              data-event={day === AKQUISE_DAY}
              data-missing={value === null}
              onMouseEnter={() => setHovered(day)}
              onFocus={() => setHovered(day)}
              onBlur={() => setHovered(null)}
              onClick={() => onDay(day)}
            >
              <span
                style={{
                  height:
                    value === null
                      ? "3px"
                      : `${Math.max(2, (value / max) * 100)}%`,
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="rr-chart-axis">
        <span>01</span>
        <span>15</span>
        <span>{lastDay}</span>
      </div>
      <div className="rr-chart-legend">
        <span>
          <i />
          Gemeldeter Tageswert
        </span>
        <span>
          <i className="missing" />
          Keine Meldung
        </span>
      </div>
      <div className="rr-calendar-heading">
        <h3>Dein Tagesarchiv</h3>
        <span>Tag antippen</span>
      </div>
      <div
        className="rr-calendar"
        role="group"
        aria-label="Tag im Archiv auswählen"
      >
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => (
          <span className="rr-weekday" key={day}>
            {day}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {calendarDays.map((day) => (
          <button
            key={day}
            disabled={day > today}
            title={label(day)}
            aria-label={label(day)}
            aria-pressed={selectedDay === day}
            data-selected={selectedDay === day}
            data-reported={byDay.has(day)}
            data-event={day === AKQUISE_DAY}
            onClick={() => onDay(day)}
          >
            <span>{Number(day.slice(-2))}</span>
            <small>
              {byDay.has(day) ? fmt(byDay.get(day)!.counts[metric]) : "·"}
            </small>
          </button>
        ))}
      </div>
      {month === AKQUISE_DAY.slice(0, 7) && (
        <button
          className="rr-event-shortcut"
          onClick={() => onDay(AKQUISE_DAY)}
        >
          <span className="rr-event-dot" />
          22.09. · Akquise Day <span>akquise.de</span>
        </button>
      )}
      <div className="rr-calendar-heading">
        <h3>
          <Trophy size={16} /> Tagesgewinner
        </h3>
        <span>{metricShortLabels[metric]}</span>
      </div>
      {leaders.length ? (
        <div className="rr-daily-winners">
          {leaders.map((day) => {
            const leader = day.leaders[metric]!;
            return (
              <button key={day.day} onClick={() => onDay(day.day)}>
                <span className="rr-winner-date">
                  {formatDay(day.day, true)}
                </span>
                <span className="rr-winner-names">
                  {leader.people.map((p) => p.name).join(" & ")}
                  <small>
                    {day.day === AKQUISE_DAY
                      ? "Akquise Day"
                      : leader.people.length > 1
                        ? "Geteilter erster Platz"
                        : "Platz 1"}
                  </small>
                </span>
                <strong>{fmt(leader.value)}</strong>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rr-quiet-note">
          Sobald positive Werte gemeldet sind, siehst du hier die Spitzenplätze
          jedes Tages.
        </p>
      )}
      <p className="rr-quiet-note">
        Keine Meldung ist keine Null. Nachgetragene oder korrigierte Tagesstände
        aktualisieren auch das Archiv.
      </p>
    </section>
  );
}
