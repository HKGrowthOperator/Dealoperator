import { metricLabels, type Counts, type Metric } from "./kpis";

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
 *   widersprüchliche Zahlen, unklarer Tag — wird zum Prüffall und nicht
 *   übernommen.
 * - Der Rohtext wird nicht gespeichert. Für Prüffälle bleibt nur ein kurzer
 *   Auszug der betroffenen Zeile.
 *
 * Leistungstag — für welchen Tag eine Meldung zählt:
 * 1. Ausdrücklich datiert („22.9.: …“, „Nachtrag vom 22.09.: …“, am Anfang
 *    „Fr: …“) → dieser Tag. Nie mehrdeutig.
 * 2. Nach Mitternacht bis zur Tagesgrenze (LATE_NIGHT_CUTOFF, 06:00) →
 *    automatisch der Vortag. „heute“/„gestern“ ändern daran nichts: gemeint
 *    ist der gerade beendete Calling-Tag.
 * 3. „gestern“ zählt als Tagesangabe nur am Anfang („Gestern: …“, „Gestern
 *    40 Calls“, „Nachtrag von gestern …“) oder in festen Wendungen („für
 *    gestern“, „Zahlen von gestern“, „gestern:“). Im Fließtext („gestern hatte
 *    ich keine Zeit, heute 40 Calls“) verschiebt es nichts. „heute“ bei Zahlen
 *    bestätigt den Tag der Nachricht.
 * 4. Nennt eine Nachricht mit Zahlen mehrere Tage (Vortag und „heute“), wird
 *    sie ein Prüffall — es wird nicht geraten.
 * 5. Vormittags (Tagesgrenze bis MORNING_UNTIL, 12:00) ohne Tagesangabe, ein
 *    „Nachtrag“ ohne Tag oder „gestern“ im Fließtext direkt bei Zahlen →
 *    Prüffall „Vortag oder heute?“ mit dem Vortag als Vorschlag. Solche
 *    Meldungen werden nie still in den heutigen Stand gemischt.
 * 6. Sonst: der Tag der Nachricht.
 */

export const LATE_NIGHT_CUTOFF = "06:00";
export const MORNING_UNTIL = "12:00";

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
  /** WhatsApp: Nachricht wurde nachträglich bearbeitet. */
  edited?: boolean;
};

/** Ein gemeldeter Wert für eine Kennzahl samt Zeitpunkt der Nachricht. */
export type Observation = {
  metric: Metric;
  value: number;
  /** „YYYY-MM-DD HH:MM“ der Nachricht; null ohne Uhrzeit (z. B. Liste „Name: …“). */
  stamp: string | null;
  line: number;
  /**
   * Ausdrückliche Korrektur („Korrektur: …“, bearbeitete Nachricht) oder vom
   * Team bestätigt: ein niedrigerer Wert gilt dann ohne Prüffall.
   */
  correction: boolean;
};

/** Spätere Meldung mit niedrigerem Wert (oder dieselbe Nachricht mit anderem Wert). */
export type FieldConflict = {
  metric: Metric;
  from: number;
  to: number;
  stamp: string | null;
  line: number;
  kind: "lower" | "same-time";
};

export type ReviewKind = "person" | "day" | "value" | "unclear";

