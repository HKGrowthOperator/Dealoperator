"use client";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Trophy } from "lucide-react";
import { Badge, Feedback } from "./admin-shared";

type Person = {
  id: string;
  name: string;
  strongDays: string[];
  reports: number;
  shots: { day: string; attempts: number | null; talkMinutes: number | null }[];
};
type Month = { enabled: false } | { enabled: true; month: string; target: number; people: Person[] };

const monthKey = (offset: number) => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 15));
  return d.toISOString().slice(0, 7);
};
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;
const hours = (minutes: number | null) =>
  minutes === null ? "" : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;

/**
 * Monatsstand fürs Team: wer an drei Tagen 100+ Anwahlen und 1,5 Stunden
 * Gesprächszeit mit Screenshot geschafft hat, und wie viele eigene
 * Tagesabschlüsse mit mindestens 50 Anwahlen es gibt. Screenshots öffnen sich
 * in einem neuen Tab und sind nur fürs Team abrufbar.
 */
export function EvidencePanel() {
  const [month, setMonth] = useState(monthKey(0));
  const [data, setData] = useState<Month | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async (m: string) => {
    setError("");
    try {
      const r = await fetch(`/api/evidence?monat=${m}&team=1`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Der Monatsstand ist gerade nicht abrufbar.");
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(month), 0);
    return () => clearTimeout(t);
  }, [load, month]);

  return (
    <section className="adm-card" aria-labelledby="adm-evidence-title">
      <div className="adm-card-head">
        <span className="adm-card-icon" aria-hidden="true">
          <Trophy size={20} />
        </span>
        <div>
          <h2 id="adm-evidence-title">Monatsstand {monthLabel(month)}</h2>
          <p>
            Starker Tag: eigener Tagesabschluss mit mindestens 100 Anwahlen, 1,5 Stunden Gesprächszeit
            und Screenshot. Screenshots sieht nur das Team.
          </p>
        </div>
      </div>
      <div className="adm-actions">
        {[0, -1].map((o) => (
          <button
            key={o}
            className={`btn ${month === monthKey(o) ? "primary" : "secondary"}`}
            onClick={() => setMonth(monthKey(o))}
          >
            {monthLabel(monthKey(o))}
          </button>
        ))}
        <button className="btn secondary" onClick={() => void load(month)}>
          <RefreshCw size={16} aria-hidden="true" />
          Neu laden
        </button>
      </div>
      {error && <Feedback error={error} />}
      {data && !data.enabled && (
        <p className="adm-empty">
          Gesprächszeit und Screenshots sind noch nicht freigeschaltet. Dafür fehlt Migration 0005 in der
          Datenbank (siehe docs/DEPLOYMENT.md).
        </p>
      )}
      {data?.enabled && !data.people.length && <p className="adm-empty">In diesem Monat gibt es noch nichts dazu.</p>}
      {data?.enabled && data.people.length > 0 && (
        <ul className="adm-list adm-evidence">
          {data.people.map((p) => (
            <li className="adm-item" key={p.id}>
              <div className="adm-item-head">
                {p.strongDays.length >= data.target && <Badge tone="ok">{data.target} starke Tage</Badge>}
                <span className="adm-meta">
                  Starke Tage {p.strongDays.length} von {data.target}
                  {p.strongDays.length ? ` (${p.strongDays.map(shortDay).join(", ")})` : ""} · Abschlüsse ab 50
                  Anwahlen: {p.reports}
                </span>
              </div>
              <h3>{p.name}</h3>
              {p.shots.length > 0 && (
                <p className="adm-shots">
                  {p.shots.map((s) => (
                    <a
                      key={s.day}
                      href={`/api/evidence?tag=${s.day}&bild=1&profil=${encodeURIComponent(p.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {shortDay(s.day)}
                      {s.attempts !== null ? ` · ${s.attempts} Anwahlen` : ""}
                      {s.talkMinutes !== null ? ` · ${hours(s.talkMinutes)}` : ""}
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
