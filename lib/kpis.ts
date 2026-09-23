import { z } from "zod";
export const metricLabels = {
  attempts: "Anwahlversuche",
  decisionMakerConversations: "Entscheidergespräche",
  settingsBooked: "Settings vereinbart",
  settingsHeld: "Settings durchgeführt",
  closingsBooked: "Closings vereinbart",
  closingsHeld: "Closings durchgeführt",
  dealsWon: "Deals gewonnen",
  legacyMeetings: "Termine ohne Typangabe",
} as const;
export type Metric = keyof typeof metricLabels;
export const metrics = Object.keys(metricLabels) as Metric[];
/**
 * Kennzahlen, die öffentlich gezeigt werden.
 *
 * Entscheidergespräche und Termine ohne Typangabe sind bewusst NICHT dabei:
 * beides wurde nicht verlässlich erfasst. Die Werte bleiben gespeichert und
 * gehen nicht verloren — sie tragen nur keine öffentliche Aussage.
 */
export const publicMetrics = [
  "attempts",
  "settingsBooked",
  "settingsHeld",
  "closingsBooked",
  "closingsHeld",
  "dealsWon",
] as const satisfies readonly Metric[];
export type PublicMetric = (typeof publicMetrics)[number];
export const shortMetricLabels: Record<PublicMetric, string> = {
  attempts: "Calls",
  settingsBooked: "Settings",
  settingsHeld: "Settings gehalten",
  closingsBooked: "Closings",
  closingsHeld: "Closings gehalten",
  dealsWon: "Deals",
};
// Public views and exports share the verified metric selection.
export const visibleMetrics = [...publicMetrics];
export type VisibleMetric = PublicMetric;
export const numberSchema = z.number().int().min(0).max(100000).nullable();
export const countsSchema = z.object({
  attempts: numberSchema,
  decisionMakerConversations: numberSchema.default(null),
  settingsBooked: numberSchema,
  settingsHeld: numberSchema,
  closingsBooked: numberSchema,
  closingsHeld: numberSchema,
  dealsWon: numberSchema,
  legacyMeetings: numberSchema,
});
export type Counts = z.infer<typeof countsSchema>;
export const emptyCounts = (): Counts =>
  Object.fromEntries(metrics.map((k) => [k, null])) as Counts;
export function berlinDate(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(
    now,
  );
}
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const t = Date.parse(v);
    return (
      Number.isFinite(t) &&
      new Date(t).toISOString().slice(0, 10) === v &&
      v <= berlinDate()
    );
  }, "Wähle ein gültiges Datum, das nicht in der Zukunft liegt.");
/** Gültiges Kalenderdatum, auch in der Zukunft (Pausen, geplante Events). */
export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte ein Datum im Format JJJJ-MM-TT angeben.")
  .refine((v) => {
    const t = Date.parse(v);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
  }, "Bitte ein gültiges Datum angeben.");
export const tracks = [
  {
    id: "dialer",
    label: "Dialer",
    metric: "attempts",
    thresholds: [100, 500, 1500, 5000, 15000],
  },
  {
    id: "setter",
    label: "Setter",
    metric: "settingsBooked",
    thresholds: [5, 20, 50, 150, 400],
  },
  {
    id: "closer",
    label: "Closer",
    metric: "closingsBooked",
    thresholds: [3, 10, 30, 100, 250],
  },
  {
    id: "deal-maker",
    label: "Deal Maker",
    metric: "dealsWon",
    thresholds: [1, 5, 15, 50, 150],
  },
] as const;
export const tiers = ["Bronze", "Silber", "Gold", "Platin", "Diamant"];
export function progress(values: Counts) {
  return tracks.map((t) => {
    const value = values[t.metric];
    const level =
      value === null ? 0 : t.thresholds.filter((n) => value >= n).length;
    const next = t.thresholds[level] ?? null;
    const previous = t.thresholds[level - 1] ?? 0;
    return {
      ...t,
      value,
      tier: value === null ? null : (tiers[level - 1] ?? null),
      next,
      percent:
        value === null
          ? 0
          : next === null
            ? 100
            : Math.max(
                0,
                Math.min(100, ((value - previous) / (next - previous)) * 100),
              ),
    };
  });
}
/**
 * Art eines Datensatzes. Der frei bearbeitbare Rollentext („Team · …") war
 * als Merkmal nicht haltbar, deshalb steht die Art in einer eigenen Spalte.
 *
 * person — genau eine Person mit ihren eigenen belegten Zahlen.
 * joint  — eine gemeinsam gemeldete Leistung mehrerer Personen.
 */
