/**
 * Dranbleiben: Pflicht-Tage, Fristen, Serien und Status.
 *
 * Alles hier ist eine reine Funktion ohne Datenbank und ohne Uhrzeit aus der
 * Umgebung — „jetzt" wird immer hineingereicht. Dieselben Regeln gelten damit
 * für die Anzeige, für den Erinnerungs-Scheduler und für die Tests.
 *
 * Startwerte (konfigurierbar über commitmentSettings / app_settings):
 * - Montag bis Freitag sind reguläre Calling-Tage. Samstag und Sonntag sind
 *   ausdrücklich keine Pflicht-Tage: keine Erinnerung, kein Strike, kein
 *   Serienverlust.
 * - Ein Tag ist fristgerecht abgeschlossen, wenn der vollständige Abschluss
 *   vor 10:00 Uhr (Europe/Berlin) am nächsten fälligen Calling-Tag eingeht.
 *   Freitag lässt sich damit bis Montagvormittag abschließen.
 * - Genehmigte Pausen nehmen Tage aus der Pflicht heraus und verschieben die
 *   Frist auf den nächsten fälligen Tag danach.
 */

export type Clock = { hour: number; minute: number };
export type CommitmentSettings = {
  timeZone: string;
  /** ISO-Wochentage, 1 = Montag … 7 = Sonntag. */
  callingWeekdays: number[];
  /** Frist: diese Stunde am nächsten fälligen Calling-Tag. */
  deadlineHour: number;
  eveningReminder: Clock;
  streakWarning: Clock;
  /** Inaktiv ab MEHR als so vielen abgelaufenen Pflicht-Tagen ohne Calls. */
  inactivityAfterDays: number;
  /** Teamprüfung ab so vielen offenen fehlenden Abschlüssen. */
  reviewAfterMissing: number;
  /**
   * Ein fristgerechter Abschluss ohne Anwahlen verlängert die Calling-Serie
   * nicht. Ob er sie auch unterbricht, ist hier einstellbar; Startwert:
   * nein — er hält sie an, die Reflexionsserie läuft weiter.
   */
  zeroCallDayBreaksCallingStreak: boolean;
};

export const defaultCommitmentSettings: CommitmentSettings = {
  timeZone: "Europe/Berlin",
  callingWeekdays: [1, 2, 3, 4, 5],
  deadlineHour: 10,
  eveningReminder: { hour: 20, minute: 30 },
  streakWarning: { hour: 9, minute: 0 },
  inactivityAfterDays: 3,
  reviewAfterMissing: 3,
  zeroCallDayBreaksCallingStreak: false,
};

/** Genehmigte Pause, beide Tage einschließlich. */
export type Pause = { from: string; to: string };

/** Ein vollständig eingereichter Tagesabschluss. Entwürfe zählen nie. */
export type Closing = {
  day: string;
  /** Zeitpunkt der letzten vollständigen Einreichung, ISO. */
  submittedAt: string;
  /** Erste vollständige Einreichung, ISO. Entscheidet über die Frist. */
  firstSubmittedAt: string;
  attempts: number | null;
  /**
   * Wann Telefonaktivität (Anwahlen > 0) zum ersten Mal vollständig
   * eingereicht wurde, ISO. Ein Calling-Tag braucht diese Angabe bis zur
   * Frist — eine spätere Korrektur macht aus einem Tag ohne Calls keinen
   * Calling-Tag. Fehlt sie, gilt die erste Einreichung.
   */
  callsDocumentedAt?: string | null;
};