export type WinsEntry = {
  author: string;
  participantId: string | null;
  participantName: string | null;
  /** Leistungstag, auf den sich die Meldung bezieht (bei Prüffällen der Vorschlag). */
  day: string;
  /** Tag, an dem die Nachricht geschrieben wurde. */
  messageDay: string;
  time: string | null;
  /** Zeitpunkt der Nachricht „YYYY-MM-DD HH:MM“, null ohne Uhrzeit. */
  stamp: string | null;
  metrics: Partial<Counts>;
  /**
   * Alle Einzelwerte, aus denen der Stand entsteht. Bei der gültigen Meldung
   * einer Person für einen Tag die Werte aller ihrer Meldungen für diesen Tag.
   */
  observations: Observation[];
  status: "ok" | "review" | "superseded";
  /** Art des Prüffalls; null, wenn kein Prüffall. */
  review: ReviewKind | null;
  /** Wählbare Leistungstage bei „Vortag oder heute?“; der erste ist der Vorschlag. */
  days: string[];
  /** Die Werte lassen sich nach Prüfung so übernehmen (kein Zuwachs, keine Tagesmischung). */
  applicable: boolean;
  /** Ausdrückliche Korrektur oder bearbeitete Nachricht. */
  correction: boolean;
  /** Spätere Meldungen mit niedrigerem Wert, je Kennzahl. */
  conflicts: FieldConflict[];
  reasons: string[];
  notes: string[];
  excerpt: string;
  /** Vollständiger Nachrichtentext — nur im Speicher, wird nie gespeichert. */
  text: string;
  line: number;
};

// ---------------------------------------------------------------------------
// Zeilenformate

