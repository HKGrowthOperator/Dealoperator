import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Flame as FlameGlyph, Star, Target, TrendingUp, type LucideIcon } from "lucide-react";
import type { DayStatus } from "@/lib/commitment";
import {
  GAME_TEXT,
  flameState,
  markNotice,
  streakNote,
  type FlameState,
  type GameHighlight,
  type GameHighlightKind,
  type GameNextStep,
  type GameRound,
  type GameStreak,
} from "@/lib/game";
import type { HomeGame, HomeState } from "@/server/home";
import type { SubmittedNote } from "./submitted-note";
import { Flame, GameRing, SerienZahl, Wochenbalken } from "./game-parts";
import "../game-round.css";

/*
 * Tagesrunde in der Karte „Mein Tag“ (PersonalPanel in ranking-board.tsx):
 * morgens der Auftrag (Tagesmarke, Frist mit Serie, Woche), nach dem
 * Einreichen die Bilanz in derselben Karte. Dazu das gemeinsame Wochenziel
 * für die dunkle Fläche „Gemeinsam erreicht“. Alle Werte rechnet der Server
 * (lib/game.ts über HomeState.game bzw. submitClosing), hier nur Anzeige.
 * Stile in app/game-round.css, die Bausteine aus game-parts.tsx.
 */

/** HomeState.game bringt keine Einstellungen mit; die Calling-Tage laufen in Berlin. */
const TIME_ZONE = "Europe/Berlin";
const MARK_HREF = "/so-funktionierts#tagesmarke";
/** Bezeichnung der Zeile mit dem Ring „Abschluss“. */
const CLOSING_LABEL = "Abschluss";
/** Ohne Bilanz: der bisherige Satz der Bestätigung. */
const COUNTS_NOTE = "Deine Zahlen zählen in der Rangliste und in der gemeinsamen Summe.";
/** Wie bei den vier Werten in „Gemeinsam erreicht“. */
const LOADING = "Wird geladen";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
const vars = (values: Record<`--${string}`, string | number>) => values as CSSProperties;
const share = (round: GameRound) => (round.mark > 0 ? (round.attempts ?? 0) / round.mark : 0);

// ---------------------------------------------------------------------------
// Zeilen

/** „Tagesmarke“ führt zur Erklärung; die Tippfläche wächst unsichtbar auf 44 px. */
function MarkWord() {
  return (
    <Link className="gt-mark-link" href={MARK_HREF}>
      {GAME_TEXT.mark}
    </Link>
  );
}

const MARK_RESULT = new RegExp(`^${GAME_TEXT.mark}(.*?: )(.+? Anwahlen)(.*)$`);
/**
 * Ergebnis der Tagesmarke wörtlich aus GAME_TEXT.markResult („Tagesmarke
 * geschafft: 120 von 100 Anwahlen, übernommen“), das Wort „Tagesmarke“ als
 * Link, die Zahlen fett. Darf am Handy umbrechen.
 */
function MarkSentence({ round }: { round: GameRound }) {
  const text = GAME_TEXT.markResult(round.attempts, round.mark, round.imported);
  const parts = MARK_RESULT.exec(text);
  if (!parts) return <>{text}</>;
  return (
    <>
      <MarkWord />
      {parts[1]}
      <strong className="gt-num">{parts[2]}</strong>
      {parts[3]}
    </>
  );
}

/** Eine Zeile: Symbol 20 px, Bezeichnung (14 px, darf umbrechen), rechts der Wert. */
function Line({ icon, value, children }: { icon: ReactNode; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="gm-line">
      {icon}
      <span className="gt-label">{children}</span>
      {value}
    </div>
  );
}

/**
 * „Serie 7“ rechts in der Zeile, wahlweise mit Flamme davor. Mit animate
 * wechselt die Zahl einmal von from auf value. Screenreader hören „Serie: 7 Tage“.
 */
function StreakValue({
  value,
  from = value,
  animate = false,
  flame,
}: {
  value: number;
  from?: number;
  animate?: boolean;
  flame?: ReactNode;
}) {
  const moving = animate && from !== value;
  return (
    <span className="gm-line-value gt-streak">
      {flame}
      <span aria-hidden="true">
        {moving ? (
          <>
            Serie <SerienZahl value={value} from={from} animate delay={350} />
          </>
        ) : (
          GAME_TEXT.streakShort(value)
        )}
      </span>
      <span className="do-sr">{GAME_TEXT.streakAria(value)}</span>
    </span>
  );
}

