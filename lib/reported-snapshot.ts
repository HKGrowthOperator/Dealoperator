import {
  emptyCounts,
  participantKind,
  type Counts,
  type ParticipantKind,
  type RankingRow,
} from "./kpis";

/**
 * Echter gemeldeter Zwischenstand vom 22.09.2026, freigegeben zur
 * Veröffentlichung über den administrativen Freigabeweg.
 *
 * Bewusst enthalten sind ausschließlich Anzeigename, Datum und Kennzahlen.
 * Quellenzitate, Slack-/Zoom-Verweise, interne Prüfnotizen, E-Mail-Adressen
 * und Telefonnummern gehören NICHT hierher und stehen nicht in dieser Datei.
 *
 * Diese Momentaufnahme trägt die öffentliche Ansicht nur so lange, bis die
 * Datenbankverbindung steht. Dieselben Zeilen werden mit demselben
 * participantKey importiert, damit beim Umschalten keine Duplikate entstehen.
 *
 * Kein vollständiger Tages-Endstand: Zoom-Export 13:07–17:29 und ein
 * Slack-Teilauszug. Unbekannte Werte bleiben null, niemals 0.
 */
export const REPORTED_DAY = "2026-09-22";
export const REPORTED_LABEL = "Gemeldeter Stand · 22. September";

type Row = {
  key: string;
  name: string;
  /** Ohne Angabe eine Person. "joint" = gemeinsame Meldung. */
  kind?: ParticipantKind;
  counts: Partial<Counts>;
};

const ROWS: Row[] = [
  { key: "akq-2026-joshua-brinker", name: "Joshua Brinker", counts: { settingsBooked: 1 } },
  { key: "akq-2026-luis-letzgus", name: "Luis Letzgus", counts: { settingsBooked: 2 } },
  { key: "akq-2026-tina-dreher", name: "Tina Dreher", counts: { attempts: 50, settingsBooked: 1 } },
  { key: "akq-2026-gianluca-li-bergolis", name: "Gianluca Li Bergolis", counts: { closingsBooked: 1 } },
  { key: "akq-2026-melanie-sorokin", name: "Melanie Sorokin", counts: { settingsBooked: 2 } },
  { key: "akq-2026-kai-ozcan", name: "Kai Özcan", counts: { attempts: 50 } },
  {
    key: "akq-2026-jonathan-cocks",
    name: "Jonathan Cocks",
    counts: { attempts: 23, settingsBooked: 3, settingsHeld: 1, closingsBooked: 1 },
  },
  { key: "akq-2026-jonas-irmisch", name: "Jonas Irmisch", counts: { attempts: 172, settingsBooked: 4 } },
  { key: "akq-2026-anna", name: "Anna", counts: { attempts: 80, settingsBooked: 1 } },
  // Termintyp offen: getrennt als legacyMeetings, ausdrücklich nicht als Setting.
  { key: "akq-2026-marlon-moschner", name: "Marlon Moschner", counts: { legacyMeetings: 4 } },
  { key: "akq-2026-ennio", name: "Ennio", counts: { settingsBooked: 2 } },
  { key: "akq-2026-musa", name: "Musa", counts: { settingsBooked: 3 } },
  // Persönlicher Zwischenstand aus dem Zoom-Chat. Der gemeinsame
  // Abschlussstand von Myran und Baris ist inzwischen 50/50 aufgeteilt und
  // steht in lib/joint-reports.ts; hier zählt nur diese eine Person.
  { key: "akq-2026-myran-omo-person", name: "Myran Omo", counts: { attempts: 150, settingsBooked: 1 } },
  { key: "akq-2026-phil-mohan", name: "Phil Mohan", counts: { attempts: 151, settingsBooked: 1 } },
  { key: "akq-2026-jonathan-balzer", name: "Jonathan Balzer", counts: { attempts: 123, settingsBooked: 1 } },
  { key: "akq-2026-max-rohde", name: "Max Rohde", counts: { attempts: 100 } },
  { key: "akq-2026-paul-strzelczyk", name: "Paul Strzelczyk", counts: { attempts: 107, settingsBooked: 3 } },
  { key: "akq-2026-linus", name: "Linus", counts: { attempts: 93 } },
  { key: "akq-2026-luca-palumbo", name: "Luca Palumbo", counts: { attempts: 82 } },
  { key: "akq-2026-ayman", name: "Ayman", counts: { attempts: 85 } },
  { key: "akq-2026-gagan", name: "Gagan", counts: { attempts: 50 } },
  { key: "akq-2026-robert-marzecki", name: "Robert Marzecki", counts: { settingsBooked: 2 } },
  { key: "akq-2026-marc", name: "Marc", counts: { attempts: 100, settingsBooked: 7 } },
];

/** Öffentliche Rangliste aus der Momentaufnahme. Keine privaten Felder. */
export function reportedSnapshot(): RankingRow[] {
  return ROWS.map((r) => ({
    id: r.key,
    key: r.key,
    name: r.name,
    company: "",
    role: "",
    kind: participantKind(r.kind),
    claimed: false,
    counts: { ...emptyCounts(), ...r.counts } as Counts,
    source: REPORTED_LABEL,
    updatedAt: `${REPORTED_DAY}T00:00:00.000Z`,
  }));
}

/** Importzeilen für die Datenbank — identische Werte, identischer Schlüssel. */
export function reportedImportRows() {
  return ROWS.map((r) => ({
    participantKey: r.key,
    name: r.name,
    company: "",
    role: "",
    email: "",
    date: REPORTED_DAY,
    counts: { ...emptyCounts(), ...r.counts } as Counts,
    publicConsent: true,
    kind: participantKind(r.kind),
  }));
}