export const participantKinds = ["person", "joint"] as const;
export type ParticipantKind = (typeof participantKinds)[number];
/** Unbekannte oder fehlende Werte gelten als Person, nie als gemeinsam. */
export function participantKind(value: unknown): ParticipantKind {
  return value === "joint" ? "joint" : "person";
}
export type RankingRow = {
  id: string;
  /**
   * Stabiler Importschlüssel. Öffentlich unbedenklich — er ist ein Kürzel des
   * ohnehin angezeigten Namens — und die einzige verlässliche Möglichkeit,
   * einem Profil eine dokumentierte Herkunft zuzuordnen, ohne dafür Namen
   * oder freien Rollentext abzugleichen.
   */
  key: string;
  name: string;
  company: string;
  role: string;
  kind: ParticipantKind;
  claimed: boolean;
  counts: Counts;
  source: string;
  updatedAt: string;
};
export const isJoint = (row: { kind?: unknown }) =>
  participantKind(row.kind) === "joint";
/** Nur Personen. Grundlage jeder persönlichen Platzierung. */
export const soloRows = <T extends { kind: ParticipantKind }>(rows: T[]) =>
  rows.filter((row) => !isJoint(row));
/**
 * Zeilen mit einer Meldung für genau diese Kennzahl.
 *
 * null heißt „nicht gemeldet" und gehört in keine Rangliste dieser Kennzahl —
 * eine Zeile voller Striche sagt nichts aus. Eine ausdrücklich gemeldete 0
 * ist etwas anderes: sie ist eine Aussage und bleibt drin.
 *
 * Die Kennzahlen sind voneinander unabhängig: wer keine Anwahlen, aber
 * Settings gemeldet hat, fehlt im Anwahlranking und steht im Setting-Ranking.
 */
export const reportedIn = <T extends { counts: Counts }>(
  rows: T[],
  metric: Metric,
) => rows.filter((row) => row.counts[metric] !== null);
/**
 * Persönliche Platzierung nach einer Kennzahl.
 *
 * Gemeinsame Meldungen treten hier nicht an. Eine von zwei Personen
 * zusammen erbrachte Leistung gegen die einer einzelnen Person zu stellen,
 * wäre unfair, und halbieren wäre erfunden. Sie zählen weiterhin genau
 * einmal zur Gesamtleistung der Crew — dafür ist aggregate() zuständig.
 *
 * Der Ausschluss sitzt bewusst hier und nicht in der Oberfläche: Podium,
 * Tabelle, Tagesgewinner und Monatsplätze gehen alle durch diese Funktion.
 */
export function ranked(rows: RankingRow[], metric: Metric) {
  let place = 0,
    last: number | null = null;
  return reportedIn(soloRows(rows), metric)
    .sort(
      (a, b) =>
        (b.counts[metric] ?? -1) - (a.counts[metric] ?? -1) ||
        a.name.localeCompare(b.name, "de") ||
        a.id.localeCompare(b.id),
    )
    .map((r, i) => {
      const v = r.counts[metric];
      if (v !== last) place = i + 1;
      last = v;
      return { ...r, rank: place };
    });
}
export function aggregate(values: Counts[]): Counts {
  return Object.fromEntries(
    metrics.map((k) => {
      const known = values
        .map((v) => v[k])
        .filter((v): v is number => v !== null);
      return [k, known.length ? known.reduce((a, b) => a + b, 0) : null];
    }),
  ) as Counts;
}
export const importRowSchema = z
  .object({
    participantKey: z
      .string()
      .trim()
      .regex(
        /^[a-zA-Z0-9_-]{2,80}$/,
        "Teilnehmer-ID: 2–80 Zeichen, nur Buchstaben, Zahlen, - und _.",
      ),
    name: z.string().trim().min(2).max(60),
    company: z.string().trim().max(120).default(""),
    role: z.string().trim().max(80).default(""),
    email: z.union([z.literal(""), z.string().email()]).default(""),
    date: daySchema,
    counts: countsSchema,
    publicConsent: z.boolean().default(false),
    kind: z.enum(participantKinds).default("person"),
  })
  .strict();