/**
 * Satz zur Serie für die Flammenzeile: Pause, Gefahr und Start wie
 * streakNote(), die nächste Etappe aber knapp, damit „Serie 7“ daneben passt.
 */
function streakLine(streak: GameStreak, todayStatus: DayStatus | null) {
  if (!streak.paused && !streak.atRisk && streak.current > 0)
    return streak.nextEtappe
      ? GAME_TEXT.nextEtappeShort(streak.nextEtappe)
      : GAME_TEXT.allEtappen(streak.best);
  return streakNote(streak, todayStatus, TIME_ZONE, new Date());
}

/** Frist für heute („Abschluss bis morgen 10:00 Uhr“), sonst der Satz zur Serie. */
function dueLine(game: HomeGame) {
  return game.deadline
    ? GAME_TEXT.closingDue(game.deadline, TIME_ZONE, new Date())
    : streakLine(game.streak, game.todayStatus);
}

/** Woche: „312 von 500 Anwahlen“ mit 6-px-Balken darunter; nur mit Wochenziel. */
function WeekLine({ week }: { week: HomeGame["week"] }) {
  if (week.goal === null) return null;
  return (
    <div className="gt-week">
      <Target className="gt-week-icon" size={20} aria-hidden="true" />
      <span className="gt-label">{GAME_TEXT.weekLabel}</span>
      <span className="gm-line-value">{GAME_TEXT.weekProgress(week.attempts, week.goal)}</span>
      <Wochenbalken size="small" value={week.attempts} goal={week.goal} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modus plan: der Auftrag für heute

export type TodayStatus = NonNullable<HomeState["today"]>["status"];
export type TodayPlan = {
  /** round: Tagesmarke, Frist mit Serie, Woche · flame: nur die Flammenzeile (freie Tage, Pausen). */
  block: "round" | "flame";
  game: HomeGame;
  status: TodayStatus;
  /** Ersetzt den Titel der Karte (Wiedereinstieg, volle Runde); null: Titel bleibt. */
  title: string | null;
  /** Satz unter dem Titel. undefined: der bisherige bleibt; null: der Block ersetzt ihn. */
  text?: string | null;
};

/**
 * Wie die Karte „Mein Tag“ die Tagesrunde zeigt. An Calling-Tagen ersetzt
 * der Block den Erklärsatz unter dem Titel; ein Wiedereinstieg oder die erste
 * Marke bringen eigenen Titel bzw. Satz mit. Freie Tage und Pausen: nur die
 * Flammenzeile. Ohne Freischaltung (keine Marke an einem Calling-Tag) und
 * ohne Tagesrunde: null, die Karte bleibt wie bisher.
 */
export function todayPlan(home: HomeState): TodayPlan | null {
  const game = home.game;
  if (!game || !home.participant || !home.today) return null;
  const status = home.today.status;
  if (game.free || game.paused)
    // Ohne Freischaltung gibt es keine Serie; dann auch keine Flammenzeile.
    return game.streak.current > 0 || game.streak.best > 0
      ? { block: "flame", game, status, title: null }
      : null;
  if (!game.mark) return null;
  if (status === "open" || status === "draft") {
    const notice = markNotice(game.mark, game.streak.current);
    return { block: "round", game, status, title: notice?.title ?? null, text: notice?.text ?? null };
  }
  return {
    block: "round",
    game,
    status,
    title: game.round?.full ? GAME_TEXT.fullRoundTitle : null,
    text: null,
  };
}

function PlanRows({ plan }: { plan: TodayPlan }) {
  const { game, status } = plan;
  const flame = <Flame state={game.streak.flame} />;
  const streak = <StreakValue value={game.streak.current} />;
  // Ohne laufende Serie zählt der offene Tag als erster: „Heute Tag 1“ statt „Serie 0“.
  const firstDay = (
    <span className="gm-line-value gt-streak">
      <span aria-hidden="true">{GAME_TEXT.streakFirstDay}</span>
      <span className="do-sr">{GAME_TEXT.streakFirstDayAria}</span>
    </span>
  );
  if (plan.block === "flame")
    return (
      <div className="gm-lines gt-round">
        <Line icon={flame} value={streak}>
          {streakLine(game.streak, game.todayStatus)}
        </Line>
      </div>
    );
  // Offen oder Entwurf: kein Fortschritt zur Marke, nur der Auftrag.
  const open = status === "open" || status === "draft";
  const round = open ? null : game.round;
  return (
    <div className="gm-lines gt-round">
      {round ? (
        <Line icon={<GameRing value={share(round)} done={round.markReached} />}>
          <MarkSentence round={round} />
        </Line>
      ) : (
        <Line
          icon={<GameRing value={0} />}
          value={<span className="gm-line-value">{GAME_TEXT.markValue(game.mark?.mark ?? 0)}</span>}
        >
          <MarkWord />
        </Line>
      )}
      {status === "done" ? (
        <Line
          icon={<GameRing value={1} />}
          value={<StreakValue value={game.streak.current} flame={flame} />}
        >
          {/* Hängt noch ein früherer Tag an seiner Frist, sagt die Zeile das. */}
          {game.streak.atRisk ? streakLine(game.streak, game.todayStatus) : CLOSING_LABEL}
        </Line>
      ) : (
        <Line icon={flame} value={open && game.deadline && game.streak.current === 0 ? firstDay : streak}>
          {open ? dueLine(game) : streakLine(game.streak, game.todayStatus)}
        </Line>
      )}
      <WeekLine week={game.week} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modus result: die Bilanz nach dem Einreichen

export type RoundResult = {
  title: string;
  /** Satz unter dem Titel; nur ohne Zeilen (sonst steht die Serienfolge unter „Abschluss“). */
  text: string | null;
  /** Ein zusammengefasster Satz für role=status. */
  announcement: string;
  rows: {
    /** Zahlenzeile; undefined: wird noch geladen (Platz bleibt frei, unsichtbar), null: keine. */
    numbers: string | null | undefined;
    /** Runde des Tages; null ohne Tagesmarke (freier Tag, Pause). */
    round: GameRound | null;
    streak: { before: number; after: number; flame: FlameState };
    /** Satz zur Serienfolge unter der Zeile „Abschluss“. */
    effect: string | null;
    highlights: GameHighlight[];
    next: GameNextStep | null;
  } | null;
  /** Abfolge abspielen: nur bei erster Einreichung mit Notiz. */
  celebrate: boolean;
  /**
   * Notiz noch nicht gelesen, oder ohne Notiz die Zahlenzeile noch nicht
   * geladen: der Block steht im Layout, aber unsichtbar. So ändert keine
   * Zeile ihre Höhe, während sie zu sehen ist.
   */
  pending: boolean;
};

/**
 * Die Bilanz für die Karte. Bei erster Einreichung mit Notiz die Abfolge aus
 * GameMoments (Ringe, Serienzahl, bis zu zwei Höhepunkte). Bei unveränderter
 * Fassung, bei Korrekturen und ohne Notiz der Endzustand aus HomeState.game,
 * ohne Höhepunkte; für einen anderen Tag als heute der Endzustand aus der
 * Notiz. Ohne beides bleibt es beim Titel und einem Satz.
 */
export function submittedRound({
  home,
  note,
  noteRead,
  noteDay,
  dayLabel,
  numbers,
}: {
  home: HomeState;
  note: SubmittedNote | null;
  noteRead: boolean;
  /** Der eingereichte Tag laut Adresse (sonst heute). */
  noteDay: string;
  dayLabel: string;
  /**
   * Zahlenzeile aus der eigenen Zeile der Rangliste, nur der Rückfall ohne
   * Zahlen in der Notiz; undefined, solange die Rangliste lädt.
   */
  numbers: string | null | undefined;
}): RoundResult {
  const day = note?.day ?? noteDay;
  const today = day === home.today?.day;
  const moments = note?.game && note.game.day === day ? note.game : null;
  const before = moments?.streak.before.current ?? 0;
  const after = moments?.streak.after.current ?? 0;
  // Erste Einreichung: etwas hat sich bewegt (Serie oder ein Höhepunkt).
  // Korrekturen und unveränderte Fassungen bringen beides nie.
  const celebrate =
    !!moments && !note?.unchanged && (moments.highlights.length > 0 || after !== before);
  const game = today ? (home.game ?? null) : null;
  const source = celebrate
    ? { round: moments!.round, current: after, flame: flameState({ current: after }, null, false) }
    : game
      ? { round: game.round, current: game.streak.current, flame: game.streak.flame }
      : moments
        ? { round: moments.round, current: after, flame: flameState({ current: after }, null, false) }
        : null;

  const title = note?.unchanged
    ? GAME_TEXT.unchangedTitle
    : source?.round?.full
      ? today
        ? GAME_TEXT.fullRoundTitle
        : `${GAME_TEXT.fullRound}. ${GAME_TEXT.otherDayInTitle(dayLabel)}`
      : today
        ? GAME_TEXT.dayInTitle
        : GAME_TEXT.otherDayInTitle(dayLabel);
  if (!source) {
    const text = note?.effect ?? COUNTS_NOTE;
    return { title, text, announcement: `${title} ${text}`, rows: null, celebrate: false, pending: !noteRead };
  }
  const highlights = celebrate ? moments!.highlights.slice(0, 2) : [];
  // Zahlenzeile: die eingereichten Werte aus der Notiz, sofort beim Lesen.
  // Ohne sie die Zeile der Rangliste; läuft die Abfolge, aber nicht (eine
  // Notiz ohne Zahlen), damit nichts nachträglich ein- oder umbricht.
  const fromNote = note?.counts ? GAME_TEXT.numbersLine(note.counts) || null : null;
  const line = fromNote ?? (note?.counts || celebrate ? null : numbers);
  return {
    title,
    text: null,
    announcement: GAME_TEXT.announcement(title, source.round, source.current, highlights),
    rows: {
      numbers: line,
      round: source.round,
      streak: { before: celebrate ? before : source.current, after: source.current, flame: source.flame },
      effect: note?.effect ?? (game ? streakLine(game.streak, game.todayStatus) : null),
      highlights,
      next: moments?.nextStep ?? null,
    },
    celebrate,
    // Ohne Abfolge darf der Block warten, bis die Zahlenzeile steht; mit
    // Abfolge ist sie nie offen (siehe line).
    pending: !noteRead || line === undefined,
  };
}

/** Symbol und Ton der Medaille je Höhepunkt; die Flamme ist nie Gold. */
const MEDAL: Record<GameHighlightKind, { Icon: LucideIcon; tone?: "green" | "gold" }> = {
  etappe: { Icon: FlameGlyph },
  "streak-best": { Icon: FlameGlyph },
  best: { Icon: Star, tone: "gold" },
  level: { Icon: TrendingUp },
  week: { Icon: Target, tone: "green" },
  place: { Icon: TrendingUp },
};

/**
 * Zeitplan der Abfolge (zusammen unter 1,3 s): 150 ms Ring der Tagesmarke,
 * 350 ms Ring „Abschluss“ mit Serienzahl und ggf. Schein um die Flamme,
 * 600 und 750 ms die Höhepunkte, 900 ms „Als Nächstes“. Alle Zeilen stehen
 * von Anfang an im Layout; bei reduzierter Bewegung sofort der Endzustand.
 */
function ResultRows({ result }: { result: RoundResult }) {
  const rows = result.rows!;
  const { celebrate } = result;
  const etappe = celebrate && rows.highlights.some((h) => h.kind === "etappe");
  return (
    <div className="gm-lines gt-round" data-pending={result.pending || undefined}>
      {rows.numbers !== null && (
        <p className="gt-numbers">{rows.numbers ?? " "}</p>
      )}
      {rows.round && (
        <Line
          icon={
            <GameRing
              value={share(rows.round)}
              done={rows.round.markReached}
              animate={celebrate}
              delay={150}
            />
          }
        >
          <MarkSentence round={rows.round} />
        </Line>
      )}
      <Line
        icon={<GameRing value={1} animate={celebrate} delay={350} />}
        value={
          <StreakValue
            value={rows.streak.after}
            from={rows.streak.before}
            animate={celebrate}
            flame={<Flame state={rows.streak.flame} celebrate={etappe} delay={350} />}
          />
        }
      >
        {CLOSING_LABEL}
      </Line>
      {rows.effect && <p className="gt-effect">{rows.effect}</p>}
      {rows.highlights.length > 0 && (
        <ul className="gm-highlights gt-highlights">
          {rows.highlights.map((h, i) => {
            const { Icon, tone } = MEDAL[h.kind];
            const delay = vars({ "--gm-delay": `${600 + 150 * i}ms` });
            return (
              <li key={h.kind} className={cx("gm-highlight", celebrate && "gm-reveal")} style={delay}>
                <span className={cx("gm-medal", celebrate && "gm-pop")} data-tone={tone} style={delay}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span>
                  <strong>{h.title}</strong>
                  {h.detail && <small>{h.detail}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {rows.next && (
        <p
          className={cx("gm-next", "gt-next", celebrate && "gm-reveal")}
          style={vars({ "--gm-delay": "900ms" })}
        >
          <span>{rows.next.text}</span>
          {rows.next.kind === "week" && (
            <Wochenbalken size="small" value={rows.next.attempts} goal={rows.next.goal} />
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Block der Tagesrunde in der Karte „Mein Tag“. plan: Auftrag für heute
 * (bzw. das Ergebnis, wenn heute schon eingereicht oder übernommen ist).
 * result: Bilanz nach dem Einreichen. Am Handy über die volle Kartenbreite,
 * ab 900 px in der mittleren Spalte.
 */
export function TodayRound(
  props: { mode: "plan"; plan: TodayPlan } | { mode: "result"; result: RoundResult },
) {
  if (props.mode === "plan") return <PlanRows plan={props.plan} />;
  return props.result.rows ? <ResultRows result={props.result} /> : null;
}

// ---------------------------------------------------------------------------
// Gemeinsames Wochenziel in der dunklen Fläche „Gemeinsam erreicht“

/** Antwort von /api/ranking/week, geprüft. */
export type CommunityWeekState = {
  weekStart: string;
  attempts: number;
  goal: number;
  reached: boolean;
  people: number;
  /** Ergebnis der Vorwoche, nur Montag bis Mittwoch. */
  lastWeek: { attempts: number; goal: number; reached: boolean } | null;
};

const amount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Prüft die öffentliche Antwort; ohne Datenbank (ready: false) oder bei Unstimmigem null. */
export function communityWeekOf(value: unknown): CommunityWeekState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const { weekStart, attempts, goal, people } = v;
  if (
    v.ready !== true ||
    typeof weekStart !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) ||
    !amount(attempts) ||
    !amount(goal) ||
    goal <= 0 ||
    !amount(people)
  )
    return null;
  const last = (v.lastWeek && typeof v.lastWeek === "object" ? v.lastWeek : null) as Record<
    string,
    unknown
  > | null;
  const lastAttempts = last?.attempts;
  const lastGoal = last?.goal;
  return {
    weekStart,
    attempts,
    goal,
    reached: attempts >= goal,
    people,
    lastWeek:
      amount(lastAttempts) && amount(lastGoal) && lastGoal > 0
        ? { attempts: lastAttempts, goal: lastGoal, reached: lastAttempts >= lastGoal }
        : null,
  };
}

/** Platzhalter beim Laden: gleiche Form wie der echte Text, unsichtbar, nur Nullen. */
const hold = (text: string) => (
  <span className="gt-hold" aria-hidden="true">
    {text.replace(/\d/g, "0")}
  </span>
);

/**
 * „Gemeinsames Wochenziel“ unter den vier Werten: Stand, Balken in Cyan (bei
 * geschafft Gold), Restsatz bzw. wer dabei ist, Montag bis Mittwoch die
 * Vorwoche. Keine Namen, keine Rangfolge. Screenreader hören einen Satz mit
 * Prozent am Balken. Ohne week (lädt noch) hält derselbe Block seinen Platz
 * wie die vier Werte („Wird geladen“), damit nichts darunter springt.
 */
export function CommunityGoal({
  week,
  lastWeek = false,
}: {
  week: CommunityWeekState | null;
  /** Nur beim Laden: steht darunter die Vorwoche (Montag bis Mittwoch)? */
  lastWeek?: boolean;
}) {
  if (!week)
    return (
      <div className="gt-community" aria-busy="true">
        <p className="gt-community-head">
          <span>{GAME_TEXT.communityTitle}</span>
          <strong>{hold(GAME_TEXT.communityProgress(1000, 1000))}</strong>
        </p>
        <Wochenbalken value={0} goal={0} tone="dark" />
        <p className="gt-community-note">{LOADING}</p>
        {lastWeek && (
          <p className="gt-community-note gt-community-last">
            {hold(GAME_TEXT.communityLastWeek(1000, 1000, false))}
          </p>
        )}
      </div>
    );
  const { attempts, goal, reached } = week;
  return (
    <div className="gt-community">
      <p className="gt-community-head" aria-hidden="true">
        <span>{GAME_TEXT.communityTitle}</span>
        <strong>{GAME_TEXT.communityProgress(attempts, goal)}</strong>
      </p>
      <Wochenbalken
        value={attempts}
        goal={goal}
        tone="dark"
        label={GAME_TEXT.communityAria(attempts, goal)}
      />
      <p className="gt-community-note">
        {reached
          ? GAME_TEXT.communityReached(attempts, goal, week.people)
          : GAME_TEXT.communityRemaining(goal - attempts)}
      </p>
      {week.lastWeek && (
        <p className="gt-community-note gt-community-last">
          {GAME_TEXT.communityLastWeek(week.lastWeek.attempts, week.lastWeek.goal, week.lastWeek.reached)}
        </p>
      )}
    </div>
  );
}
