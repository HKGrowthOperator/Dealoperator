import type { ActiveCaller } from "@/lib/active-caller";
import type { Counts } from "@/lib/kpis";
import { demoWorkflows, type WorkflowData } from "./workflow-data";
export const views = [
  "heute",
  "zahlen",
  "reflexion",
  "partner",
  "sessions",
  "wissen",
  "profil",
] as const;
export type View = (typeof views)[number];
export const labels: Record<View, string> = {
  heute: "Übersicht",
  zahlen: "Meine Zahlen",
  reflexion: "Tägliche Reflexion",
  partner: "Call-Partner",
  sessions: "Sessions & Roleplay",
  wissen: "Wissen & Feedback",
  profil: "Mein Profil",
};
export function dateKey(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export function offset(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export type Profile = {
  name: string;
  role: string;
  niche: string;
  time: string;
  bio: string;
  goal: number;
  days: number[];
  listed: boolean;
  /** Freiwillig selbst angegebener Discord-Name, damit andere einen finden. */
  discordName?: string;
};
export type RecordDay = {
  date: string;
  attempts: number | null;
  conversations: number | null;
  meetings: number | null;
  counts?: Counts;
  revision?: number;
  /** null = keine Reflexion (z. B. übernommener Stand); nie erfinden. */
  energy: number | null;
  win: string;
  next: string;
  help: string;
  shared: boolean;
};
export type Member = Profile & {
  id: string;
  color?: string;
  /** Discord-Profil zum Anschreiben, nur wenn gezeigt und verknüpft. */
  discord?: string;
  latest?: RecordDay;
};
export type Session = {
  startsAt?: string;
  cancelled?: boolean;
  roster?: { id: string; name: string }[];
  mine?: boolean;
  id: string;
  title: string;
  kind: string;
  date: string;
  time: string;
  minutes: number;
  capacity: number;
  /** Früher selbst eingetragener Raum-Link; neue Sessions haben keinen mehr. */
  url?: string;
  /** Link in den Discord-Raum, sobald der Abgleich ihn angelegt hat. */
  room?: string;
  roomEvent?: string;
  /** Von Admins oder Moderatoren angelegt. */
  team?: boolean;
  host: string;
  owner: string;
  attendees: number;
  joined: boolean;
};
export type Buddy = {
  incoming?: boolean;
  peerName?: string;
  id: string;
  from: string;
  to: string;
  name: string;
  message: string;
  status: string;
};
export type AppData = WorkflowData & {
  profile: Profile;
  records: RecordDay[];
  members: Member[];
  sessions: Session[];
  bookmarks: string[];
  buddies: Buddy[];
  interest: boolean;
  /** Treffpunkt Discord: Einladung und ob Session-Räume angelegt werden. */
  discord?: { invite: string; rooms: boolean };
  /** Admin oder Moderator: darf alle Sessions bearbeiten und absagen. */
  viewerTeam?: boolean;
  /** Rang „Aktiver Caller“ (lib/active-caller.ts). */
  activeCaller?: ActiveCaller;
  /** Eigenes Profil in der Rangliste vorhanden: Name und Rolle kommen von dort. */
  ownProfile?: boolean;
};
export const emptyProfile: Profile = {
  name: "",
  role: "",
  niche: "B2B-Dienstleistungen",
  time: "Vormittags",
  bio: "",
  goal: 200,
  days: [1, 2, 3, 4, 5],
  listed: false,
  discordName: "",
};
export const demoProfile: Profile = {
  ...emptyProfile,
  name: "Alex",
  role: "Selbstständiger Vertrieb",
  bio: "Mehr gute Gespräche. Gemeinsam dranbleiben.",
  goal: 250,
};
export const demoMembers: Member[] = [
  {
    id: "demo-lena",
    name: "Lena W.",
    role: "Recruiting & Vertrieb",
    niche: "Handwerk",
    time: "Vormittags",
    bio: "Suche einen festen Call-Partner zum Üben, gern zweimal pro Woche. Tausche mich gern über Gesprächseinstiege aus.",
    goal: 250,
    days: [1, 2, 3, 4, 5],
    listed: true,
    color: "peach",
  },
  {
    id: "demo-malik",
    name: "Malik K.",
    role: "Webdesign & Akquise",
    niche: "Lokale Unternehmen",
    time: "Nachmittags",
    bio: "Gute Websites brauchen gute Gespräche. Lust auf ehrliches Feedback und einen Extra-Block zu zweit?",
    goal: 150,
    days: [1, 3, 5],
    listed: true,
    color: "blue",
  },
  {
    id: "demo-sophie",
    name: "Sophie R.",
    role: "Account Executive",
    niche: "B2B-Software",
    time: "Vormittags",
    bio: "Ich übe gern Einwandbehandlung im Roleplay. Mein Fokus: besser zuhören und passende nächste Schritte finden.",
    goal: 200,
    days: [1, 2, 4, 5],
    listed: true,
    color: "purple",
  },
  {
    id: "demo-jonas",
    name: "Jonas T.",
    role: "Prozesse & Automation",
    niche: "Mittelstand",
    time: "Abends",
    bio: "Baue meine Akquise-Routine auf und suche Austausch mit anderen Selbstständigen.",
    goal: 100,
    days: [2, 3, 4],
    listed: true,
    color: "green",
  },
];
export function demoData(): AppData {
  return {
    ...demoWorkflows(),
    profile: demoProfile,
    records: [32, 46, 38, 0, 0, 54].map((a, i) => ({
      date: offset(i - 6),
      attempts: a,
      conversations: [6, 8, 7, 0, 0, 11][i],
      meetings: null,
      counts: {
        attempts: a,
        decisionMakerConversations: [6, 8, 7, 0, 0, 11][i],
        settingsBooked: [1, 2, 1, 0, 0, 2][i],
        settingsHeld: [0, 1, 1, 0, 0, 1][i],
        closingsBooked: [0, 1, 0, 0, 0, 2][i],
        closingsHeld: [0, 0, 0, 0, 0, 1][i],
        dealsWon: [0, 0, 0, 0, 0, 1][i],
        legacyMeetings: null,
      },
      energy: [6, 7, 6, 8, 8, 8][i],
      win: a
        ? "Den Einstieg kürzer gehalten und bewusster zugehört."
        : "Geplanter freier Tag.",
      next: "Mit einem klaren Fokus in den nächsten Call-Block.",
      help: "",
      shared: false,
    })),
    members: demoMembers.map((m, i) => ({
      ...m,
      latest: {
        date: offset(-1),
        attempts: [54, 32, 41, 23][i],
        conversations: [11, 6, 9, 4][i],
        meetings: [2, 1, 2, 1][i],
        energy: 7,
        win: "",
        next: "",
        help: "",
        shared: true,
      },
    })),
    sessions: [
      {
        id: "demo-s1",
        title: "Extra-Block am Vormittag",
        kind: "Call-Block",
        date: offset(1),
        time: "09:00",
        minutes: 50,
        capacity: 12,
        url: "",
        host: "Lena W.",
        owner: "demo-lena",
        attendees: 8,
        joined: false,
      },
      {
        id: "demo-s2",
        title: "„Wir haben schon jemanden.“",
        kind: "Roleplay",
        date: offset(1),
        time: "18:00",
        minutes: 45,
        capacity: 8,
        url: "",
        host: "Sophie R.",
        owner: "demo-sophie",
        attendees: 5,
        joined: false,
      },
      {
        id: "demo-s3",
        title: "Extra-Block zum Einstieg",
        kind: "Call-Block",
        date: offset(2),
        time: "10:00",
        minutes: 50,
        capacity: 6,
        url: "",
        host: "Malik K.",
        owner: "demo-malik",
        attendees: 3,
        joined: false,
      },
      {
        id: "demo-s4",
        title: "Kurzer Wochenrückblick",
        kind: "Reflexion",
        date: offset(3),
        time: "17:30",
        minutes: 20,
        capacity: 15,
        url: "",
        host: "Jonas T.",
        owner: "demo-jonas",
        attendees: 6,
        joined: false,
      },
    ],
    bookmarks: [],
    buddies: [
      {
        id: "demo-b1",
        from: "demo-lena",
        to: "demo-self",
        name: "Lena W.",
        peerName: "Lena W.",
        message:
          "Hey Alex! Lust auf einen gemeinsamen Call-Block am Dienstagvormittag?",
        status: "pending",
        incoming: true,
      },
    ],
    interest: false,
  };
}
export const resources = [
  {
    id: "einstieg",
    category: "Gesprächsführung",
    title: "Die ersten 20 Sekunden",
    summary: "Ein klarer Einstieg, der Raum für ein echtes Gespräch lässt.",
    minutes: 3,
    icon: "phone",
    content: [
      "Sag kurz, wer du bist und weshalb du anrufst. Ein verständlicher Anlass hilft mehr als eine lange Vorstellung.",
      "Beispiel: „Hallo, hier ist Alex von [Firma]. Ich melde mich, weil wir [konkretes Thema] lösen. Ist gerade ein kurzer Moment, um zu schauen, ob das für Sie überhaupt relevant ist?“",
      "Stelle anschließend eine offene Frage zur aktuellen Situation. Höre zu, bevor du eine Lösung anbietest. Wenn es nicht passt, akzeptiere das und beende das Gespräch freundlich.",
      "Deine Übung: Schreibe einen Einstieg in zwei Sätzen. Probiere ihn im Roleplay und bitte deinen Call-Partner, dir den verstandenen Anlass in eigenen Worten zu erklären.",
    ],
  },
  {
    id: "einwaende",
    category: "Roleplay",
    title: "Hinter dem Einwand zuhören",
    summary: "Drei Fragen für mehr Verständnis und weniger Gegenargumente.",
    minutes: 4,
    icon: "message",
    content: [
      "Ein Einwand ist zunächst eine Information. Du musst ihn nicht sofort widerlegen. Wiederhole kurz, was du verstanden hast.",
      "„Was funktioniert an Ihrer aktuellen Lösung besonders gut?“ – „Gibt es einen Punkt, den Sie verbessern würden?“ – „Unter welchen Umständen wäre das Thema für Sie relevant?“",
      "Stelle nur Fragen, die zur Situation passen. Ein klares Nein bleibt ein Nein. Vereinbare nur dann einen nächsten Schritt, wenn beide Seiten einen Nutzen darin sehen.",
      "Roleplay: Eine Person beschreibt ihre echte Ausgangslage, die andere stellt zwei Verständnisfragen. Danach Feedback: Wann hast du dich verstanden gefühlt?",
    ],
  },
  {
    id: "routine",
    category: "Fokus & Mindset",
    title: "50 Minuten. Ein klarer Fokus.",
    summary: "So wird aus „Ich sollte mal callen“ ein fester Block.",
    minutes: 3,
    icon: "timer",
    content: [
      "Vorher: Lege deine Kontakte bereit, schließe Ablenkungen und entscheide dich für einen einzigen Übungsfokus.",
      "Leg kurz fest, was du dir vornimmst. Dann callst du 40 Minuten konzentriert.",
      "Danach hältst du im Tagesabschluss Zahlen und ein Learning fest: Wie viele Anwahlen und Termine waren es? Was hat funktioniert? Was änderst du beim nächsten Mal?",
      "Ein schwieriger Tag zählt auch. Trage ehrlich ein, was passiert ist, und plane den nächsten realistischen Schritt. Kontinuität entsteht aus einer passenden Routine.",
    ],
  },
];
export const partnerExamples = [
  {
    name: "Lena W.",
    title: "Recruiting × Handwerk",
    sector: "Handwerk",
    region: "NRW",
    detail:
      "Hat im fiktiven Beispiel mit einem Handwerksbetrieb an einem Recruiting-Projekt gearbeitet.",
    looking: "Austausch über Prozesse im Recruiting",
    offer: "Ein Intro kann nach persönlicher Rücksprache angefragt werden.",
    color: "peach",
  },
  {
    name: "Malik K.",
    title: "Webdesign × Beratung",
    sector: "Beratung",
    region: "DACH",
    detail:
      "Hat im fiktiven Beispiel ein Website-Projekt mit einer Unternehmensberatung umgesetzt.",
    looking: "Partner für B2B-Terminvereinbarung",
    offer:
      "Kennt die Arbeitsweise des Beispielpartners aus einem gemeinsamen Projekt.",
    color: "blue",
  },
  {
    name: "Jonas T.",
    title: "Prozesse × Mittelstand",
    sector: "Mittelstand",
    region: "DACH",
    detail:
      "Hat im fiktiven Beispiel Abläufe für einen mittelständischen Betrieb automatisiert.",
    looking: "Erfahrung mit CRM-Einführung",
    offer: "Kann fachlichen Kontext teilen, bevor ein Austausch stattfindet.",
    color: "green",
  },
];
