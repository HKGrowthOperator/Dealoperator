import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  deadlineFor,
  defaultCommitmentSettings as S,
  isDueDay,
  isoWeekday,
  nextDueDay,
  remindersDue,
  summarize,
  zonedTime,
  type Closing,
} from "../lib/commitment";

// Berlin-Ortszeit als Zeitpunkt, damit die Tests die Regeln lesen, nicht UTC.
const at = (day: string, hh: number, mm = 0) =>
  zonedTime(day, hh, mm, "Europe/Berlin");
const closing = (
  day: string,
  attempts: number | null,
  submittedAt: Date,
): Closing => ({
  day,
  attempts,
  submittedAt: submittedAt.toISOString(),
  firstSubmittedAt: submittedAt.toISOString(),
});

// 2026-09-21 ist ein Montag.
const MO = "2026-09-21",
  DI = "2026-09-22",
  MI = "2026-09-23",
  DO = "2026-09-24",
  FR = "2026-09-25",
  SA = "2026-09-26",
  SO = "2026-09-27",
  MO2 = "2026-09-28";

test("weekdays: Monday to Friday are due, the weekend never is", () => {
  assert.equal(isoWeekday(MO), 1);
  assert.equal(isoWeekday(SO), 7);
  for (const d of [MO, DI, MI, DO, FR]) assert.equal(isDueDay(d, S), true, d);
  for (const d of [SA, SO]) assert.equal(isDueDay(d, S), false, d);
  assert.equal(nextDueDay(FR, S), MO2);
});

test("Friday can be closed until Monday 10:00 Berlin time, not a minute later", () => {
  const deadline = deadlineFor(FR, S);
  assert.equal(deadline.toISOString(), at(MO2, 10).toISOString());
  const early = summarize({
    closings: [closing(FR, 40, at(MO2, 9, 59))],
    trackingStart: MO,
    from: FR,
    to: FR,
    now: at(MO2, 12),
  });
  assert.equal(early.days[0].status, "called");
  const late = summarize({
    closings: [closing(FR, 40, at(MO2, 10, 1))],
    trackingStart: MO,
    from: FR,
    to: FR,
    now: at(MO2, 12),
  });
  assert.equal(late.days[0].status, "late");
});

test("deadlines follow daylight saving time in both directions", () => {
  // Ende der Sommerzeit am 25.10.2026: Montag 10:00 ist dann 09:00 UTC.
  assert.equal(
    deadlineFor("2026-10-23", S).toISOString(),
    "2026-10-26T09:00:00.000Z",
  );
  // Beginn der Sommerzeit am 28.03.2027: Montag 10:00 ist dann 08:00 UTC.
  assert.equal(
    deadlineFor("2027-03-26", S).toISOString(),
    "2027-03-29T08:00:00.000Z",
  );
});

test("a complete closing without calls extends the one streak like any other on-time closing", () => {
  const s = summarize({
    closings: [
      closing(MO, 50, at(MO, 19)),
      closing(DI, 0, at(DI, 19)),
      closing(MI, 60, at(MI, 19)),
    ],
    trackingStart: MO,
    from: MO,
    to: MI,
    now: at(MI, 22),
  });
  assert.deepEqual(
    s.days.map((d) => d.status),
    ["called", "reflected", "called"],
  );
  assert.equal(s.streak.current, 3);
  // Aktive Tage zählen weiter nur Tage mit Anwahlen.
  assert.equal(s.activeDays, 2);
  assert.equal(s.closedDays, 3);
});