// ---------------------------------------------------------------------------
// Kalenderrechnung auf reinen Datumszeichenketten (YYYY-MM-DD).

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function assertDay(day: string) {
  if (!DAY.test(day)) throw Error(`Ungültiges Datum: ${day}`);
}
export function addDays(day: string, n: number): string {
  assertDay(day);
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 1 = Montag … 7 = Sonntag. */
export function isoWeekday(day: string): number {
  assertDay(day);
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}
export function isPaused(day: string, pauses: Pause[]): boolean {
  return pauses.some((p) => p.from <= day && day <= p.to);
}
/** Ein Pflicht-Tag: regulärer Calling-Tag und nicht pausiert. */
export function isDueDay(
  day: string,
  settings: CommitmentSettings,
  pauses: Pause[] = [],
): boolean {
  return (
    settings.callingWeekdays.includes(isoWeekday(day)) && !isPaused(day, pauses)
  );
}
export function nextDueDay(
  day: string,
  settings: CommitmentSettings,
  pauses: Pause[] = [],
): string {
  let next = addDays(day, 1);
  // Höchstens ein Jahr voraus suchen: eine längere Pause ist kein Kalender,
  // sondern ein Datenfehler.
  for (let i = 0; i < 370; i++, next = addDays(next, 1))
    if (isDueDay(next, settings, pauses)) return next;
  throw Error("Kein fälliger Calling-Tag innerhalb eines Jahres gefunden.");
}
export function previousDueDay(
  day: string,
  settings: CommitmentSettings,
  pauses: Pause[] = [],
): string | null {
  let prev = addDays(day, -1);
  for (let i = 0; i < 370; i++, prev = addDays(prev, -1))
    if (isDueDay(prev, settings, pauses)) return prev;
  return null;
}

// ---------------------------------------------------------------------------
// Zeitzonen ohne Bibliothek. Intl liefert für jeden Zeitpunkt die lokale Uhr;
// daraus ergibt sich der Versatz, auch über Sommer-/Winterzeit hinweg.

function zonedParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}
/** Lokaler Kalendertag eines Zeitpunkts in der Zeitzone. */
export function localDay(instant: Date, timeZone: string): string {
  return zonedParts(instant, timeZone).day;
}
/** Lokale Uhrzeit eines Zeitpunkts in Minuten seit Mitternacht. */
export function localMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}
/**
 * Zeitpunkt (UTC) für eine lokale Uhrzeit an einem lokalen Tag.
 * Zweimal angenähert, weil der Versatz selbst vom Zeitpunkt abhängt.
 */
export function zonedTime(
  day: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  assertDay(day);
  const wanted = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
    hour,
    minute,
  );
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(
      Number(p.day.slice(0, 4)),
      Number(p.day.slice(5, 7)) - 1,
      Number(p.day.slice(8, 10)),
      p.hour,
      p.minute,
    );
    guess += wanted - shown;
  }
  return new Date(guess);
}

/** Frist für den Abschluss eines Tages. */
export function deadlineFor(
  day: string,
  settings: CommitmentSettings,
  pauses: Pause[] = [],
): Date {
  return zonedTime(
    nextDueDay(day, settings, pauses),
    settings.deadlineHour,
    0,
    settings.timeZone,
  );
}

// ---------------------------------------------------------------------------
// Tagesstatus und Serien.

export type DayStatus =
  /** Vor dem Beginn der eigenen Erfassung. Nie ein Strike. */
  | "before-start"
  /** Wochenende oder anderer Nicht-Pflicht-Tag ohne Abschluss. */
  | "free"
  /** Freiwilliger Abschluss an einem Nicht-Pflicht-Tag. */
  | "bonus"
  | "paused"
  | "future"
  /** Pflicht-Tag, Frist läuft noch, noch kein Abschluss. */
  | "open"
  /** Fristgerecht abgeschlossen, mit Anwahlen. */
  | "called"
  /** Fristgerecht abgeschlossen, ohne Anwahlen. */
  | "reflected"
  /** Nach der Frist abgeschlossen. Zahlen zählen, die Serie nicht. */
  | "late"
  /** Frist verstrichen, kein Abschluss. */
  | "missed";

export type DayState = {
  day: string;
  status: DayStatus;
  due: boolean;
  deadline: string | null;
  attempts: number | null;
};

export type CommitmentSummary = {
  calling: { current: number; best: number };
  reflection: { current: number; best: number };
  /** Tage mit abgeschlossenen Anwahlen (> 0) im betrachteten Zeitraum. */
  activeDays: number;
  /** Tage mit vollständigem Abschluss im betrachteten Zeitraum. */
  closedDays: number;
  /** Mehr als N abgelaufene Pflicht-Tage in Folge ohne Anwahlen. */
  inactive: boolean;
  /** Abgelaufene Pflicht-Tage ohne jeden Abschluss (auch nicht verspätet). */
  missingOpen: number;
  needsTeamReview: boolean;
  /** Der zuletzt fällige Tag ist noch offen und eine Serie hängt daran. */
  atRisk: { day: string; deadline: string } | null;
  days: DayState[];
};

