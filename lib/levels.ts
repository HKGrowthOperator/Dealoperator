import type { TrackId, TrackProgress } from "./kpis";

/**
 * Texte der Level-Karten in „Dein Bereich".
 *
 * Reine Funktion ohne Oberfläche, damit Wortlaut und Zahlen getestet werden
 * können. Die Schwellen selbst stehen in `tracks` (lib/kpis.ts); 1 XP ist
 * genau eine Einheit der Kennzahl des Tracks.
 */
const units: Record<TrackId, { many: string; first: string; xp: string }> = {
  dialer: {
    many: "Anwahlen",
    first: "nach der ersten Anwahl",
    xp: "1 XP = 1 Anwahl",
  },
  setter: {
    many: "gelegten Settings",
    first: "nach dem ersten gelegten Setting",
    xp: "1 XP = 1 gelegtes Setting",
  },
  closer: {
    many: "gelegten Closings",
    first: "nach dem ersten gelegten Closing",
    xp: "1 XP = 1 gelegtes Closing",
  },
  "deal-maker": {
    many: "Deals",
    first: "nach dem ersten Deal",
    xp: "1 XP = 1 Deal",
  },
};

const number = (n: number) => n.toLocaleString("de-DE");

/** „Level 3" oder, vor der ersten Schwelle, „Noch kein Level". */
export function levelName(level: number) {
  return level > 0 ? `Level ${level}` : "Noch kein Level";
}

/** „Level 1 ab 100 Anwahlen", „Level 1 nach dem ersten Deal" … */
export function levelGoal(id: TrackId, level: number, threshold: number) {
  const unit = units[id];
  return threshold === 1
    ? `Level ${level} ${unit.first}`
    : `Level ${level} ab ${number(threshold)} ${unit.many}`;
}

export function levelCard(t: TrackProgress) {
  const maxed = t.next === null;
  const xpText =
    t.next === null
      ? `${number(t.xp)} XP`
      : `${number(t.xp)} / ${number(t.next)} XP`;
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
    xp: t.xp,
    xpGoal: t.next,
    xpText,
    xpUnit: units[t.id].xp,
    percent: t.percent,
    /** Name der Leiste für Screenreader. */
    barLabel: maxed
      ? `${t.label}: höchstes Level erreicht`
      : `${t.label}: XP bis Level ${t.level + 1}`,
    /** Vorgelesener Stand der Leiste. */
    barText: xpText.replace(" / ", " von "),
  };
}
export type LevelCard = ReturnType<typeof levelCard>;