test("a reflection with 0 calls never breaks the streak, even over weeks", () => {
  // Drei Wochen lang jeden Calling-Tag rechtzeitig reflektiert, immer 0 Anwahlen.
  const days: string[] = [];
  for (let d = MO; days.length < 15; d = addDays(d, 1)) if (isDueDay(d, S, [])) days.push(d);
  const last = days.at(-1)!;
  const s = summarize({
    closings: days.map((d) => closing(d, 0, at(d, 19))),
    trackingStart: MO,
    from: MO,
    to: last,
    now: at(last, 22),
  });
  assert.equal(s.streak.current, 15);
  assert.equal(s.streak.best, 15);
  assert.ok(s.days.filter((d) => d.due).every((d) => d.status === "reflected"));
  assert.equal(s.missingOpen, 0);
  // Ohne Calls gilt man für das Team als inaktiv; die Serie bleibt davon unberührt.
  assert.equal(s.inactive, true);
  // Es gibt nur diese eine Serie.
  assert.deepEqual(Object.keys(s).filter((k) => /calling|reflection/i.test(k)), []);
});

test("the ranking sorts by the streak; active days only break ties", async () => {
  const { byCommitment } = await import("../server/commitment-public");
  const row = (name: string, streak: number, activeDays: number) => ({
    name,
    streak: { current: streak },
    activeDays,
  });
  const sorted = [
    row("Viele Calltage", 2, 9),
    row("Immer reflektiert, 0 Calls", 5, 0),
    row("Gleiche Serie, weniger Calltage", 2, 1),
  ].sort(byCommitment);
  assert.deepEqual(sorted.map((r) => r.name), [
    "Immer reflektiert, 0 Calls",
    "Viele Calltage",
    "Gleiche Serie, weniger Calltage",
  ]);
});

test("a missed due day breaks the streak; the best streak is kept", () => {
  const s = summarize({
    closings: [
      closing(MO, 50, at(MO, 19)),
      closing(DI, 50, at(DI, 19)),
      // Mittwoch fehlt.
      closing(DO, 50, at(DO, 19)),
    ],
    trackingStart: MO,
    from: MO,
    to: DO,
    now: at(DO, 22),
  });
  assert.equal(s.days[2].status, "missed");
  assert.equal(s.streak.current, 1);
  assert.equal(s.streak.best, 2);
  assert.equal(s.missingOpen, 1);
});

test("numbers taken over from the group count as days with calls, never as missing", () => {
  const s = summarize({
    closings: [closing(MO, 50, at(MO, 19))],
    // Dienstag und Mittwoch nur aus der Gruppe übernommen, Donnerstag gar nicht.
    imported: [
      { day: DI, attempts: 45 },
      { day: MI, attempts: 0 },
    ],
    trackingStart: MO,
    from: MO,
    to: FR,
    now: at(FR, 22),
  });
  assert.deepEqual(
    s.days.map((d) => d.status),
    ["called", "imported", "imported", "missed", "open"],
  );
  assert.equal(s.days[1].attempts, 45);
  // Anwahlen aus der Gruppe zählen als Tag mit Anwahlen, die Serie nicht.
  assert.equal(s.activeDays, 2);
  assert.equal(s.closedDays, 1);
  assert.equal(s.streak.current, 0);
  assert.equal(s.streak.best, 1);
  // Nur Donnerstag fehlt wirklich.
  assert.equal(s.missingOpen, 1);
  assert.equal(s.needsTeamReview, false);
  // Solange die Frist läuft, bleibt ein übernommener Tag offen.
  const early = summarize({
    closings: [],
    imported: [{ day: MO, attempts: 30 }],
    trackingStart: MO,
    from: MO,
    to: MO,
    now: at(MO, 20),
  });
  assert.equal(early.days[0].status, "open");
});

test("the weekend neither breaks nor extends a streak; a weekend closing is a bonus day", () => {
  const s = summarize({
    closings: [
      closing(FR, 50, at(FR, 19)),
      closing(SA, 20, at(SA, 12)),
      closing(MO2, 50, at(MO2, 19)),
    ],
    trackingStart: FR,
    from: FR,
    to: MO2,
    now: at(MO2, 22),
  });
  assert.deepEqual(
    s.days.map((d) => d.status),
    ["called", "bonus", "free", "called"],
  );
  assert.equal(s.streak.current, 2);
  assert.equal(s.activeDays, 3);
});

