import { aggregate, emptyCounts, progress } from "@/lib/kpis";
import { levelCard } from "@/lib/levels";
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
    <section aria-label="Deine vier KPI-Level">
      <div className="section-caption">
        <span>DEIN GESAMTER FORTSCHRITT</span>
        <span>1 XP = 1 Anwahl, 1 Setting, 1 Closing oder 1 Deal</span>
      </div>
      <div className="kpi-track-grid">
        {progress(values)
          .map(levelCard)
          .map((card) => (
            <div className="kpi-track" key={card.id}>
              <span>{card.label}</span>
              <strong>{card.title}</strong>
              <small>{card.xpText}</small>
              <progress
                max="100"
                value={card.percent}
                aria-label={card.barLabel}
              />
              <small>{card.goal}</small>
            </div>
          ))}
      </div>
    </section>
  );
}