export type ImportRow = z.infer<typeof importRowSchema>;
// CSV supports quoted fields, semicolons, newlines and escaped quotes.
export function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  const delimiter = text.split("\n")[0].includes(";") ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === delimiter || c === "\n")) {
      row.push(field.trim());
      field = "";
      if (c === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (c !== "\r") field += c;
  }
  if (quoted)
    throw Error("Ein Anführungszeichen im CSV ist nicht geschlossen.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function parseImport(text: string): ImportRow[] {
  let input: unknown;
  if (text.trim().startsWith("[")) input = JSON.parse(text);
  else {
    const [header, ...rows] = parseCSV(text.replace(/^\uFEFF/, ""));
    if (!header) throw Error("Füge zuerst die Tageszahlen ein.");
    const required = ["participantKey", "name", "date"];
    if (required.some((k) => !header.includes(k)))
      throw Error("Die Spalten participantKey, name und date fehlen.");
    if (new Set(header).size !== header.length)
      throw Error("Spaltenüberschriften müssen eindeutig sein.");
    const allowed = new Set([
      ...required,
      "company",
      "role",
      "email",
      "publicConsent",
      "kind",
      ...metrics,
    ]);
    if (header.some((h) => !allowed.has(h)))
      throw Error("Unbekannte Spalte. Bitte die Vorlage verwenden.");
    input = rows.map((values, i) => {
      if (values.length !== header.length)
        throw Error(`Zeile ${i + 2}: Anzahl der Spalten stimmt nicht.`);
      const o = Object.fromEntries(header.map((h, j) => [h, values[j]]));
      if (o.publicConsent && !["true", "false"].includes(o.publicConsent))
        throw Error(`Zeile ${i + 2}: publicConsent muss true oder false sein.`);
      if (o.kind && !participantKinds.includes(o.kind as ParticipantKind))
        throw Error(
          `Zeile ${i + 2}: kind muss person oder joint sein. joint ist eine gemeinsam gemeldete Leistung mehrerer Personen.`,
        );
      return {
        participantKey: o.participantKey,
        name: o.name,
        date: o.date,
        company: o.company || "",
        role: o.role || "",
        email: o.email || "",
        publicConsent: o.publicConsent === "true",
        kind: o.kind || "person",
        counts: Object.fromEntries(
          metrics.map((k) => [
            k,
            o[k] === undefined || o[k] === "" ? null : Number(o[k]),
          ]),
        ),
      };
    });
  }
  const parsed = z.array(importRowSchema).min(1).max(500).parse(input);
  const seen = new Set<string>();
  for (const r of parsed) {
    const key = `${r.participantKey}:${r.date}`;
    if (seen.has(key))
      throw Error(
        `Doppelte Tagesmeldung für ${r.name}. Pro Teilnehmer und Tag bitte den vollständigen letzten Stand verwenden.`,
      );
    seen.add(key);
  }
  return parsed;
}
export function sampleRows(date = berlinDate()): RankingRow[] {
  return [
    {
      name: "Lena · Beispiel",
      company: "Studio Nord",
      role: "Agenturvertrieb",
      n: 146,
      c: 31,
      s: 7,
      cb: 3,
      d: 1,
    },
    {
      name: "Malik · Beispiel",
      company: "Kern & Partner",
      role: "B2B Sales",
      n: 128,
      c: 28,
      s: 8,
      cb: 2,
      d: 0,
    },
    {
      name: "Sophie · Beispiel",
      company: "Freiraum",
      role: "Account Executive",
      n: 112,
      c: 25,
      s: 5,
      cb: 4,
      d: 2,
    },
    {
      name: "Alex · Beispiel",
      company: "Selbstständig",
      role: "Sales Operator",
      n: 100,
      c: 20,
      s: 5,
      cb: 3,
      d: 1,
    },
    {
      name: "Jonas · Beispiel",
      company: "Momentum",
      role: "Outbound Sales",
      n: 84,
      c: 19,
      s: 4,
      cb: 2,
      d: 0,
    },
  ].map((r, i) => ({
    id: `sample-${i}`,
    key: `sample-${i}`,
    name: r.name,
    company: r.company,
    role: r.role,
    kind: "person" as ParticipantKind,
    claimed: i < 3,
    source: "Fiktive Beispieldaten",
    updatedAt: date,
    counts: {
      ...emptyCounts(),
      attempts: r.n,
      decisionMakerConversations: r.c,
      settingsBooked: r.s,
      settingsHeld: null,
      closingsBooked: r.cb,
      closingsHeld: null,
      dealsWon: r.d,
    },
  }));
}
