import Link from "next/link";
import { GAME_TEXT, bestRows, type PersonalBests as Bests } from "@/lib/game";
import "../game-progress.css";

/**
 * Karte „Deine Bestwerte“ unter „Mein Fortschritt“: eine ruhige Liste ohne
 * Kacheln, je Zeile Bezeichnung und Datum links, Wert rechts. Nur Werte über
 * 0, höchstens sechs Zeilen (bestRows in lib/game.ts). Grundlage ist der
 * Stand bis zur Frist, nicht der aktuelle Stand. Ein Tageswert öffnet den
 * Tag, Woche und Monat führen zu Meine Tage. Vor dem sechsten Tag mit
 * Meldung steht statt der Karte nur ein Satz.
 */
export default function PersonalBests({ bests, today }: { bests: Bests; today: string }) {
  if (!bests.show) return <p className="gp-bests-empty">{GAME_TEXT.bestsEmpty}</p>;
  const rows = bestRows(bests, today);
  // Nur gemeldete Nullen: nichts, was sich als Bestwert zeigen ließe.
  if (!rows.length) return null;
  return (
    <section className="ca-section gp-bests" aria-labelledby="gp-bests-title">
      <div className="ca-section-head">
        <h2 id="gp-bests-title">{GAME_TEXT.bestsTitle}</h2>
      </div>
      <ul className="gp-bests-list">
        {rows.map((row) => (
          <li key={row.key}>
            {/* Meine Tage braucht ?modus=eigen, sonst geht es über eine Weiterleitung. */}
            <Link
              className="gp-best"
              href={row.href === "/zahlen" ? "/zahlen?modus=eigen" : row.href}
            >
              <span className="gp-best-text">
                <span className="gp-best-label">{row.label}</span>
                <span className="gp-best-date">{row.date}</span>
              </span>
              <strong className="gp-best-value">{row.valueText}</strong>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
