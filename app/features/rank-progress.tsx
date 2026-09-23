import type { CSSProperties } from "react";
import { aggregate, emptyCounts, progress } from "@/lib/kpis";
import { levelCard } from "@/lib/levels";
import type { RecordDay } from "../data";

/**
 * Vier getrennte Level, je eines pro KPI. Die XP-Leiste lädt sich beim
 * Erscheinen von 0 bis zum aktuellen Stand auf (reines CSS, siehe
 * .xp-fill in globals.css); bei „Bewegung reduzieren" steht sie sofort.
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
    <section className="kpi-levels" aria-label="Deine vier KPI-Level">
      <div className="section-caption">
        <span>DEIN GESAMTER FORTSCHRITT</span>
        <span>1 XP = 1 Anwahl, 1 Setting, 1 Closing oder 1 Deal</span>
      </div>
      <div className="kpi-track-grid">
        {progress(values)
          .map(levelCard)
          .map((card, i) => (
            <div
              className="kpi-track"
              data-level={card.level}
              data-maxed={card.maxed || undefined}
              key={card.id}
              style={{ "--i": i } as CSSProperties}
            >
              <span className="kpi-track-label">{card.label}</span>
              <strong className="kpi-track-level">{card.title}</strong>
              <p className="kpi-track-goal">{card.goal}</p>
              <div className="kpi-track-xp">
                <div
                  className="xp-bar"
                  role="progressbar"
                  aria-label={card.barLabel}
                  aria-valuemin={0}
                  aria-valuemax={card.xpGoal ?? card.xp}
                  aria-valuenow={card.xp}
                  aria-valuetext={card.barText}
                >
                  <span
                    className="xp-fill"
                    data-empty={card.xp === 0 || undefined}
                    style={{ "--xp": card.percent } as CSSProperties}
                  />
                </div>
                <span className="kpi-track-xp-text" title={card.xpUnit}>
                  {card.xpText}
                </span>
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
