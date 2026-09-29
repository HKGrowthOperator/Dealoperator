"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";

type Standing =
  | { enabled: false }
  | { enabled: true; month: string; strongDays: string[]; target: number; reports: number };

const monthName = (month: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: "Europe/Berlin" }).format(new Date(`${month}-15T12:00:00Z`));

const currentMonth = () =>
  new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", timeZone: "Europe/Berlin" }).format(new Date());

/**
 * Monatsstand unter Fortschritt: starke Tage (100+ Anwahlen und 1,5 Stunden
 * Gesprächszeit, mit Screenshot) und eigene Tagesabschlüsse ab 50 Anwahlen.
 * Erscheint nur, wenn Gesprächszeit und Screenshot freigeschaltet sind.
 */
export default function MonthStanding() {
  const [data, setData] = useState<Standing | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/evidence?monat=${currentMonth()}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then(setData)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!data?.enabled) return null;
  const strong = data.strongDays.length;
  return (
    <section className="ca-section ms-card" aria-labelledby="ms-title">
      <div className="ca-section-head">
        <h2 id="ms-title">Monatsstand {monthName(data.month)}</h2>
      </div>
      <dl className="ms-rows">
        <div>
          <dt>Tage mit 100+ Anwahlen und 1,5 Stunden Gesprächszeit, mit Screenshot</dt>
          <dd>
            <strong>
              {Math.min(strong, data.target)} von {data.target}
            </strong>
            <span className="ms-dots" aria-hidden="true">
              {Array.from({ length: data.target }, (_, i) => (
                <i key={i} data-on={i < strong ? "" : undefined} />
              ))}
            </span>
            {strong >= data.target && (
              <span className="ms-done">
                <CircleCheck size={16} aria-hidden="true" /> Geschafft
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Tagesabschlüsse mit mindestens 50 Anwahlen</dt>
          <dd>
            <strong>{data.reports}</strong>
          </dd>
        </div>
      </dl>
      <p className="ms-note">
        Gesprächszeit und Screenshot trägst du unter <Link href="/tagesabschluss">Mein Tag</Link> ein.
      </p>
    </section>
  );
}
