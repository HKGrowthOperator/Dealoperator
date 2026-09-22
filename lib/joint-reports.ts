import type { Counts, Metric } from "./kpis";

/**
 * Gemeinsame Abschlussmeldungen vom 22.09.2026 und ihre Aufteilung.
 *
 * Zwei Duos haben am Abend einen gemeinsamen Tagesstand gemeldet. Auf
 * ausdrücklichen Wunsch werden diese Zahlen 50/50 auf die beteiligten
 * Personen aufgeteilt, damit jede Person im Einzelranking antritt.
 *
 * Wichtig: das sind **rechnerisch zugeteilte Werte**, keine einzeln
 * gemeldeten. Diese Datei ist der nachvollziehbare Beleg dafür — sie hält
 * die Originalmeldung und die Aufteilung nebeneinander fest, und die
 * Oberfläche schreibt an die betroffenen Profile, woher ihre Zahlen kommen.
 *
 * Damit die Gruppenleistung dieselbe bleibt, sind die aufgeteilten Werte im
 * Quelldatensatz auf null gesetzt: sie zählen jetzt über die Personen. Was
 * sich nicht aufteilen ließ, bleibt im Quelldatensatz stehen und zählt
 * weiterhin genau einmal dort.
 */
export type JointPart = {
  /** Stabiler Importschlüssel der Person. */
  key: string;
  name: string;
  counts: Partial<Counts>;
};
export type JointReport = {
  /** Importschlüssel des gemeinsamen Datensatzes. */
  key: string;
  name: string;
  day: string;
  reportedAt: string;
  /** Die gemeinsame Meldung, so wie sie eingegangen ist. */
  report: Partial<Counts>;
  /** Die 50/50 zugeteilten Werte je Person. */
  parts: JointPart[];
  /**
   * Kennzahlen, die sich nicht ganzzahlig teilen lassen. Sie bleiben im
   * Quelldatensatz und werden ausdrücklich nicht gerundet.
   */
  kept: { metric: Metric; total: number; perPerson: number; why: string }[];
};

export const jointReports: JointReport[] = [
  {
    key: "akq-2026-david-jannik",
    name: "David & Jannik",
    day: "2026-09-22",
    reportedAt: "18:02",
    report: { attempts: 222, legacyMeetings: 13 },
    parts: [
      {
        key: "akq-2026-david-pixner",
        name: "David Pixner",
        counts: { attempts: 111 },
      },
      {
        key: "akq-2026-jannik-alber",
        name: "Jannik Alber",
        counts: { attempts: 111 },
      },
    ],
    kept: [
      {
        metric: "legacyMeetings",
        total: 13,
        perPerson: 6.5,
        why: "13 Termine ohne Typangabe ergeben rechnerisch 6,5 je Person. Halbe Termine gibt es nicht, gerundet wird nicht, und aus einem Termin ohne Typangabe wird kein Setting und kein Closing. Die Kennzahl ist öffentlich ohnehin ausgeblendet, deshalb bleiben die 13 ungeteilt im Quelldatensatz.",
      },
    ],
  },
  {
    key: "akq-2026-myran-omo",
    name: "Myran und Baris",
    day: "2026-09-22",
    reportedAt: "18:01",
    report: { attempts: 300, settingsBooked: 2 },
    parts: [
      {
        key: "akq-2026-myran-omo-person",
        name: "Myran Omo",
        counts: { attempts: 150, settingsBooked: 1 },
      },
      {
        key: "akq-2026-baris",
        name: "Baris",
        counts: { attempts: 150, settingsBooked: 1 },
      },
    ],
    kept: [],
  },
];

/** Kurzer Hinweis für ein Profil, dessen Zahlen zugeteilt wurden. */
export const SPLIT_NOTE = "50/50 aus gemeinsamer Meldung aufgeteilt";

const partIndex = new Map(
  jointReports.flatMap((joint) =>
    joint.parts.map((part) => [part.key, joint] as const),
  ),
);

/** Die gemeinsame Meldung, aus der die Zahlen dieses Profils stammen. */
export function splitOrigin(key?: string | null): JointReport | null {
  return (key && partIndex.get(key)) || null;
}

/** Der gemeinsame Datensatz selbst, falls dieser Schlüssel einer ist. */
export function jointReport(key?: string | null): JointReport | null {
  return jointReports.find((joint) => joint.key === key) || null;
}

/**
 * Prüft, dass die Aufteilung die Meldung weder vergrößert noch verkleinert.
 *
 * Für jede aufgeteilte Kennzahl muss die Summe der Anteile genau dem
 * gemeldeten Wert entsprechen, und jede Kennzahl der Meldung muss entweder
 * aufgeteilt oder ausdrücklich als „bleibt stehen" vermerkt sein. Sonst
 * würde die Gruppenleistung durch die Aufteilung still größer oder kleiner.
 */
export function splitProblems(joint: JointReport): string[] {
  const problems: string[] = [];
  const kept = new Set(joint.kept.map((k) => k.metric));
  const metrics = new Set<Metric>([
    ...(Object.keys(joint.report) as Metric[]),
    ...joint.parts.flatMap((p) => Object.keys(p.counts) as Metric[]),
  ]);
  for (const metric of metrics) {
    const reported = joint.report[metric] ?? null;
    const shares = joint.parts.map((p) => p.counts[metric] ?? null);
    const distributed = shares.some((v) => v !== null);
    if (kept.has(metric)) {
      if (distributed)
        problems.push(
          `${joint.key}: ${metric} ist als „bleibt stehen" vermerkt und trotzdem aufgeteilt.`,
        );
      continue;
    }
    if (!distributed) {
      problems.push(
        `${joint.key}: ${metric} ist weder aufgeteilt noch als „bleibt stehen" vermerkt.`,
      );
      continue;
    }
    const sum = shares.reduce<number>((total, v) => total + (v ?? 0), 0);
    if (reported === null)
      problems.push(
        `${joint.key}: ${metric} ist aufgeteilt, war aber gar nicht gemeldet.`,
      );
    else if (sum !== reported)
      problems.push(
        `${joint.key}: ${metric} ergibt aufgeteilt ${sum}, gemeldet waren ${reported}.`,
      );
  }
  return problems;
}
