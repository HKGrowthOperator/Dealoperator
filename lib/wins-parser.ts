import type { Counts, Metric } from "./kpis";

/**
 * Eingefügte Tagesmeldungen („Wins“) in prüfbare Tagesstände übersetzen.
 *
 * Grundsätze:
 * - Eine Meldung ist ein STAND, kein Zuwachs. Je Person und Leistungstag
 *   gewinnt die späteste Meldung; frühere Zwischenstände werden als ersetzt
 *   gezeigt und nie addiert.
 * - „Termine“ ohne Typangabe bleiben Termine ohne Typangabe. Daraus wird nie
 *   ein Setting oder Closing.
 * - Was sich nicht eindeutig lesen lässt — unbekannte oder mehrdeutige
 *   Person, gemeinsame Meldung, Zuwachs-Formulierung („noch ein Setting“),
 *   widersprüchliche Zahlen — wird zum Prüffall und nicht übernommen.
 * - Der Rohtext wird nicht gespeichert. Für Prüffälle bleibt nur ein kurzer
 *   Auszug der betroffenen Zeile.
 */

export type DirectoryEntry = {
  id: string;
  name: string;
  kind: "person" | "joint";
  aliases?: string[];
};

export type WinsMessage = {
  author: string;
  /** Tag der Nachricht (YYYY-MM-DD), aus dem Zeitstempel oder vorgegeben. */
  messageDay: string;
  /** Uhrzeit HH:MM, falls bekannt. */
  time: string | null;
  text: string;
  line: number;
};

export type WinsEntry = {
  author: string;
  participantId: string | null;
  participantName: string | null;
  /** Leistungstag, auf den sich die Meldung bezieht. */
  day: string;
  /** Tag, an dem die Nachricht geschrieben wurde. */
  messageDay: string;
  time: string | null;
  metrics: Partial<Counts>;
  status: "ok" | "review" | "superseded";
  reasons: string[];
  notes: string[];
  excerpt: string;
  line: number;
};

// ---------------------------------------------------------------------------
// Zeilenformate