const pad = (n: string) => n.padStart(2, "0");
function fullYear(y: string | undefined, fallbackYear: number) {
  if (!y) return fallbackYear;
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}
function to24(h: string, m: string, ampm?: string) {
  let hour = Number(h);
  if (ampm) {
    const pm = ampm.replace(/\./g, "").toUpperCase() === "PM";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  return `${pad(String(hour))}:${m}`;
}

const TIME = String.raw`(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([AaPp]\.?[Mm]\.?))?`;
const DATE = String.raw`(\d{1,2})\.(\d{1,2})\.(\d{2,4})`;
// [19:05, 23.9.2026] Name: Text   (WhatsApp Web/Desktop, kopierte Nachrichten)
const WA_WEB = new RegExp(String.raw`^\[${TIME},\s*${DATE}\]\s*([^:]{1,80}):\s*(.*)$`);
// 23.09.26, 19:05 - Name: Text   (WhatsApp Android, Export)
const WA_ANDROID = new RegExp(String.raw`^${DATE},?\s+${TIME}\s*[-–]\s*([^:]{1,80}):\s*(.*)$`);
// [23.09.26, 19:05:12] Name: Text   (WhatsApp iOS, Export)
const WA_IOS = new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s*([^:]{1,80}):\s*(.*)$`);
// WhatsApp-Zeitstempel ohne „Name:“: Systemzeile („… hat die Gruppe verlassen“).
const WA_SYSTEM = new RegExp(
  String.raw`^(?:\[(?:${DATE},?\s+${TIME}|${TIME},\s*${DATE})\]|${DATE},?\s+${TIME}\s*[-–])`,
);
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
// Richtungs- und Formatzeichen (z. B. um Telefonnummern in WhatsApp) und
// geschützte Leerzeichen.
const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;
const WIDE_SPACE = /[    ]/g;
// „<Diese Nachricht wurde bearbeitet>“ bzw. „<This message was edited>“.
const EDITED = /<[^<>]{0,60}(?:bearbeitet|edited)[^<>]{0,10}>/gi;

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

/** Kopfzeile einer WhatsApp-Nachricht (Web/Desktop, Android, iOS) oder null. */
function whatsappHead(line: string, year: number) {
  let m = WA_WEB.exec(line);
  if (m)
    return {
      author: m[7],
      messageDay: `${fullYear(m[6], year)}-${pad(m[5])}-${pad(m[4])}`,
      time: to24(m[1], m[2], m[3]),
      text: m[8],
    };
  m = WA_ANDROID.exec(line) || WA_IOS.exec(line);
  if (m)
    return {
      author: m[7],
      messageDay: `${fullYear(m[3], year)}-${pad(m[2])}-${pad(m[1])}`,
      time: to24(m[4], m[5], m[6]),
      text: m[8],
    };
  return null;
}

/** WhatsApp zeigt Absender ohne Kontakt als „~ Name“. */
const cleanAuthor = (author: string) => author.replace(/^~\s*/, "").trim();

/**
 * Zerlegt den eingefügten Text in einzelne Nachrichten.
 *
 * strict: Enthält der Text WhatsApp-Kopfzeilen (Datum und Uhrzeit vor dem
 * Namen), beginnt jede Nachricht mit einer solchen Kopfzeile. Alle anderen
 * Zeilen gehören zur vorigen Nachricht — auch wenn sie wie „Name: Text“,
 * eine Uhrzeit oder ein Tagestrenner („Gestern“) aussehen. Systemzeilen
 * („… hat die Gruppe verlassen“) fallen weg. parseWins nutzt immer strict.
 */
export function splitMessages(
  text: string,
  defaultDay: string,
  today = defaultDay,
  { strict = false }: { strict?: boolean } = {},
): WinsMessage[] {
  const year = Number(defaultDay.slice(0, 4));
  const messages: WinsMessage[] = [];
  // Tag für Formate ohne eigenes Datum; Tagestrenner setzen ihn neu.
  let currentDay = defaultDay;
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((raw) => raw.replace(INVISIBLE, "").replace(WIDE_SPACE, " ").trim());
  const whatsapp = strict && lines.some((line) => whatsappHead(line, year));
  // Nach einer Systemzeile nichts an die vorige Nachricht hängen.
  let attach = true;
  lines.forEach((line, index) => {
    if (!line) return;
    const head = whatsappHead(line, year);
    if (head) {
      messages.push({
        author: cleanAuthor(head.author),
        messageDay: head.messageDay,
        time: head.time,
        text: head.text.trim(),
        line: index + 1,
      });
      attach = true;
      return;
    }
    const last = messages.at(-1);
    if (whatsapp) {
      if (WA_SYSTEM.test(line)) {
        attach = false;
        return;
      }
      if (attach && last) last.text = last.text ? `${last.text}\n${line}` : line;
      else if (/\d/.test(line)) {
        // Zeilen vor der ersten Kopfzeile (angeschnittene Nachricht): ohne
        // Absender, damit Zahlen darin als Prüffall sichtbar werden.
        messages.push({ author: "", messageDay: currentDay, time: null, text: line, line: index + 1 });
        attach = true;
      }
      return;
    }
    const separator = daySeparator(line, year, today);
    if (separator) {
      currentDay = separator;
      return;
    }
    let m = ZOOM_TO.exec(line) || ZOOM_TAB.exec(line);
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
    if (last && !STARTS_WITH_TIME.test(line))
      last.text = last.text ? `${last.text}\n${line}` : line;
    else if (/\d/.test(line))
      messages.push({ author: "", messageDay: currentDay, time: null, text: line, line: index + 1 });
  });
  for (const m of messages) {
    const cleaned = m.text.replace(EDITED, "").trim();
    if (cleaned !== m.text) {
      m.edited = true;
      m.text = cleaned;
    }
  }
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
  String.raw`^(?:${PATTERNS.map((p) => p.words).join("|")}|heute|gestern|stand|update|zwischenstand|ergebnis|ergebnisse|zahlen|tagesabschluss|fazit|learning|learnings|wins?|energie|morgen|note|notiz|nachtrag|nachträge|korrektur|zusammenfassung|ziel)$`,
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
  // Datumsangaben („22.9.“, „22.09.2026“) sind weder Kennzahl noch Dezimalwert;
  // der Leistungstag wird getrennt davon gelesen (dayMarks).
  text = text.replace(/(?<![\d.,])\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?(?![\d.,]?\d)/g, " ");
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
    .replace(/[\u0300-\u036f]/g, "")
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
// Leistungstag

const WEEKDAYS_DE = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];
const WEEKDAY_SHORT: Record<string, number> = { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 7 };

// Einleitende Wörter vor einer Tagesangabe am Anfang der Nachricht.
const LEAD = String.raw`(?:(?:kurzer?\s+)?nachtr(?:ag|äge|aege)|nachgereicht|nachreichung|zahlen|stand|update|ergebnis(?:se)?|bilanz|calls|wins?)`;
// Dieselben Wörter mitten im Text — ohne „Stand“, „Calls“, „Wins“, die dort
// auch anders gemeint sein können („ich stand gestern im Stau“).
const LEAD_ANYWHERE = String.raw`(?:nachtr(?:ag|äge|aege)|nachgereicht|nachreichung|zahlen|ergebnis(?:se)?|bilanz|update)`;
const PREP = String.raw`(?:(?:von|vom|für|fuer|am|den|zu)\s+){0,2}`;
const DATE_START = new RegExp(
  String.raw`^\s*(?:${LEAD}\s*[:\-–]?\s*)?${PREP}(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2})?|(?=\s*[:\-–]))(?=[\s:\-–,]|$)`,
  "iu",
);
const DATE_PHRASE = new RegExp(
  String.raw`\b${LEAD_ANYWHERE}\s*[:\-–]?\s*${PREP}(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?`,
  "giu",
);
const WEEKDAY_START = new RegExp(
  String.raw`^\s*(?:${LEAD}\s*[:\-–]?\s*)?${PREP}(${WEEKDAYS_DE.join("|")}|mo|di|mi|do|fr|sa|so)\.?\s*[:\-–]`,
  "iu",
);
// „Gestern: …“, „Gestern 40 Calls“, „Nachtrag (von) gestern …“ am Anfang.
// Die Gruppe 2 fängt ein direkt folgendes Trennzeichen oder das Ende.
const RELATIVE_START = new RegExp(
  String.raw`^\s*(?:${LEAD}\s*[:\-–]?\s*)?${PREP}(gestern|heute)\b(\s*(?:[:\-–,]|$)|[ \t]*\n)?`,
  "iu",
);
// Feste Wendungen irgendwo im Text: „Nachtrag (von) gestern“, „Zahlen von
// heute“, „für gestern“, „gestern:“.
const RELATIVE_PHRASE = new RegExp(
  String.raw`\b${LEAD_ANYWHERE}\s*[:\-–]?\s*${PREP}(gestern|heute)\b|\b(?:für|fuer)\s+(gestern)\b|\b(gestern|heute)\s*:`,
  "giu",
);
// Begrüßung am Anfang der Nachricht.
const GREETING = /^\s*(?:(?:guten\s+)?(?:morgen|abend)|moin(?:sen)?|hallo|hi|hey|servus|na(?:\s+ihr)?|n'?abend)\b[\s!,.:]*(?:(?:zusammen|leute|team|ihr\s+lieben)\b[\s!,.:]*)?/iu;
// „gestern“/„heute“ als Wort, nicht als Vergleich („mehr als gestern“).
const RELATIVE_WORD = /(?<!\b(?:als|wie|seit|bis|ab)\s+)\b(gestern|heute)\b/giu;
const NACHTRAG = /\bnach(?:trag|träge|traege|gereicht|reichung)\b/iu;
const CORRECTION =
  /\b(?:korrektur|korrigiert|korrigiere|korrigieren|verschrieben|vertippt|tippfehler)\b|\brichtig(?:e|er)?\s+(?:zahl|zahlen|stand|wert|werte)\b|\bsorry,?\s+(?:es\s+)?(?:waren|sind|war)\b/iu;
// Satzteile: Zeilen, Satzzeichen, Komma mit Leerzeichen, „ - “. Punkte in
// Datumsangaben („22.9.“) und Tausendern („1.200“) trennen nicht.
const CLAUSE = /\n|[!?;]|\.(?=\s|$)|,(?=\s)|\s[-–]\s/;

const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;

function resolveDate(d: string, m: string, y: string | undefined, messageDay: string) {
  const baseYear = Number(messageDay.slice(0, 4));
  const build = (year: number) => `${year}-${pad(m)}-${pad(d)}`;
  let day = build(fullYear(y, baseYear));
  // „31.12.“ in einer Nachricht vom 2. Januar meint das Vorjahr.
  if (!y && day > messageDay) day = build(baseYear - 1);
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  // Künftige Tage sind Termine, keine Leistungstage.
  if (day > messageDay || day < shift(messageDay, -62)) return null;
  return day;
}

export type DayMarks = {
  /** Eindeutige Tagesangaben: Datum, Wochentag am Anfang, „gestern“/„heute“ als Tagesangabe. */
  explicit: { day: string; from: string; kind: "date" | "weekday" | "relative" }[];
  /** „gestern“ im Fließtext direkt bei Zahlen: wahrscheinlich der Vortag, aber nicht sicher. */
  yesterdayNearNumbers: boolean;
  /** „gestern“ nur im Fließtext ohne Zahlen: keine Tagesangabe. */
  yesterdayInProse: boolean;
  nachtrag: boolean;
  /** Verschiedene Tage in einer Nachricht. */
  conflict: boolean;
};

/** Tagesangaben in einer Nachricht finden (Regeln siehe Kopf der Datei). */
export function dayMarks(text: string, messageDay: string): DayMarks {
  const prev = shift(messageDay, -1);
  const explicit: DayMarks["explicit"] = [];
  const clauses = text.split(CLAUSE).map((c) => c.trim()).filter(Boolean);
  const numeric = (clause: string) =>
    /\d/.test(clause) || Object.keys(readMetrics(clause).metrics).length > 0;
  const relative = (word: string) => (word.toLowerCase() === "gestern" ? prev : messageDay);

  let m = DATE_START.exec(text);
  if (m) {
    const day = resolveDate(m[1], m[2], m[3], messageDay);
    if (day) explicit.push({ day, from: `${m[1]}.${m[2]}.`, kind: "date" });
  }
  for (const p of text.matchAll(DATE_PHRASE)) {
    const day = resolveDate(p[1], p[2], p[3], messageDay);
    if (day) explicit.push({ day, from: `${p[1]}.${p[2]}.`, kind: "date" });
  }
  m = WEEKDAY_START.exec(text);
  if (m) {
    const word = m[1].toLowerCase();
    const target = WEEKDAYS_DE.indexOf(word) + 1 || WEEKDAY_SHORT[word];
    const w = new Date(`${messageDay}T12:00:00Z`).getUTCDay();
    const back = ((w === 0 ? 7 : w) - target + 7) % 7;
    explicit.push({ day: shift(messageDay, -back), from: m[1], kind: "weekday" });
  }
  // Eine Begrüßung davor („Moin! Gestern 40 Calls“) ändert nichts am Anfang.
  const opening = text.replace(GREETING, "");
  m = RELATIVE_START.exec(opening);
  // Am Anfang nur mit direktem Trennzeichen („Gestern: …“) oder wenn der erste
  // Satzteil Zahlen enthält („Gestern 40 Calls“). „Gestern hatte ich keine
  // Zeit, …“ ist Fließtext.
  if (m && (m[2] !== undefined || numeric(opening.split(CLAUSE)[0] || "")))
    explicit.push({ day: relative(m[1]), from: m[1].toLowerCase(), kind: "relative" });
  // Feste Wendungen mitten im Text zählen nur mit Zahlen im selben Satzteil:
  // „Heute: 40 Calls / Gestern: frei“ nennt nur für heute Zahlen.
  for (const clause of clauses)
    for (const p of clause.matchAll(RELATIVE_PHRASE)) {
      if (!numeric(clause)) continue;
      const word = (p[1] || p[2] || p[3]).toLowerCase();
      explicit.push({ day: relative(word), from: word, kind: "relative" });
    }
  let yesterdayNearNumbers = false;
  let yesterdayInProse = false;
  for (const clause of clauses)
    for (const w of clause.matchAll(RELATIVE_WORD)) {
      const word = w[1].toLowerCase();
      if (word === "heute") {
        // „heute“ bei Zahlen bestätigt den Tag der Nachricht.
        if (numeric(clause)) explicit.push({ day: messageDay, from: "heute", kind: "relative" });
      } else if (numeric(clause)) yesterdayNearNumbers = true;
      else yesterdayInProse = true;
    }
  const strongYesterday = explicit.some((e) => e.day === prev && e.kind === "relative");
  const days = new Set(explicit.map((e) => e.day));
  if (yesterdayNearNumbers && !strongYesterday) days.add(prev);
  return {
    explicit,
    yesterdayNearNumbers: yesterdayNearNumbers && !strongYesterday,
    yesterdayInProse: yesterdayInProse && !strongYesterday,
    nachtrag: NACHTRAG.test(text),
    conflict: days.size > 1,
  };
}

// ---------------------------------------------------------------------------
// Stand je Kennzahl: welcher Wert gilt?

export const CUMULATIVE: Metric[] = ["attempts", "settingsBooked", "closingsBooked", "settingsHeld", "closingsHeld", "dealsWon"];

export type Settled = {
  value: number | null;
  /** Zeitpunkt der Meldung, aus der der gültige Wert stammt. */
  stamp: string | null;
  changed: boolean;
  /** Spätere Meldung mit niedrigerem Wert, nicht übernommen (Prüffall). */
  conflict: FieldConflict | null;
  /** Ältere Meldungen mit anderem Wert: der neuere Stand bleibt. */
  older: Observation[];
};

/**
 * Welcher Wert gilt für eine Kennzahl? Je Kennzahl gewinnt die späteste
 * Meldung — gemessen am Zeitpunkt der Nachricht, nicht an der Reihenfolge des
 * Einfügens. Damit ist ein Import wiederholbar: derselbe Verlauf ändert
 * nichts, ein erneut eingefügter älterer Ausschnitt überschreibt nie einen
 * neueren Stand, und eine spätere Korrektur gewinnt.
 *
 * - stored: der gespeicherte Stand und der Zeitpunkt seiner Quelle. Meldungen,
 *   die älter sind, ändern ihn nicht (sie stecken schon darin oder sind
 *   überholt). Ein leerer Wert (null) wird immer aufgefüllt.
 * - Meldungen ohne Uhrzeit (Liste „Name: …“) gelten zum Zeitpunkt now.
 * - Eine spätere Meldung mit NIEDRIGEREM Wert bei zählenden Kennzahlen wird
 *   nicht still übernommen, sondern als conflict zurückgegeben — außer bei
 *   ausdrücklicher Korrektur oder bearbeiteter Nachricht.
 * - Dieselbe Nachricht (gleicher Zeitpunkt wie der gespeicherte Stand) mit
 *   anderem Wert ist ebenfalls ein conflict, außer sie wurde bearbeitet.
 */
export function settle(
  metric: Metric,
  stored: { value: number | null; stamp: string | null } | null,
  observations: Observation[],
  now: string,
): Settled {
  const cumulative = CUMULATIVE.includes(metric);
  const at = (o: Observation) => o.stamp ?? now;
  const sorted = observations
    .filter((o) => o.metric === metric)
    .sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : a.line - b.line));
  let value = stored?.value ?? null;
  let stamp = value === null ? null : stored?.stamp ?? null;
  let fromStored = value !== null;
  let conflict: FieldConflict | null = null;
  const older: Observation[] = [];
  for (const o of sorted) {
    const when = at(o);
    if (value !== null && stamp !== null) {
      if (when < stamp) {
        if (o.value !== value) older.push(o);
        continue;
      }
      if (when === stamp && fromStored && o.value !== value && !o.correction) {
        conflict = { metric, from: value, to: o.value, stamp: o.stamp, line: o.line, kind: "same-time" };
        continue;
      }
    }
    if (value === null || o.value >= value || !cumulative || o.correction) {
      value = o.value;
      stamp = when;
      fromStored = false;
      conflict = null;
    } else conflict = { metric, from: value, to: o.value, stamp: o.stamp, line: o.line, kind: "lower" };
  }
  return { value, stamp, changed: value !== (stored?.value ?? null), conflict, older };
}

export const metricLabel = (metric: Metric) => metricLabels[metric];

/** Prüftext für eine spätere Meldung mit niedrigerem Wert. */
export function conflictReason(c: FieldConflict) {
  const when = c.stamp ? ` (Meldung ${shortDay(c.stamp.slice(0, 10))} ${c.stamp.slice(11)} Uhr)` : "";
  return c.kind === "same-time"
    ? `Dieselbe Nachricht${when} enthält jetzt einen anderen Wert: ${metricLabel(c.metric)} ${c.from} → ${c.to}. Nachträglich bearbeitet? Bis zur Entscheidung bleibt ${c.from}.`
    : `Spätere Meldung mit niedrigerem Wert${when}: ${metricLabel(c.metric)} ${c.from} → ${c.to}. Korrektur oder Tippfehler? Bis zur Entscheidung bleibt ${c.from}.`;
}

// ---------------------------------------------------------------------------
// Gesamtauswertung

export function parseWins({
  text,
  defaultDay,
  directory,
  lateNightCutoff = LATE_NIGHT_CUTOFF,
  morningUntil = MORNING_UNTIL,
  today = defaultDay,
}: {
  text: string;
  defaultDay: string;
  directory: DirectoryEntry[];
  /** Meldungen vor dieser Uhrzeit gehören automatisch zum Vortag. */
  lateNightCutoff?: string;
  /** Bis zu dieser Uhrzeit sind Meldungen ohne Tagesangabe ein Prüffall „Vortag oder heute?“. */
  morningUntil?: string;
  /** Heutiges Datum, für „Heute“/„Gestern“ als Tagestrenner. */
  today?: string;
}): WinsEntry[] {
  const entries: WinsEntry[] = splitMessages(text, defaultDay, today, { strict: true }).map((m) => {
    const reasons: string[] = [];
    const notes: string[] = [];
    const prev = shift(m.messageDay, -1);
    const { metrics, conflicts, increment, uncertain } = readMetrics(m.text);
    const marks = dayMarks(m.text, m.messageDay);
    const late = m.time !== null && m.time < lateNightCutoff;
    const morning = m.time !== null && !late && m.time < morningUntil;
    const dated = marks.explicit.find((e) => e.kind !== "relative");
    let day = m.messageDay;
    let days: string[] = [];
    let multiDay = false;
    if (marks.conflict) {
      multiDay = true;
      const named = [...new Set(marks.explicit.map((e) => e.day).concat(marks.yesterdayNearNumbers ? [prev] : []))]
        .sort()
        .map(shortDay);
      reasons.push(
        `Die Nachricht nennt mehrere Tage (${named.join(", ")}). Bitte die Zahlen je Tag prüfen und einzeln als „Name: …“ mit dem passenden Leistungstag einfügen.`,
      );
    } else if (dated) {
      day = dated.day;
      if (day !== m.messageDay) notes.push(`Leistungstag aus „${dated.from}“ abgeleitet.`);
    } else if (late) {
      day = prev;
      notes.push(`Nach Mitternacht gemeldet (${m.time} Uhr) — dem Vortag zugeordnet.`);
    } else if (marks.explicit.length) {
      day = marks.explicit[0].day;
      if (day !== m.messageDay) notes.push(`Leistungstag aus „${marks.explicit[0].from}“ abgeleitet.`);
    } else if (Object.keys(metrics).length && (marks.yesterdayNearNumbers || marks.nachtrag || morning)) {
      day = prev;
      days = [prev, m.messageDay];
      const why = marks.yesterdayNearNumbers
        ? "„gestern“ steht bei den Zahlen, aber nicht als klare Tagesangabe"
        : marks.nachtrag
          ? "„Nachtrag“ ohne Tagesangabe"
          : `Vormittags (${m.time} Uhr) ohne Tagesangabe gemeldet`;
      reasons.push(
        `Vortag oder heute? ${why}. Vorschlag: Vortag (${shortDay(prev)}). Bitte beim Prüffall den Tag wählen.`,
      );
    } else if (marks.yesterdayInProse)
      notes.push("„gestern“ steht nur im Text, nicht als Tagesangabe. Die Zahlen zählen für den Tag der Nachricht.");
    const matches = m.author ? resolveAuthor(m.author, directory) : [];
    if (!Object.keys(metrics).length) reasons.push("Keine Kennzahl erkannt.");
    if (conflicts.length)
      reasons.push(
        `Widersprüchliche Werte in einer Nachricht: ${conflicts.map(metricLabel).join(", ")}.`,
      );
    if (increment)
      reasons.push(
        "Klingt nach Zuwachs („noch ein …“, „2. Termin“) statt nach Tagesstand. Bitte den vollständigen Stand prüfen.",
      );
    if (uncertain)
      reasons.push(
        "Halbe, Dezimal- oder unsichere Angabe („1,5“, „½“, „ca.“, „vielleicht“). Bitte den festen Stand prüfen.",
      );
    let personProblem = true;
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
    else personProblem = false;
    const match = matches.length === 1 ? matches[0] : null;
    const joint = match?.kind === "joint";
    const applicable = Object.keys(metrics).length > 0 && !increment && !multiDay && !joint;
    const stamp = m.time ? `${m.messageDay} ${m.time}` : null;
    const correction = !!m.edited || CORRECTION.test(m.text);
    if (m.edited) notes.push("Nachricht wurde nachträglich bearbeitet: gilt als Korrektur.");
    return {
      author: m.author || "(ohne Absender)",
      participantId: match?.id ?? null,
      participantName: match?.name ?? null,
      day,
      messageDay: m.messageDay,
      time: m.time,
      stamp,
      metrics,
      observations: (Object.entries(metrics) as [Metric, number][]).map(([metric, value]) => ({
        metric,
        value,
        stamp,
        line: m.line,
        correction,
      })),
      status: reasons.length ? "review" : "ok",
      review: !reasons.length
        ? null
        : !applicable
          ? "unclear"
          : personProblem
            ? "person"
            : days.length
              ? "day"
              : "value",
      days,
      applicable,
      correction,
      conflicts: [],
      reasons,
      notes,
      excerpt: m.text.replace(/\s*\n\s*/g, " · ").slice(0, 160),
      text: m.text,
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
  // Ohne Uhrzeit ans Ende, in Zeilenfolge.
  const LAST = "\uffff";
  const order = (e: WinsEntry) => `${e.stamp ?? LAST}|${String(e.line).padStart(6, "0")}`;
  for (const group of groups.values()) {
    group.sort((a, b) => order(a).localeCompare(order(b)));
    const latest = group.at(-1)!;
    const observations = group.flatMap((e) => e.observations);
    const merged: Partial<Counts> = {};
    const takenFrom: string[] = [];
    for (const metric of new Set(observations.map((o) => o.metric))) {
      const s = settle(metric, null, observations, LAST);
      merged[metric] = s.value;
      if (s.conflict) latest.conflicts.push(s.conflict);
      if (!(metric in latest.metrics)) {
        const source = group.find((e) => e.metrics[metric] === s.value && s.stamp === (e.stamp ?? LAST));
        if (source)
          takenFrom.push(
            `${metricLabel(metric)} aus der Meldung ${source.time ? `um ${source.time} Uhr` : `in Zeile ${source.line}`}`,
          );
      }
    }
    latest.metrics = merged;
    latest.observations = observations;
    if (takenFrom.length) latest.notes.push(`Zusammengeführt: ${takenFrom.join(", ")}.`);
    if (latest.conflicts.length) {
      latest.status = "review";
      latest.review = "value";
      latest.reasons.push(...latest.conflicts.map(conflictReason));
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