test("approved pauses take days out of duty and move the deadline", () => {
  const pauses = [{ from: DI, to: MI }];
  assert.equal(isDueDay(DI, S, pauses), false);
  assert.equal(nextDueDay(MO, S, pauses), DO);
  assert.equal(
    deadlineFor(MO, S, pauses).toISOString(),
    at(DO, 10).toISOString(),
  );
  const s = summarize({
    closings: [closing(MO, 50, at(DO, 9)), closing(DO, 50, at(DO, 19))],
    pauses,
    trackingStart: MO,
    from: MO,
    to: DO,
    now: at(DO, 22),
  });
  assert.deepEqual(
    s.days.map((d) => d.status),
    ["called", "paused", "paused", "called"],
  );
  assert.equal(s.streak.current, 2);
  assert.equal(s.missingOpen, 0);
});

test("history before the tracking start never produces a strike", () => {
  const s = summarize({
    closings: [],
    trackingStart: DO,
    from: MO,
    to: DO,
    now: at(DO, 12),
  });
  assert.deepEqual(
    s.days.map((d) => d.status),
    ["before-start", "before-start", "before-start", "open"],
  );
  assert.equal(s.missingOpen, 0);
  assert.equal(s.inactive, false);
  // Ohne eigene Erfassung gibt es überhaupt keinen Status.
  const imported = summarize({
    closings: [],
    trackingStart: null,
    from: MO,
    to: FR,
    now: at(MO2, 12),
  });
  assert.equal(imported.missingOpen, 0);
  assert.ok(imported.days.every((d) => d.status === "before-start"));
});

test("more than three elapsed due days without calls make a member inactive; three do not", () => {
  const zero = (d: string) => closing(d, 0, at(d, 19));
  const three = summarize({
    closings: [zero(MO), zero(DI), zero(MI)],
    trackingStart: MO,
    from: MO,
    to: MI,
    now: at(DO, 11),
  });
  assert.equal(three.inactive, false);
  const four = summarize({
    closings: [zero(MO), zero(DI), zero(MI), zero(DO)],
    trackingStart: MO,
    from: MO,
    to: DO,
    now: at(FR, 11),
  });
  assert.equal(four.inactive, true);
  // Ein Tag mit Anwahlen beendet die Inaktivität.
  const back = summarize({
    closings: [
      zero(MO),
      zero(DI),
      zero(MI),
      zero(DO),
      closing(FR, 30, at(FR, 19)),
    ],
    trackingStart: MO,
    from: MO,
    to: FR,
    now: at(MO2, 11),
  });
  assert.equal(back.inactive, false);
});

test("three open missing closings trigger a team review; a late closing clears one", () => {
  const s = summarize({
    closings: [],
    trackingStart: MO,
    from: MO,
    to: MI,
    now: at(DO, 11),
  });
  assert.equal(s.missingOpen, 3);
  assert.equal(s.needsTeamReview, true);
  const caughtUp = summarize({
    closings: [closing(MO, 20, at(DO, 12))],
    trackingStart: MO,
    from: MO,
    to: MI,
    now: at(DO, 13),
  });
  assert.equal(caughtUp.days[0].status, "late");
  assert.equal(caughtUp.missingOpen, 2);
  assert.equal(caughtUp.needsTeamReview, false);
});

test("a correction after the deadline keeps an on-time day on time", () => {
  const corrected: Closing = {
    day: MO,
    attempts: 55,
    firstSubmittedAt: at(MO, 19).toISOString(),
    callsDocumentedAt: at(MO, 19).toISOString(),
    submittedAt: at(MI, 15).toISOString(),
  };
  const s = summarize({
    closings: [corrected],
    trackingStart: MO,
    from: MO,
    to: MO,
    now: at(MI, 16),
  });
  assert.equal(s.days[0].status, "called");
});

test("calls added only after the deadline never turn a day into a calling day", () => {
  // Fristgerecht mit 0 Anwahlen, nach der Frist auf 40 korrigiert.
  const corrected: Closing = {
    day: MO,
    attempts: 40,
    firstSubmittedAt: at(MO, 19).toISOString(),
    callsDocumentedAt: at(MI, 15).toISOString(),
    submittedAt: at(MI, 15).toISOString(),
  };
  const s = summarize({
    closings: [corrected],
    trackingStart: MO,
    from: MO,
    to: MO,
    now: at(MI, 16),
  });
  assert.equal(s.days[0].status, "reflected");
  assert.equal(s.activeDays, 1);
  assert.equal(s.streak.current, 1);
});

