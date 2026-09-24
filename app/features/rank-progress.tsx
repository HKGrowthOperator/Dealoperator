import type { CSSProperties } from "react";
import { aggregate, emptyCounts, progress } from "@/lib/kpis";
import { levelCard } from "@/lib/levels";
import type { RecordDay } from "../data";

/**
 * Leistungslevel im Detail (unter „Mein Fortschritt“): je Kennzahl eine
 * ruhige Zeile mit Leiste und dem Stand in echten Einheiten. Ohne erreichtes
 * Level steht nur, wie weit es bis Level 1 ist.
 */
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
    <section className="ca-section lv" aria-labelledby="lv-title">
      <div className="ca-section-head">
        <h2 id="lv-title">Leistungslevel</h2>
        <span>aus allen deinen Tagen</span>
      </div>
      <ul className="lv-list">
        {progress(values)
          .map(levelCard)
          .map((card) => (
            <li key={card.id} data-maxed={card.maxed || undefined}>
              <div className="lv-top">
                <strong>{card.label}</strong>
                {card.level > 0 && <span className="lv-badge">{card.title}</span>}
                <span className="lv-count">{card.progressText}</span>
              </div>
              <div
                className="lv-bar"
                role="progressbar"
                aria-label={card.barLabel}
                aria-valuemin={0}
                aria-valuemax={card.goalValue ?? card.value}
                aria-valuenow={card.value}
                aria-valuetext={card.progressText}
              >
                <i style={{ "--p": `${card.percent}%` } as CSSProperties} />
              </div>
              <p>{card.remainingText}</p>
            </li>
          ))}
      </ul>
    </section>
  );
}