function hasCalls(closing: Closing | undefined) {
  return !!closing && (closing.attempts ?? 0) > 0;
}
/** Anrufe vorhanden UND bis zur Frist dokumentiert. */
function calledOnTime(closing: Closing, deadline: Date) {
  return (
    hasCalls(closing) &&
    new Date(closing.callsDocumentedAt ?? closing.firstSubmittedAt) <= deadline
  );
}

/**
 * Wertet einen Zeitraum aus. `trackingStart` ist der erste Tag eigener
 * Erfassung: davor gibt es weder Strikes noch fehlende Abschlüsse — auch
 * nicht für Profile mit importierter Historie.
 */
export function summarize({
  closings,
  pauses = [],
  trackingStart,
  from,
  to,
  now,
  settings = defaultCommitmentSettings,
}: {
  closings: Closing[];
  pauses?: Pause[];
  trackingStart: string | null;
  from: string;
  to: string;
  now: Date;
  settings?: CommitmentSettings;
}): CommitmentSummary {
  const byDay = new Map(closings.map((c) => [c.day, c]));
  const today = localDay(now, settings.timeZone);
  const days: DayState[] = [];

  let callingRun = 0,
    callingBest = 0,
    reflectionRun = 0,
    reflectionBest = 0,
    noCallRun = 0,
    inactive = false,
    missingOpen = 0,
    activeDays = 0,
    closedDays = 0,
    atRisk: CommitmentSummary["atRisk"] = null;

  // Serien werden über die GESAMTE Zeit ab Erfassungsbeginn gebildet, damit
  // eine Monatsansicht nicht mitten in einer Serie bei null beginnt.
  const start = trackingStart && trackingStart < from ? trackingStart : from;
  for (let day = start; day <= to; day = addDays(day, 1)) {
    const closing = byDay.get(day);
    const due = isDueDay(day, settings, pauses);
    const deadline = due ? deadlineFor(day, settings, pauses) : null;
    let status: DayStatus;

    if (!trackingStart || day < trackingStart) status = "before-start";
    else if (day > today) status = "future";
    else if (!due)
      status = closing ? "bonus" : isPaused(day, pauses) ? "paused" : "free";
    else if (closing)
      status =
        new Date(closing.firstSubmittedAt) <= deadline!
          ? calledOnTime(closing, deadline!)
            ? "called"
            : "reflected"
          : "late";
    else status = now < deadline! ? "open" : "missed";

    if (closing && status !== "before-start" && status !== "future") {
      closedDays += day >= from ? 1 : 0;
      if (hasCalls(closing) && day >= from) activeDays++;
    }

    // Serien laufen nur über Pflicht-Tage. Freie Tage, Pausen, offene Tage
    // und Bonus-Tage verändern sie nicht.
    if (status === "called") {
      callingRun++;
      reflectionRun++;
      noCallRun = 0;
    } else if (status === "reflected") {
      reflectionRun++;
      if (settings.zeroCallDayBreaksCallingStreak) callingRun = 0;
      // Für die Inaktivität zählt ein Tag ohne Calls erst, wenn seine Frist
      // vorbei ist — bis dahin kann noch ein Calling-Tag daraus werden.
      if (now >= deadline!) noCallRun++;
    } else if (status === "late") {
      // Verspätet: die Zahlen zählen, die Serie ist trotzdem gerissen. Ein
      // verspäteter Abschluss mit Anwahlen beendet aber die Inaktivität.
      callingRun = 0;
      reflectionRun = 0;
      noCallRun = hasCalls(closing) ? 0 : noCallRun + 1;
    } else if (status === "missed") {
      callingRun = 0;
      reflectionRun = 0;
      noCallRun++;
      missingOpen++;
    }
    // Inaktiv (mehr als die Schwelle an Pflicht-Tagen ohne Calls): die
    // Calling-Serie endet. Tage ohne Calls halten sie nur kurz an.
    if (noCallRun > settings.inactivityAfterDays) {
      inactive = true;
      callingRun = 0;
    }
    callingBest = Math.max(callingBest, callingRun);
    reflectionBest = Math.max(reflectionBest, reflectionRun);
    if (status === "called" || (status === "late" && hasCalls(closing)))
      inactive = false;

    // Der früheste offene Tag hat die nächste Frist und ist damit der
    // dringendste; spätere offene Tage überschreiben ihn nicht.
    if (!atRisk && status === "open" && (callingRun > 0 || reflectionRun > 0))
      atRisk = { day, deadline: deadline!.toISOString() };

    if (day >= from)
      days.push({
        day,
        status,
        due,
        deadline: deadline ? deadline.toISOString() : null,
        attempts: closing?.attempts ?? null,
      });
  }

  return {
    calling: { current: callingRun, best: callingBest },
    reflection: { current: reflectionRun, best: reflectionBest },
    activeDays,
    closedDays,
    inactive,
    missingOpen,
    needsTeamReview: missingOpen >= settings.reviewAfterMissing,
    atRisk,
    days,
  };
}

