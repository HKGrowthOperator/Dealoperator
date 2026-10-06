import type { CommitmentSettings } from "@/lib/commitment";
import type { GameMoments } from "@/lib/game";
import { emptyCounts, type Counts } from "@/lib/kpis";

/*
 * Nach dem Einreichen geht es direkt zu den Ergebnissen. Was die Bestätigung
 * dort sagen soll (Tag, Folge für die Serie, Bilanz der Tagesrunde), reist
 * nicht in der Adresse mit, sondern kurz im Tab: einmal lesen, dann weg.
 */

export type SubmittedNote = {
  day: string;
  unchanged: boolean;
  /** Die Folge des Einreichens in einem Satz (Serie, Frist, freier Tag). */
  effect: string | null;
  /**
   * Die eingereichten Zahlen für die Zahlenzeile der Bilanz. null bei
   * älteren Notizen; dann kommt die Zeile aus der Rangliste.
   */
  counts: Partial<Counts> | null;
  /**
   * Bilanz vom Server (submitClosing, lib/game.ts gameMoments): Runde, Serie
   * vorher und nachher, Höhepunkte, „Als Nächstes“. null bei älteren Notizen
   * und wenn der Server keine Bilanz mitgeschickt hat.
   */
  game: GameMoments | null;
  /** Für das einmalige Erinnerungs-Angebot: die geltenden Zeiten. */
  settings: CommitmentSettings | null;
};

const KEY = "do-eingereicht";

/** Nur bekannte Kennzahlen mit ganzer Zahl oder null; sonst gilt die Notiz ohne Zahlen. */
function countsOf(value: unknown): Partial<Counts> | null {
  if (!value || typeof value !== "object") return null;
  const known = emptyCounts();
  const out: Partial<Counts> = {};
  for (const [key, n] of Object.entries(value)) {
    if (!(key in known)) continue;
    if (n !== null && !(typeof n === "number" && Number.isInteger(n) && n >= 0)) return null;
    out[key as keyof Counts] = n;
  }
  return out;
}

export function rememberSubmitted(note: SubmittedNote) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(note));
  } catch {
    /* ohne Speicher zeigt die Ergebnisseite nur die kurze Bestätigung */
  }
}

/**
 * Die Notiz zum Tag, genau einmal. Eine Notiz im früheren Format (mit
 * levelUps, ohne game und counts) aus einem noch offenen Tab gilt weiter,
 * nur ohne Bilanz.
 */
export function takeSubmitted(day: string): SubmittedNote | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const note = JSON.parse(raw) as Partial<SubmittedNote> | null;
    if (!note || note.day !== day) return null;
    return {
      day,
      unchanged: !!note.unchanged,
      effect: typeof note.effect === "string" ? note.effect : null,
      counts: countsOf(note.counts),
      game: note.game && typeof note.game === "object" ? note.game : null,
      settings: note.settings && typeof note.settings === "object" ? note.settings : null,
    };
  } catch {
    return null;
  }
}
