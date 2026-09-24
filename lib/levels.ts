import type { TrackId, TrackProgress } from "./kpis";

/**
 * Texte der Leistungslevel.
 *
 * Reine Funktion ohne Oberfläche, damit Wortlaut und Zahlen getestet werden
 * können. Die Schwellen stehen in `tracks` (lib/kpis.ts). Fortschritt wird
 * immer in echten Einheiten beschrieben („80 von 100 Anwahlen“), nie in
 * Punkten.
 */
const units: Record<TrackId, { one: string; many: string; first: string }> = {
  dialer: { one: "Anwahl", many: "Anwahlen", first: "nach der ersten Anwahl" },
  setter: { one: "Setting", many: "Settings", first: "nach dem ersten Setting" },
  closer: { one: "Closing", many: "Closings", first: "nach dem ersten Closing" },
  "deal-maker": { one: "Deal", many: "Deals", first: "nach dem ersten Deal" },
};

const number = (n: number) => n.toLocaleString("de-DE");
const unit = (id: TrackId, n: number) => (n === 1 ? units[id].one : units[id].many);

/** „Level 3“ oder, vor der ersten Schwelle, „Noch kein Level“. */
export function levelName(level: number) {
  return level > 0 ? `Level ${level}` : "Noch kein Level";
}

/** „Level 1 ab 100 Anwahlen“, „Level 1 nach dem ersten Deal“ … */
export function levelGoal(id: TrackId, level: number, threshold: number) {
  return threshold === 1
    ? `Level ${level} ${units[id].first}`
    : `Level ${level} ab ${number(threshold)} ${units[id].many}`;
}

export function levelCard(t: TrackProgress) {
  const maxed = t.next === null;
  const remaining = t.next === null ? 0 : Math.max(0, t.next - t.xp);
  /** „80 von 100 Anwahlen“ bzw. beim höchsten Level „1.200 Anwahlen“. */
  const progressText =
    t.next === null
      ? `${number(t.xp)} ${unit(t.id, t.xp)}`
      : `${number(t.xp)} von ${number(t.next)} ${unit(t.id, t.next)}`;
  return {
    id: t.id,
    label: t.label,
    level: t.level,
    maxed,
    title: levelName(t.level),
    goal:
      t.next === null
        ? "Höchstes Level erreicht"
        : levelGoal(t.id, t.level + 1, t.next),
    /** Erreichte Einheiten (Anwahlen, Settings, …). */
    value: t.xp,
    goalValue: t.next,
    progressText,
    /** „Noch 2 Settings bis Level 2“. */
    remainingText:
      t.next === null
        ? "Höchstes Level erreicht"
        : `Noch ${number(remaining)} ${unit(t.id, remaining)} bis Level ${t.level + 1}`,
    percent: t.percent,
    /** Name der Leiste für Screenreader. */
    barLabel: maxed
      ? `${t.label}: höchstes Level erreicht`
      : `${t.label}: Fortschritt bis Level ${t.level + 1}`,
  };
}
export type LevelCard = ReturnType<typeof levelCard>;

/**
 * Der Track, der dem nächsten Level am nächsten ist (für die kompakte
 * Anzeige). Bei Gleichstand gilt die Reihenfolge der Tracks.
 */
export function focusTrack(cards: LevelCard[]) {
  const open = cards.filter((c) => !c.maxed);
  if (!open.length) return cards[0];
  return open.reduce((best, c) => (c.percent > best.percent ? c : best), open[0]);
}