const pad = (n: string) => n.padStart(2, "0");
function fullYear(y: string, fallbackYear: number) {
  if (!y) return fallbackYear;
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}
function to24(h: string, m: string, ampm?: string) {
  let hour = Number(h);
  if (ampm) {
    const pm = ampm.toUpperCase() === "PM";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  return `${pad(String(hour))}:${m}`;
}

// 22.09.26, 18:56 - Name: Text   (WhatsApp Android)
const WA_ANDROID =
  /^(\d{1,2})\.(\d{1,2})\.(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*[-–]\s*([^:]{1,60}):\s*(.*)$/;
// [22.09.26, 18:56:12] Name: Text   (WhatsApp iOS)
const WA_IOS =
  /^\[(\d{1,2})\.(\d{1,2})\.(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\]\s*([^:]{1,60}):\s*(.*)$/;
// Name  18:56   oder   Name  6:56 PM   (kopierte Slack-Kopfzeile)
const SLACK_HEAD = /^([^\d:][^:]{0,58}?)\s{1,}(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*$/;
// Name: Text   (ohne Zeitstempel)
const PLAIN = /^([A-Za-zÀ-ÿ][^:\d]{0,58}):\s+(.+)$/;
// Zoom: „18:56:12 Von Max Muster an Alle:“ bzw. „From … to Everyone:“, Text
// in derselben oder den folgenden Zeilen.
const ZOOM_TO =
  /^(\d{1,2}):(\d{2})(?::\d{2})?\s+(?:Von|From)\s+(.{1,60}?)\s+(?:an|to)\s+(?:Alle|Everyone)(?:\s*\([^)]*\))?\s*:\s*(.*)$/i;
// Zoom, gespeicherter Chat: „18:56:12\t From Max Muster : Text“ oder
// „18:56:12\tMax Muster:\tText“.
const ZOOM_TAB =
  /^(\d{1,2}):(\d{2}):\d{2}\t\s*(?:(?:Von|From)\s+)?([^\t:]{1,60}?)\s*:\s*\t?(.*)$/i;
// Tagestrenner (Slack, Zoom, Kopien): „Dienstag, 22. September“, „22.09.2026“,
// „Tuesday, September 22nd“, „Heute“/„Gestern“.
const MONTHS_DE = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAY_WORD = String.raw`(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)`;
const SEP_DE = new RegExp(
  String.raw`^(?:${WEEKDAY_WORD},?\s*)?(\d{1,2})\.\s*(${MONTHS_DE.join("|")}|maerz)(?:\s+(\d{4}))?$`,
  "i",
);
const SEP_EN = new RegExp(
  String.raw`^(?:${WEEKDAY_WORD},?\s*)?(${MONTHS_EN.join("|")})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$`,
  "i",
);
const SEP_NUMERIC = /^(?:[-–—\s]*)(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[-–—\s]*)$/;
const SEP_RELATIVE = /^(heute|today|gestern|yesterday)$/i;
// Beginnt mit einer Uhrzeit, passt aber zu keinem Format: nie als Folgezeile
// an die vorige Nachricht hängen.
const STARTS_WITH_TIME = /^\[?\d{1,2}[:.]\d{2}/;

function shift(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Tagestrenner erkennen. Liefert den Tag oder null. */
export function daySeparator(line: string, year: number, today: string): string | null {
  const text = line.replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
  let m = SEP_DE.exec(text);
  if (m) {
    const month = MONTHS_DE.indexOf(m[2].toLowerCase().replace("maerz", "märz")) + 1;
    return `${m[3] || year}-${pad(String(month))}-${pad(m[1])}`;
  }
  m = SEP_EN.exec(text);
  if (m) {
    const month = MONTHS_EN.indexOf(m[1].toLowerCase()) + 1;
    return `${m[3] || year}-${pad(String(month))}-${pad(m[2])}`;
  }
  m = SEP_NUMERIC.exec(text);
  if (m) return `${fullYear(m[3], year)}-${pad(m[2])}-${pad(m[1])}`;
  m = SEP_RELATIVE.exec(text);
  if (m) return /heute|today/i.test(m[1]) ? today : shift(today, -1);
  return null;
}

/** Zerlegt den eingefügten Text in einzelne Nachrichten. */
export function splitMessages(
  text: string,
  defaultDay: string,
  today = defaultDay,
): WinsMessage[] {
  const year = Number(defaultDay.slice(0, 4));
  const messages: WinsMessage[] = [];
  // Tag für Formate ohne eigenes Datum; Tagestrenner setzen ihn neu.
  let currentDay = defaultDay;
  const lines = text.replace(/\r/g, "").split("\n");
  lines.forEach((raw, index) => {
    const line = raw.replace(/‎|‏/g, "").trim();
    if (!line) return;
    let m = WA_ANDROID.exec(line) || WA_IOS.exec(line);
    if (m) {
      messages.push({
        author: m[6].trim(),
        messageDay: `${fullYear(m[3], year)}-${pad(m[2])}-${pad(m[1])}`,
        time: `${pad(m[4])}:${m[5]}`,
        text: m[7].trim(),
        line: index + 1,
      });
      return;
    }
    const separator = daySeparator(line, year, today);
    if (separator) {
      currentDay = separator;
      return;
    }
    m = ZOOM_TO.exec(line) || ZOOM_TAB.exec(line);
    if (m) {
      messages.push({
        author: m[3].trim(),
        messageDay: currentDay,
        time: `${pad(m[1])}:${m[2]}`,
        text: m[4].trim(),
        line: index + 1,
      });
      return;
    }
    m = SLACK_HEAD.exec(line);
    if (m) {
      messages.push({
        author: m[1].trim(),
        messageDay: currentDay,
        time: to24(m[2], m[3], m[4]),
        text: "",
        line: index + 1,
      });
      return;
    }
    m = PLAIN.exec(line);
    // „Anwahlen: 120“ unter einer Nachricht ist eine Folgezeile, kein Absender.
    if (m && !/\d/.test(m[1]) && !(messages.length && NOT_A_NAME.test(m[1].trim()))) {
      messages.push({
        author: m[1].trim(),
        messageDay: currentDay,
        time: null,
        text: m[2].trim(),
        line: index + 1,
      });
      return;
    }
    // Folgezeile einer mehrzeiligen Nachricht. Ohne vorige Nachricht oder bei
    // einer unbekannten Zeile mit Uhrzeit: eigene Meldung ohne Absender, damit
    // Zahlen darin als Prüffall sichtbar werden statt zu verschwinden.
    const last = messages.at(-1);
    if (last && !STARTS_WITH_TIME.test(line))
      last.text = last.text ? `${last.text}\n${line}` : line;
    else if (/\d/.test(line))
      messages.push({ author: "", messageDay: currentDay, time: null, text: line, line: index + 1 });
  });
  return messages.filter((m) => m.text.trim());
}

// ---------------------------------------------------------------------------
// Kennzahlen

const WORDS: Record<string, number> = {
  null: 0,
  kein: 0,
  keine: 0,
  keinen: 0,
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  zwoelf: 12,
};
const NUMBER = String.raw`(\d{1,5}|${Object.keys(WORDS).join("|")})`;

type Pattern = { metric: Metric; words: string };
// Reihenfolge zählt: spezifische Formen vor allgemeinen, damit „Settings
// gehalten“ nicht zusätzlich als „Settings“ gezählt wird.
const PATTERNS: Pattern[] = [
  {
    metric: "settingsHeld",
    words: String.raw`settings?\s+(?:gehalten|durchgef(?:ü|ue)hrt|stattgefunden)`,
  },
  {
    metric: "closingsHeld",
    words: String.raw`closings?\s+(?:gehalten|durchgef(?:ü|ue)hrt|stattgefunden)`,
  },
  {
    metric: "dealsWon",
    words: String.raw`(?:deals?(?:\s+(?:gewonnen|abgeschlossen|closed))?|abschl(?:ü|ue)ss?e?\s+gewonnen|kunden?\s+gewonnen)`,
  },
  {
    metric: "closingsBooked",
    words: String.raw`(?:closing-?termine?|closings?)(?:\s+(?:vereinbart|gelegt|gebucht|terminiert))?`,
  },
  {
    metric: "settingsBooked",
    words: String.raw`(?:settings?|setter|setting-?termine?)(?:\s+(?:vereinbart|gelegt|gebucht|terminiert))?`,
  },
  {
    metric: "attempts",
    words: String.raw`(?:anwahl(?:en|versuche)?|w(?:ä|ae)hlversuche|anrufe|calls|dials|telefonate)`,
  },
  // Termine ohne Typangabe — bewusst zuletzt, damit „Setting-Termine“ und
  // „Closing-Termine“ vorher erkannt sind.
  { metric: "legacyMeetings", words: String.raw`(?:termine?|meetings?)(?:\s+(?:vereinbart|gelegt|gebucht))?` },
];

// Halbe, Dezimal- oder unsichere Angaben: nie als feste Zahl übernehmen.
const UNCERTAIN =
  /\d\s*[.,]\s*\d|½|\b\d\s*\/\s*\d\b|\bhalbe[nrs]?\b|\b(?:vielleicht|evtl\.?|eventuell|ca\.|circa|ungef(?:ä|ae)hr|wahrscheinlich|vermutlich|unsicher|etwa|so um die)\b|\d\s*\?/i;

const INCREMENT =
  /\b(?:noch|nochmal|weitere[rnms]?|zus(?:ä|ae)tzlich)\s+(?:ein|eine|einen|\d+)\b|\b\d+\.\s*(?:termin|setting|closing|deal)|\+\s*\d+\s*(?:termin|setting|closing|anwahl|call|deal)/i;

const SEGMENT = /\n|(?<!\d),|,(?!\d)|[;|·]|\s+(?:und|sowie|plus)\s+/i;
const ANY_METRIC = new RegExp(String.raw`(?:^|[\s,;(])(?:${PATTERNS.map((p) => p.words).join("|")})\b`, "iu");
const ANY_NUMBER = new RegExp(String.raw`(?:^|[\s,;(])${NUMBER}\b`, "iu");
/** Wörter, die am Zeilenanfang vor einem Doppelpunkt stehen, aber kein Name sind. */
export const NOT_A_NAME = new RegExp(
  String.raw`^(?:${PATTERNS.map((p) => p.words).join("|")}|heute|gestern|stand|update|zwischenstand|ergebnis|ergebnisse|zahlen|tagesabschluss|fazit|learning|learnings|wins?|energie|morgen|note|notiz)$`,
  "iu",
);

function toNumber(token: string) {
  const lower = token.toLowerCase();
  return /^\d+$/.test(lower) ? Number(lower) : WORDS[lower];
}

/** Liest Kennzahlen aus einem Meldungstext. */
export function readMetrics(text: string): {
  metrics: Partial<Counts>;
  conflicts: Metric[];
  increment: boolean;
  uncertain: boolean;
} {
  // Tausenderpunkte („1.200 Anwahlen“) sind ganze Zahlen, keine Dezimalwerte.
  text = text.replace(/(?<![\d.,])(\d{1,3})((?:\.\d{3})+)(?![\d.,]?\d)/g, (_, head: string, groups: string) =>
    head + groups.replace(/\./g, ""),
  );
  const found = new Map<Metric, number[]>();
  // Jede Zeile bzw. jeder Abschnitt für sich: „Anwahlen 120“ in einer Zeile
  // und „Settings 2“ in der nächsten dürfen sich nicht vermischen. Kommas
  // zwischen Ziffern („1,5“) trennen nicht.
  for (const segment of text.split(SEGMENT)) {
    let rest = ` ${segment.toLowerCase().replace(/\s+/g, " ")} `;
    if (!rest.trim()) continue;
    // Richtung aus dem Abschnittsanfang: beginnt er mit einer Kennzahl
    // („Anwahlen 120“), steht die Zahl danach; beginnt er mit einer Zahl
    // („120 Anwahlen“), steht sie davor. Sonst sind beide Formen erlaubt.
    const firstMetric = rest.search(ANY_METRIC);
    const firstNumber = rest.search(ANY_NUMBER);
    const orientation =
      firstMetric < 0 || firstNumber < 0
        ? "both"
        : firstMetric < firstNumber
          ? "after"
          : "before";
    for (const { metric, words } of PATTERNS) {
      // Keine Zahl direkt nach „Ziffer + Komma/Punkt“ lesen: aus „1,5 Settings“
      // darf nie „5 Settings“ werden.
      const before = new RegExp(String.raw`(^|[\s,;(])(?<!\d[.,])${NUMBER}\s*(?:x\s*)?${words}\b`, "giu");
      const after = new RegExp(String.raw`(^|[\s,;(])${words}\s*[:=\-–]?\s*${NUMBER}\b`, "giu");
      const forms = orientation === "before" ? [before] : orientation === "after" ? [after] : [before, after];
      for (const re of forms) {
        // In beiden Mustern ist die Zahl die zweite Gruppe; die Wortgruppen
        // sind bewusst nicht erfassend.
        rest = rest.replace(re, (whole, lead: string, token: string) => {
          const value = toNumber(token);
          if (value === undefined) return whole;
          found.set(metric, [...(found.get(metric) || []), value]);
          // Erkannte Stelle entfernen, damit allgemeinere Muster sie nicht
          // ein zweites Mal zählen.
          return `${lead} `;
        });
      }
    }
  }
  const metrics: Partial<Counts> = {};
  const conflicts: Metric[] = [];
  for (const [metric, values] of found) {
    if (new Set(values).size > 1) conflicts.push(metric);
    metrics[metric] = values.at(-1)!;
  }
  return {
    metrics,
    conflicts,
    increment: INCREMENT.test(text),
    uncertain: UNCERTAIN.test(text),
  };
}

// ---------------------------------------------------------------------------
// Personen

export function normaliseName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name oder Alias stimmt vollständig überein (nicht nur der Vorname). */
export function exactAuthor(author: string, entry: DirectoryEntry) {
  const wanted = normaliseName(author);
  return (
    normaliseName(entry.name) === wanted ||
    (entry.aliases || []).some((a) => normaliseName(a) === wanted)
  );
}

export function resolveAuthor(author: string, directory: DirectoryEntry[]) {
  const wanted = normaliseName(author);
  const exact = directory.filter(
    (d) =>
      normaliseName(d.name) === wanted ||
      (d.aliases || []).some((a) => normaliseName(a) === wanted),
  );
  if (exact.length) return exact;
  // Nur Vorname gemeldet: eindeutig, wenn genau ein Profil so beginnt.
  if (!wanted.includes(" "))
    return directory.filter(
      (d) => normaliseName(d.name).split(" ")[0] === wanted,
    );
  return [];
}

// ---------------------------------------------------------------------------
// Gesamtauswertung

const WEEKDAYS_DE = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];
const WEEKDAY_SHORT: Record<string, number> = { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 7 };

/**
 * Ausdrücklicher Leistungstag im Text: „gestern“, „heute“, am Anfang
 * „Freitag:“/„Fr:“ oder „22.09.:“. Ein Wochentag mitten im Satz („Setting für
 * Freitag“) meint oft einen künftigen Termin und wird deshalb nicht gelesen.
 */
export function explicitDay(text: string, messageDay: string): { day: string; from: string } | null {
  const lower = text.toLowerCase();
  const head = lower.trim().slice(0, 24);
  const date = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s*[:\-–]/.exec(head);
  if (date) {
    const year = date[3] ? fullYear(date[3], Number(messageDay.slice(0, 4))) : Number(messageDay.slice(0, 4));
    const day = `${year}-${pad(date[2])}-${pad(date[1])}`;
    if (day <= messageDay) return { day, from: `${date[1]}.${date[2]}.` };
  }
  const weekday = new RegExp(String.raw`^(${WEEKDAYS_DE.join("|")}|mo|di|mi|do|fr|sa|so)\.?\s*[:\-–]`).exec(head);
  if (weekday) {
    const target =
      WEEKDAYS_DE.indexOf(weekday[1]) + 1 || WEEKDAY_SHORT[weekday[1]];
    const current = (() => {
      const w = new Date(`${messageDay}T12:00:00Z`).getUTCDay();
      return w === 0 ? 7 : w;
    })();
    const back = (current - target + 7) % 7;
    return { day: shift(messageDay, -back), from: weekday[1] };
  }
  if (/\bgestern\b/.test(lower)) return { day: shift(messageDay, -1), from: "gestern" };
  if (/\bheute\b/.test(lower)) return { day: messageDay, from: "heute" };
  return null;
}

const CUMULATIVE: Metric[] = ["attempts", "settingsBooked", "closingsBooked", "settingsHeld", "closingsHeld", "dealsWon"];

export function parseWins({
  text,
  defaultDay,
  directory,
  lateNightCutoff = "06:00",
  morningUntil = "10:00",
  today = defaultDay,
}: {
  text: string;
  defaultDay: string;
  directory: DirectoryEntry[];
  /** Meldungen vor dieser Uhrzeit gehören zum Vortag. */
  lateNightCutoff?: string;
  /** Bis zu dieser Uhrzeit wird bei Morgenmeldungen auf den Vortag hingewiesen. */
  morningUntil?: string;
  /** Heutiges Datum, für „Heute“/„Gestern“ als Tagestrenner. */
  today?: string;
}): WinsEntry[] {
  const entries: WinsEntry[] = splitMessages(text, defaultDay, today).map((m) => {
    const reasons: string[] = [];
    const notes: string[] = [];
    let day = m.messageDay;
    const explicit = explicitDay(m.text, m.messageDay);
    if (explicit) {
      day = explicit.day;
      if (day !== m.messageDay)
        notes.push(`Leistungstag aus „${explicit.from}“ abgeleitet.`);
    } else if (m.time && m.time < lateNightCutoff) {
      day = shift(day, -1);
      notes.push(`Nach Mitternacht gemeldet (${m.time}) — dem Vortag zugeordnet.`);
    } else if (m.time && m.time < morningUntil)
      notes.push(
        `Morgens gemeldet (${m.time}). Falls der Vortag gemeint ist, bitte „gestern“ in der Meldung ergänzen.`,
      );
    const { metrics, conflicts, increment, uncertain } = readMetrics(m.text);
    const matches = m.author ? resolveAuthor(m.author, directory) : [];
    if (!Object.keys(metrics).length)
      reasons.push("Keine Kennzahl erkannt.");
    if (conflicts.length)
      reasons.push(
        `Widersprüchliche Werte in einer Nachricht: ${conflicts.join(", ")}.`,
      );
    if (increment)
      reasons.push(
        "Klingt nach Zuwachs („noch ein …“, „2. Termin“) statt nach Tagesstand. Bitte den vollständigen Stand prüfen.",
      );
    if (uncertain)
      reasons.push(
        "Halbe, Dezimal- oder unsichere Angabe („1,5“, „½“, „ca.“, „vielleicht“). Bitte den festen Stand prüfen.",
      );
    if (!m.author) reasons.push("Zeile ohne erkennbaren Absender.");
    else if (!matches.length)
      reasons.push(`Person „${m.author}“ ist keinem Profil zugeordnet.`);
    else if (matches.length > 1)
      reasons.push(
        `„${m.author}“ passt zu mehreren Profilen: ${matches.map((x) => x.name).join(", ")}.`,
      );
    else if (matches[0].kind === "joint")
      reasons.push(
        `„${matches[0].name}“ ist eine gemeinsame Meldung und kein Einzelprofil.`,
      );
    else if (!exactAuthor(m.author, matches[0]))
      // Nur der Vorname passt: ein Vorschlag, keine Zuordnung. Erst wenn das
      // Team ihn als Alias bestätigt, zählt die Meldung.
      reasons.push(
        `Nur Vorname „${m.author}“ erkannt. Vorschlag: ${matches[0].name}. Bitte als Alias bestätigen.`,
      );
    const match = matches.length === 1 ? matches[0] : null;
    return {
      author: m.author || "(ohne Absender)",
      participantId: match?.id ?? null,
      participantName: match?.name ?? null,
      day,
      messageDay: m.messageDay,
      time: m.time,
      metrics,
      status: reasons.length ? "review" : "ok",
      reasons,
      notes,
      excerpt: m.text.split("\n")[0].slice(0, 160),
      line: m.line,
    } satisfies WinsEntry;
  });

  // Je Person und Leistungstag gilt für JEDE Kennzahl der zuletzt gemeldete
  // Wert — gemessen am vollen Zeitpunkt der Nachricht, nicht nur an der
  // Uhrzeit. Frühere Zwischenstände werden nie addiert.
  const groups = new Map<string, WinsEntry[]>();
  for (const e of entries) {
    if (e.status !== "ok" || !e.participantId) continue;
    const key = `${e.participantId}:${e.day}`;
    groups.set(key, [...(groups.get(key) || []), e]);
  }
  const order = (e: WinsEntry) => `${e.messageDay}|${e.time ?? "     "}|${String(e.line).padStart(6, "0")}`;
  for (const group of groups.values()) {
    group.sort((a, b) => order(a).localeCompare(order(b)));
    const latest = group.at(-1)!;
    if (group.length === 1) continue;
    const merged: Partial<Counts> = {};
    const takenFrom: string[] = [];
    const lowered: string[] = [];
    for (const e of group)
      for (const [metric, value] of Object.entries(e.metrics) as [Metric, number][]) {
        const previous = merged[metric];
        if (
          typeof previous === "number" &&
          CUMULATIVE.includes(metric) &&
          value < previous
        )
          lowered.push(`${metric}: ${previous} → ${value}`);
        merged[metric] = value;
      }
    for (const metric of Object.keys(merged) as Metric[])
      if (!(metric in latest.metrics)) {
        const source = [...group].reverse().find((e) => metric in e.metrics)!;
        takenFrom.push(`${metric} aus der Meldung ${source.time ? `um ${source.time}` : `in Zeile ${source.line}`}`);
      }
    latest.metrics = merged;
    if (takenFrom.length)
      latest.notes.push(`Zusammengeführt: ${takenFrom.join(", ")}.`);
    if (lowered.length) {
      latest.status = "review";
      latest.reasons.push(
        `Spätere Meldung mit niedrigerem Wert (${lowered.join("; ")}). Korrektur oder Tippfehler? Bitte prüfen.`,
      );
    }
    for (const e of group.slice(0, -1)) {
      e.status = "superseded";
      e.notes.push(
        "Durch eine spätere Meldung derselben Person für diesen Tag ersetzt — nicht addiert.",
      );
    }
  }
  return entries;
}