// ---------------------------------------------------------------------------
// Erinnerungen. Wann welcher Hinweis fällig ist — ob er verschickt wird,
// entscheidet der Scheduler nach erneuter Prüfung des Zustands.

export type ReminderKind = "evening" | "streak";
export type ReminderDue = {
  kind: ReminderKind;
  /** Der Leistungstag, auf den sich die Erinnerung bezieht. */
  day: string;
  /** Eindeutig je Person, Art und Tag: doppelte Worker erzeugen nichts Doppeltes. */
  dedupeKey: string;
};

/** Fenster, in dem ein verpasster Takt noch nachgeholt wird (Minuten). */
export const REMINDER_WINDOW_MINUTES = 60;

function inWindow(minutes: number, at: Clock, width: number) {
  const start = at.hour * 60 + at.minute;
  return minutes >= start && minutes < start + width;
}
export function inQuietHours(
  minutes: number,
  quiet: { start: number; end: number } | null,
) {
  if (!quiet || quiet.start === quiet.end) return false;
  return quiet.start < quiet.end
    ? minutes >= quiet.start && minutes < quiet.end
    : minutes >= quiet.start || minutes < quiet.end;
}

/**
 * Welche Erinnerung wäre jetzt für diese Person fällig?
 * Nie am Wochenende, nie an pausierten Tagen, nie ohne Erfassungsbeginn.
 */
export function remindersDue({
  owner,
  closings,
  pauses = [],
  trackingStart,
  now,
  settings = defaultCommitmentSettings,
}: {
  owner: string;
  closings: Closing[];
  pauses?: Pause[];
  trackingStart: string | null;
  now: Date;
  settings?: CommitmentSettings;
}): ReminderDue[] {
  if (!trackingStart) return [];
  const today = localDay(now, settings.timeZone);
  const minutes = localMinutes(now, settings.timeZone);
  const closed = new Set(closings.map((c) => c.day));
  const due: ReminderDue[] = [];

  // Abends am Pflicht-Tag selbst, falls der Abschluss fehlt.
  if (
    today >= trackingStart &&
    isDueDay(today, settings, pauses) &&
    !closed.has(today) &&
    inWindow(minutes, settings.eveningReminder, REMINDER_WINDOW_MINUTES)
  )
    due.push({
      kind: "evening",
      day: today,
      dedupeKey: `evening:${owner}:${today}`,
    });

  // Morgens am nächsten fälligen Tag vor der Frist — nur wenn tatsächlich
  // eine bestehende Serie daran hängt.
  if (
    isDueDay(today, settings, pauses) &&
    minutes < settings.deadlineHour * 60 &&
    inWindow(minutes, settings.streakWarning, REMINDER_WINDOW_MINUTES)
  ) {
    const previous = previousDueDay(today, settings, pauses);
    if (previous && previous >= trackingStart && !closed.has(previous)) {
      const summary = summarize({
        closings,
        pauses,
        trackingStart,
        from: previous,
        to: previous,
        now,
        settings,
      });
      if (summary.atRisk?.day === previous)
        due.push({
          kind: "streak",
          day: previous,
          dedupeKey: `streak:${owner}:${previous}`,
        });
    }
  }
  return due;
}
