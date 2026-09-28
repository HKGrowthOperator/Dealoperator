import type { CommitmentSettings } from "@/lib/commitment";

/*
 * Nach dem Einreichen geht es direkt zu den Ergebnissen. Was die Bestätigung
 * dort sagen soll (Tag, Folge für die Serie, neues Level), reist nicht in der
 * Adresse mit, sondern kurz im Tab: einmal lesen, dann weg.
 */

export type SubmittedNote = {
  day: string;
  unchanged: boolean;
  /** Die Folge des Einreichens in einem Satz (Serie, Frist, freier Tag). */
  effect: string | null;
  levelUps: string[];
  /** Für das einmalige Erinnerungs-Angebot: die geltenden Zeiten. */
  settings: CommitmentSettings | null;
};

const KEY = "do-eingereicht";

export function rememberSubmitted(note: SubmittedNote) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(note));
  } catch {
    /* ohne Speicher zeigt die Ergebnisseite nur die kurze Bestätigung */
  }
}

/** Die Notiz zum Tag, genau einmal. */
export function takeSubmitted(day: string): SubmittedNote | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const note = JSON.parse(raw) as SubmittedNote;
    return note && note.day === day ? note : null;
  } catch {
    return null;
  }
}
