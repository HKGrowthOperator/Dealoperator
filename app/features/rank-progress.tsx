import { aggregate, emptyCounts, progress } from "@/lib/kpis";
import type { RecordDay } from "../data";
export default function RankProgress({ records }: { records: RecordDay[] }) {
  const values = aggregate(
    records.map(
      (r) =>
        r.counts || {
          ...emptyCounts(),
          attempts: r.attempts ?? null,
          legacyMeetings: r.meetings ?? null,
        },
    ),
  );
  return (
    <section aria-label="Deine vier KPI-Ränge">
      <div className="section-caption">
        <span>DEIN GESAMTER FORTSCHRITT</span>
        <span>Vier getrennte Ränge · Pilotregeln</span>
      </div>
      <div className="kpi-track-grid">
        {progress(values).map((t) => (
          <div className="kpi-track" key={t.id}>
            <span>{t.label}</span>
            <strong>
              {t.value === null ? "Noch offen" : t.tier || "Auf dem Weg"}
            </strong>
            <small>
              {t.value === null
                ? "Noch keine zugeordneten Zahlen"
                : `${t.value.toLocaleString("de-DE")} ${t.metric === "attempts" ? "Anwahlversuche" : t.metric === "settingsBooked" ? "Settings vereinbart" : t.metric === "closingsBooked" ? "Closings vereinbart" : "Deals gewonnen"}`}
            </small>
            <progress
              max="100"
              value={t.percent}
              aria-label={`${t.label}: Fortschritt zur nächsten Stufe`}
            />
            <small>
              {t.next === null
                ? "Höchste Stufe erreicht"
                : t.value === null
                  ? `Erste Stufe ab ${t.next}`
                  : `Noch ${t.next - t.value} bis ${t.tier ? "zur nächsten Stufe" : "Bronze"}`}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