test("days without calls make a member inactive for the team, but never cost the streak", () => {
  const zero = (d: string) => closing(d, 0, at(d, 19));
  const s = summarize({
    closings: [
      closing(MO, 40, at(MO, 19)),
      zero(DI),
      zero(MI),
      zero(DO),
      zero(FR),
    ],
    trackingStart: MO,
    from: MO,
    to: FR,
    now: at(MO2, 11),
  });
  assert.equal(s.inactive, true);
  assert.equal(s.streak.current, 5);
  assert.equal(s.streak.best, 5);
});

test("a day without calls counts toward inactivity only after its deadline", () => {
  const zero = (d: string) => closing(d, 0, at(d, 19));
  const s = summarize({
    closings: [zero(MO), zero(DI), zero(MI), zero(DO)],
    trackingStart: MO,
    from: MO,
    to: DO,
    // Donnerstag ist eingereicht, seine Frist (Fr 10:00) aber noch offen.
    now: at(DO, 21),
  });
  assert.equal(s.inactive, false);
});

test("evening reminder: 20:30 on a due day without a closing, never on weekends", () => {
  const base = { owner: "u1", pauses: [], trackingStart: MO };
  assert.deepEqual(
    remindersDue({ ...base, closings: [], now: at(MI, 20, 30) }).map(
      (r) => r.dedupeKey,
    ),
    [`evening:u1:${MI}`],
  );
  // Abschluss vorhanden: nichts.
  assert.deepEqual(
    remindersDue({
      ...base,
      closings: [closing(MI, 10, at(MI, 18))],
      now: at(MI, 20, 45),
    }),
    [],
  );
  // Vor 20:30 und nach dem Fenster: nichts.
  assert.deepEqual(
    remindersDue({ ...base, closings: [], now: at(MI, 20, 29) }),
    [],
  );
  assert.deepEqual(
    remindersDue({ ...base, closings: [], now: at(MI, 21, 30) }),
    [],
  );
  // Wochenende und Pause: nichts.
  for (const day of [SA, SO])
    assert.deepEqual(
      remindersDue({ ...base, closings: [], now: at(day, 20, 30) }),
      [],
    );
  assert.deepEqual(
    remindersDue({
      ...base,
      pauses: [{ from: MI, to: MI }],
      closings: [],
      now: at(MI, 20, 30),
    }),
    [],
  );
});

test("streak warning: Monday 09:00 for a missing Friday, only if a streak actually hangs on it", () => {
  const withStreak = [closing(DO, 40, at(DO, 19))];
  assert.deepEqual(
    remindersDue({
      owner: "u1",
      closings: withStreak,
      trackingStart: MO,
      now: at(MO2, 9, 0),
    }).map((r) => r.dedupeKey),
    [`streak:u1:${FR}`],
  );
  // Keine laufende Serie: keine Warnung, nur weil ein Tag offen ist.
  assert.deepEqual(
    remindersDue({
      owner: "u1",
      closings: [],
      trackingStart: FR,
      now: at(MO2, 9, 0),
    }),
    [],
  );
  // Freitag inzwischen abgeschlossen: keine Warnung.
  assert.deepEqual(
    remindersDue({
      owner: "u1",
      closings: [...withStreak, closing(FR, 20, at(MO2, 8, 50))],
      trackingStart: MO,
      now: at(MO2, 9, 5),
    }),
    [],
  );
  // Samstag und Sonntag: keine Warnung, obwohl Freitag offen ist.
  for (const day of [SA, SO])
    assert.deepEqual(
      remindersDue({
        owner: "u1",
        closings: withStreak,
        trackingStart: MO,
        now: at(day, 9, 0),
      }),
      [],
    );
});

test("adding days crosses the year", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
