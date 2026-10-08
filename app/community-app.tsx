"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  aggregate,
  emptyCounts,
  metricLabels,
  shortMetricLabels,
  visibleMetrics as metrics,
  type Metric,
} from "@/lib/kpis";
import CommitmentDashboard from "./features/commitment-dashboard";
import MonthStanding from "./features/month-standing";
import RankProgress from "./features/rank-progress";
import PersonalBests from "./features/personal-bests";
import { GameRing, Tagesreihe, Wochenbalken } from "./features/game-parts";
import {
  CLOSING_CHANGED,
  fetchClosingState,
  type ClosingState,
} from "./features/closing-form";
import { GAME_TEXT, type BestMetric, type WeekView } from "@/lib/game";
import AccountSettings, { AccountAccess } from "./features/account-settings";
import PushSetup, { PushPrompt } from "./features/push-setup";
import { callRoomOf } from "@/lib/call-room";
import type { CommitmentSettings } from "@/lib/commitment";
import BuddyInbox from "./features/buddy-inbox";
import ExchangeBoard from "./features/exchange-board";
import ActiveCallerCard from "./features/active-caller-card";
import {
  earliestSessionDay,
  sessionEnd,
  sessionLeadError,
} from "@/lib/session-rules";
import { ConfirmAction } from "./features/shared";
import { SessionGuests, SessionRoomLink } from "./features/session-team";
import { emptyWorkflows } from "./workflow-data";

import {
  BarChart3,
  Bookmark,
  CalendarDays,
  Check,
  CircleCheck,
  Clock3,
  Copy,
  Headphones,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  LoaderCircle,
  LogIn,
  Download,
  Info,
  X,
} from "lucide-react";
import { OperatorHeader, OperatorFooter } from "./features/operator-shell";
import AreaNav from "./features/area-nav";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Toaster, toast } from "sonner";
import {
  views,
  dateKey,
  offset,
  emptyProfile,
  demoData,
  resources,
  type View,
  type AppData,
  type Profile,
  type Member,
  type RecordDay,
  type Session,
} from "./data";
import "./game-progress.css";
const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const blankData: AppData = {
  ...emptyWorkflows,
  profile: emptyProfile,
  records: [],
  members: [],
  sessions: [],
  bookmarks: [],
  buddies: [],
  interest: false,
};
let demoMemory: AppData | null = null;
function initials(name: string) {
  return (
    name
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("") || "DU"
  );
}
/** Neutraler Wert des Call-Zeit-Filters (zugleich die Beschriftung). */
const ALL_TIMES = "Alle Call-Zeiten";
function prettyDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
  });
}
function sessionDay(date: string) {
  return date === dateKey()
    ? "Heute"
    : date === offset(1)
      ? "Morgen"
      : new Date(`${date}T12:00:00`).toLocaleDateString("de-DE", {
          weekday: "short",
          day: "numeric",
          month: "short",
        });
}
function Avatar({
  name,
  color = "",
  small = false,
}: {
  name: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${color} ${small ? "small" : ""}`}>
      {initials(name)}
    </span>
  );
}
function Tag({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
/** Der frühere Platzhalter „Noch offen“ älterer Profile ist keine Zielgruppe. */
const nicheOf = (niche: string) => (niche.trim() === "Noch offen" ? "" : niche.trim());
function FieldSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  optionLabel = (o) => o,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
  placeholder?: string;
  optionLabel?: (option: string) => string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {optionLabel(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Empty({
  icon: Icon = Users,
  title,
  text,
  children,
}: {
  icon?: any;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
/** Der Session-Typ „Reflexion“ heißt in der Oberfläche „Rückblick“ (sonst
 *  verwechselbar mit dem Bereich Reflexionen); gespeichert bleibt der Wert. */
function sessionKindLabel(kind: string) {
  return kind === "Reflexion" ? "Rückblick" : kind;
}
function MiniChart({
  records,
  days = 7,
  start,
  onSelect,
}: {
  records: RecordDay[];
  days?: number;
  /** Erster Tag (z. B. Montag dieser Woche); ohne Angabe die letzten Tage. */
  start?: string;
  onSelect?: (date: string) => void;
}) {
  const series = Array.from({ length: days }, (_, i) => {
    const date = start
      ? dateKey(new Date(Date.parse(`${start}T12:00:00Z`) + i * 86_400_000))
      : offset(i - days + 1);
    return { date, record: records.find((r) => r.date === date) };
  });
  const today = dateKey();
  const max = Math.max(60, ...series.map((x) => x.record?.attempts || 0));
  return (
    <div
      className="chart"
      role="group"
      aria-label={`Anwahlen je Tag: ${series
        .filter((x) => x.date <= today)
        .map((x) => `${prettyDate(x.date)}: ${x.record?.attempts ?? "kein Eintrag"}`)
        .join(", ")}`}
    >
      <div className="chart-scale">
        <span>{max}</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="chart-columns">
        {series.map(({ date, record }) => (
          <button
            type="button"
            className="chart-col"
            key={date}
            disabled={date > today}
            data-missing={record?.attempts == null ? "" : undefined}
            data-today={date === today ? "" : undefined}
            aria-label={`Tagesabschluss für ${prettyDate(date)} öffnen`}
            onClick={() => onSelect?.(date)}
          >
            <div className="bar-space">
              <span className="bar-value">{date > today ? "" : (record?.attempts ?? "–")}</span>
              <span
                className={`bar ${date === dateKey() ? "today" : ""}`}
                style={{
                  height: `${Math.max(2, ((record?.attempts || 0) / max) * 100)}%`,
                }}
                title={`${prettyDate(date)}: ${record?.attempts ?? "kein Eintrag"}`}
              />
            </div>
            <span className={date === dateKey() ? "today-label" : ""}>
              {dayNames[new Date(`${date}T12:00:00`).getDay()]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CommunityApp({
  initialView,
  signedIn,
  settings,
}: {
  initialView: View;
  signedIn: boolean;
  /** Regeln für Erinnerungen (nur Profil). */
  settings?: CommitmentSettings;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeQuery = searchParams.get("modus");
  const wantedCall = searchParams.get("call");
  const [cancelSession, setCancelSession] = useState<Session | null>(null);
  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const [knowledgeTab, setKnowledgeTab] = useState("Austausch");
  const [shareText, setShareText] = useState("");
  const [mode, setMode] = useState<"demo" | "own">("demo");
  const demo = mode === "demo";
  const [data, setData] = useState<AppData>(() => demoMemory || demoData());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [sessionSnapshot, setSession] = useState<Session | null>(null);
  const session =
    data.sessions.find((s) => s.id === sessionSnapshot?.id) || sessionSnapshot;
  const [resource, setResource] = useState<(typeof resources)[number] | null>(
    null,
  );
  const [profile, setProfile] = useState<Profile>(demoData().profile);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(ALL_TIMES);
  const [sessionFilter, setSessionFilter] = useState("Alle");
  const [message, setMessage] = useState(
    "Hey, hast du Lust, zusammen zu üben oder einen Extra-Block zu machen? Passt dir diese Woche ein Termin?",
  );
  const [newSession, setNewSession] = useState({
    title: "",
    kind: "Call-Block",
    date: earliestSessionDay(),
    time: "18:00",
    minutes: 50,
    capacity: 2,
  });
  const href = (v: View) => `/${v}?modus=${demo ? "demo" : "eigen"}`;
  const refresh = useCallback(
    async (quiet = false, background = false, signal?: AbortSignal) => {
      if (!quiet) setLoading(true);
      if (!background) setError("");
      try {
        const response = await fetch("/api/community", {
          cache: "no-store",
          signal,
        });
        const result: any = await response.json();
        if (!response.ok) throw Error(result.error);
        result.sessions = result.sessions.map((s: Session) => {
          if (!s.startsAt) return s;
          const t = new Date(s.startsAt);
          return {
            ...s,
            date: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`,
            time: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`,
          };
        });
        if (signal?.aborted) return;
        setData(result);
        if (!background) {
          setProfile(result.profile);
        }
      } catch (e) {
        if (signal?.aborted || background) return;
        if (quiet)
          toast.error(
            "Gespeichert, aber die Ansicht konnte nicht aktualisiert werden. Bitte neu laden.",
          );
        else setError((e as Error).message);
      } finally {
        if (!background) setLoading(false);
      }
    },
    [],
  );
  useEffect(() => {
    const own = modeQuery === "eigen";
    if (own) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL mode changes intentionally clear data from the previous account context.
      setMode("own");
      setData(blankData);
      setProfile(emptyProfile);
      if (signedIn) void refresh();
    } else {
      // Keine fiktiven Daten mehr: ohne ?modus=eigen bleibt der Bereich leer,
      // die Routenwache führt ohnehin zur Anmeldung.
      setMode("own");
      setData(blankData);
      setProfile(emptyProfile);
    }
  }, [signedIn, refresh, modeQuery]);
  useEffect(() => {
    if (demo) demoMemory = data;
  }, [data, demo]);
  useEffect(() => {
    if (demo || !signedIn || saving) return;
    const controller = new AbortController();
    let pending = false;
    const sync = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        await refresh(true, true, controller.signal);
      } finally {
        pending = false;
      }
    };
    const interval = window.setInterval(sync, 20000);
    window.addEventListener("focus", sync);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", sync);
    };
  }, [demo, signedIn, saving, refresh]);
  const openedCall = useRef<string | null>(null);
  useEffect(() => {
    if (!wantedCall || loading || openedCall.current === wantedCall) return;
    const found = data.sessions.find((s) => s.id === wantedCall);
    if (!found) return;
    const timer = window.setTimeout(() => { openedCall.current = wantedCall; setSession(found); }, 0);
    return () => window.clearTimeout(timer);
  }, [wantedCall, loading, data.sessions]);
  // Tagesrunde (lib/game.ts) für Fortschritt und Tage: Woche, Tagesmarke,
  // Bestwerte und je Tag volle Runde. Sie kommt mit dem Stand des
  // Tagesabschlusses, den die Serie darunter ohnehin braucht, und wird nach
  // dem Einreichen und beim Zurückkehren aufgefrischt. Scheitert sie, bleibt
  // „Diese Woche“ beim bisherigen Stand aus den eigenen Tagen.
  const wantsGame =
    !demo && signedIn && (initialView === "heute" || initialView === "zahlen");
  const [closing, setClosing] = useState<ClosingState | null>(null);
  const [closingSettled, setClosingSettled] = useState(false);
  useEffect(() => {
    if (!wantsGame) return;
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const fresh = await fetchClosingState(undefined, controller.signal);
        if (!controller.signal.aborted) setClosing(fresh);
      } catch {
        // Ohne Tagesrunde gilt der bisherige Stand.
      } finally {
        pending = false;
        if (!controller.signal.aborted) setClosingSettled(true);
      }
    };
    void load();
    window.addEventListener(CLOSING_CHANGED, load);
    window.addEventListener("focus", load);
    return () => {
      controller.abort();
      window.removeEventListener(CLOSING_CHANGED, load);
      window.removeEventListener("focus", load);
    };
  }, [wantsGame]);
  const game = closing?.game ?? null;
  // Vorschlag zum Wochenziel: je Woche ausblendbar, gemerkt nur in diesem
  // Browser. Ohne Speicher erscheint er beim nächsten Laden wieder.
  const [hiddenHint, setHiddenHint] = useState<string | null>(null);
  const hintKey = (weekFrom: string) => `do-wochenziel-hinweis-${weekFrom}`;
  function hintHidden(weekFrom: string) {
    if (hiddenHint === weekFrom) return true;
    try {
      return localStorage.getItem(hintKey(weekFrom)) === "1";
    } catch {
      return false;
    }
  }
  function hideHint(weekFrom: string) {
    setHiddenHint(weekFrom);
    try {
      localStorage.setItem(hintKey(weekFrom), "1");
    } catch {
      // Ohne Speicher bleibt der Hinweis nur für diesen Besuch weg.
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Navigation closes drafts belonging to the previous section.
    setSearch("");
    setFilter(ALL_TIMES);
    setMember(null);
    setSession(null);
    setModal(null);
  }, [initialView]);
  useEffect(() => {
    const ctx = (document as any).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: "read_caller_overview",
        description:
          "Read the visible caller dashboard summary, including whether example data is displayed.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                mode,
                section: initialView,
                records: data.records,
                weeklyGoal: data.profile.goal,
              }),
            },
          ],
        }),
      },
      {
        name: "open_caller_section",
        description:
          "Open a section of the caller workspace. Does not save or submit data.",
        inputSchema: {
          type: "object",
          properties: { section: { type: "string", enum: views } },
          required: ["section"],
          additionalProperties: false,
        },
        execute: async (input: { section: string }) => {
          if (
            !input ||
            typeof input !== "object" ||
            Object.keys(input).some((k) => k !== "section") ||
            !views.includes(input.section as View)
          )
            throw Error("Invalid section");
          router.push(
            `/${input.section}?modus=${mode === "demo" ? "demo" : "eigen"}`,
          );
          return {
            content: [{ type: "text", text: `Opened ${input.section}` }],
          };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          ctx.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() =>
          console.warn("Caller tools are unavailable in this browser."),
        );
      } catch {
        console.warn("Caller tools are unavailable in this browser.");
      }
    }
    return () => lifecycle.abort();
  }, [data, mode, initialView, router]);
  async function mutate(
    action: string,
    value: any,
    demoUpdate?: (d: AppData) => AppData,
  ) {
    setSaving(true);
    try {
      if (demo) {
        if (!demoUpdate) {
          toast.error(
            "Für diese Aktion ist noch kein Vorschauablauf vorhanden.",
          );
          return false;
        }
        setData(demoUpdate);
        return true;
      }
      if (!signedIn) {
        toast.error("Melde dich an, um deine Daten zu speichern.");
        return false;
      }
      const response = await fetch("/api/community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, value }),
      });
      const result: any = await response.json();
      if (!response.ok) throw Error(result.error);
      await refresh(true);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  function own() {
    if (!signedIn) {
      router.push("/starten");
      return;
    }
    router.push("/heute?modus=eigen");
    setMode("own");
    setData(blankData);
    void refresh();
  }
  const sessionsOpen = true;
  function openNewSession() {
    if (!data.profile.name) {
      toast.info(
        "Ergänze zuerst deinen Anzeigenamen, damit die anderen sehen, wer die Session anbietet.",
      );
      setProfile(data.profile);
      setModal("profile");
      return;
    }
    setEditSessionId(null);
    setNewSession({
      title: "",
      kind: "Call-Block",
      date: earliestSessionDay(),
      time: "18:00",
      minutes: 50,
      capacity: 2,
    });
    setModal("create-session");
  }
  // Zahlen und Reflexion laufen über den Tagesabschluss (/api/closing).
  function openClosing(date?: string) {
    // Ohne ?tag zeigt Mein Tag die Übersicht; das Formular braucht den Tag.
    router.push(`/tagesabschluss?tag=${date ?? dateKey()}`);
  }
  /** Call-Partner-Angaben mit Name und Rolle aus dem eigenen Profil. */
  async function saveCallProfile(identity: { name: string; role: string }) {
    if (profile.days.length === 0) {
      toast.error("Wähle mindestens einen Call-Tag.");
      return false;
    }
    const next = { ...profile, ...identity };
    const ok = await mutate("profile", next, (d) => ({ ...d, profile: next }));
    if (ok) setProfile(next);
    return ok;
  }
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (profile.days.length === 0) {
      toast.error("Wähle mindestens einen Call-Tag.");
      return;
    }
    const ok = await mutate("profile", profile, (d) => ({ ...d, profile }));
    if (ok) {
      setModal(null);
      toast.success(
        demo ? "Beispielprofil aktualisiert." : "Dein Profil ist gespeichert.",
      );
    }
  }
  function exportNumbers() {
    const rows = [
      ["Datum", ...metrics.map((k) => metricLabels[k]), "Energie"],
      ...[...data.records]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => {
          const c = r.counts || {
            ...emptyCounts(),
            attempts: r.attempts,
            legacyMeetings: r.meetings,
          };
          return [
            r.date,
            ...metrics.map((k) => (c[k] === null ? "" : String(c[k]))),
            r.energy == null ? "" : String(r.energy),
          ];
        }),
    ];
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + rows.map((r) => r.join(";")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "deal-operator-zahlen.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Deine Zahlen wurden als CSV exportiert.");
  }
  const weekStart = new Date(`${dateKey()}T12:00:00Z`);
  weekStart.setUTCDate(
    weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7),
  );
  // Ende der Kalenderwoche (Sonntag) für die Kopfzeile „Diese Woche“.
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekRecords = data.records.filter(
    (r) => r.date >= dateKey(weekStart) && r.date <= dateKey(),
  );
  const totals = aggregate(
    weekRecords.map(
      (r) =>
        r.counts || {
          ...emptyCounts(),
          attempts: r.attempts,
          legacyMeetings: r.meetings,
        },
    ),
  );
  const metricTotal = (k: Metric) => (totals[k] === null ? "–" : totals[k]!);
  // Mit der Tagesrunde zeigen die Kacheln „Diese Woche“ dieselben Summen wie
  // der Wochenziel-Balken (Stand bis zur Frist), ohne sie wie bisher die Tage.
  const week: WeekView | null = game?.week ?? null;
  const gameDays = new Map(game?.days.map((d) => [d.day, d]) ?? []);
  const weekTotal = (k: keyof WeekView["totals"]) => {
    const value = week ? week.totals[k] : totals[k];
    return value === null ? "–" : value.toLocaleString("de-DE");
  };
  function downloadCalendar(s: Session) {
    const start = new Date(s.startsAt || `${s.date}T${s.time}`);
    const end = new Date(start.getTime() + s.minutes * 60000);
    const fmt = (d: Date) =>
      d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const esc = (v: string) =>
      v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, "\\$&");
    // Roleplay läuft immer im festen Raum, auch im Kalendereintrag.
    const link = callRoomOf(s.room, s.url);
    const value = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Deal Operator//Sessions//DE\r\nBEGIN:VEVENT\r\nUID:${s.id}@aktivecaller\r\nDTSTAMP:${fmt(new Date())}\r\nDTSTART:${fmt(start)}\r\nDTEND:${fmt(end)}\r\nSUMMARY:${esc((demo ? "[DEMO] " : "") + s.title)}\r\nDESCRIPTION:${esc(demo ? "Fiktiver Beispieltermin. Keine echte Session." : s.kind + " mit " + s.host)}\r\n${link ? "URL:" + link + "\r\n" : ""}END:VEVENT\r\nEND:VCALENDAR`;
    const url = URL.createObjectURL(
      new Blob([value], { type: "text/calendar" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "deal-operator-session.ics";
    a.click();
    URL.revokeObjectURL(url);
  }
  function matchesSession(s: Session) {
    const upcoming = new Date(s.startsAt || `${s.date}T${s.time}`) > new Date();
    if (sessionFilter === "Vergangene") return !upcoming || !!s.cancelled;
    if (s.cancelled || !upcoming) return false;
    return (
      sessionFilter === "Alle" ||
      (sessionFilter === "Meine Calls"
        ? s.joined || s.mine || s.owner === data.viewerId
        : s.kind === sessionFilter)
    );
  }
  /** Wochenziel und Call-Tage: sie treiben „Diese Woche“ unter Fortschritt. */
  function planFields() {
    return (
      <>
        <label>
          Wochenziel (Anwahlen pro Woche)
          <input
            type="number"
            min={1}
            max={5000}
            required
            value={profile.goal}
            onChange={(e) =>
              setProfile({ ...profile, goal: Number(e.target.value) })
            }
          />
          <small>
            {profile.days.length
              ? `Richtwert: ${Math.ceil(profile.goal / profile.days.length)} Anwahlen je Call-Tag.`
              : "Wähle unten deine Call-Tage."}
          </small>
        </label>
        <fieldset>
          <legend>Deine Call-Tage</legend>
          <div className="day-checks">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <label
                key={day}
                className={profile.days.includes(day) ? "selected" : ""}
              >
                <Checkbox
                  checked={profile.days.includes(day)}
                  onCheckedChange={(checked) =>
                    setProfile({
                      ...profile,
                      days: checked
                        ? [...profile.days, day]
                        : profile.days.filter((d) => d !== day),
                    })
                  }
                />
                {dayNames[day]}
              </label>
            ))}
          </div>
        </fieldset>
      </>
    );
  }
  /** Angaben nur für Call-Partner; Name und Rolle stehen im Profil. */
  function callFields() {
    return (
      <>
        <div className="form-grid">
          <label>
            Dein Markt / deine Zielgruppe
            <input
              required={profile.listed}
              maxLength={80}
              placeholder="zum Beispiel B2B-Dienstleistungen"
              value={profile.niche}
              onChange={(e) =>
                setProfile({ ...profile, niche: e.target.value })
              }
            />
          </label>
          <label>
            Wann callst du?
            <FieldSelect
              label="Call-Zeit"
              value={profile.time}
              onChange={(v) => setProfile({ ...profile, time: v })}
              options={["Vormittags", "Nachmittags", "Abends", "Flexibel"]}
            />
          </label>
        </div>
        <label>
          Das suchst du beim gemeinsamen Callen
          <textarea
            maxLength={500}
            rows={3}
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="Zum Beispiel: einen festen Call-Partner für Dienstag und Donnerstag …"
          />
        </label>
        <label className="checkbox-row">
          <Checkbox
            checked={profile.listed}
            onCheckedChange={(v) => setProfile({ ...profile, listed: !!v })}
          />
          <span>
            Mein Profil bei den Call-Partnern anzeigen
            <small>
              Andere Angemeldete sehen dann dein Call-Profil, ohne E-Mail und
              Nummer. Das Team sieht es immer.
            </small>
          </span>
        </label>
        {data.profile.listed && profile.listed && (
          <p className="ca-visible">
            <CircleCheck size={18} aria-hidden="true" />
            <span>
              Du bist bei den Call-Partnern sichtbar.{" "}
              <Link href="/partner?modus=eigen">So sehen dich andere</Link>
            </span>
          </p>
        )}
      </>
    );
  }
  /** Eigenständiges Call-Profil (Dialog bei Call-Partner, Konten ohne Profil). */
  function profileForm() {
    return (
      <form onSubmit={saveProfile} className="form-stack">
        {data.ownProfile ? (
          <p className="hint">
            Du erscheinst als <strong>{profile.name}</strong>
            {profile.role ? ` · ${profile.role}` : ""}. Name und Rolle änderst du
            unter <Link href="/profil?modus=eigen">Profil</Link>.
          </p>
        ) : (
          <div className="form-grid">
            <label>
              Dein Anzeigename
              <input
                required
                minLength={2}
                maxLength={60}
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              />
            </label>
            <label>
              Deine Rolle
              <input
                maxLength={80}
                value={profile.role}
                onChange={(e) => setProfile({ ...profile, role: e.target.value })}
              />
            </label>
          </div>
        )}
        {planFields()}
        {callFields()}
        <button className="btn primary" disabled={saving}>
          <Check size={18} />
          {saving ? "Wird gespeichert …" : "Speichern"}
        </button>
      </form>
    );
  }
  function memberBadges(m: Member) {
    if (!m.levels?.length && !m.packageName) return null;
    return <div className="call-profile-badges" aria-label="Profilstatus">
      {m.levels?.filter((l) => l.level > 0).map((l) => <span key={l.label}>{l.label} · Level {l.level}</span>)}
      {m.packageName && <span>{m.packageName}</span>}
    </div>;
  }
  /** Kommende Sessions, bei denen eine Person zugesagt hat. */
  function sessionsOf(ownerId: string) {
    const now = new Date();
    return data.sessions
      .filter((s) => !s.cancelled && sessionEnd(s) > now && s.roster?.some((p) => p.id === ownerId))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .slice(0, 3);
  }
  function memberSessions(ownerId: string) {
    const list = sessionsOf(ownerId);
    if (!list.length) return null;
    return (
      <div className="member-sessions">
        <span>Dabei bei</span>
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            className="member-session"
            onClick={() => {
              setMember(null);
              setSession(s);
            }}
          >
            <CalendarDays size={15} aria-hidden="true" />
            {sessionDay(s.date)}, {s.time} Uhr · {sessionKindLabel(s.kind)}
          </button>
        ))}
      </div>
    );
  }
  function memberCard(m: Member, own = false) {
    return (
      <article className="card member-card" key={m.id} data-own={own || undefined}>
        <div className="member-top">
          <Avatar name={m.name} color={m.color} />
          {own ? (
            <Tag tone="green">Das bist du</Tag>
          ) : m.listed ? (
            <Tag tone="green">Sucht Call-Partner</Tag>
          ) : (
            <Tag>Nicht gezeigt · nur fürs Team</Tag>
          )}
        </div>
        <h2>{m.name}</h2>
        <span className="member-role">{m.role}</span>
        {m.bio && (
          <p>
            <span className="member-label">Sucht</span> {m.bio}
          </p>
        )}
        {m.latest && (
          <div className="member-stats">
            <span>
              <strong>{m.latest.attempts}</strong>Anwahlen
            </span>
            <span>
              <strong>{m.latest.meetings}</strong>Termine
            </span>
            <small>Freiwillig geteilt · {prettyDate(m.latest.date)}</small>
          </div>
        )}
        <p className="member-when">
          <Clock3 size={15} aria-hidden="true" />
          <span>
            {m.days.length
              ? m.days
                  .slice()
                  .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
                  .map((d) => dayNames[d])
                  .join(", ")
              : "Tage offen"}
            {m.time ? ` · ${m.time}` : ""}
          </span>
        </p>
        {nicheOf(m.niche) && (
          <div className="member-tags">
            <Tag>{m.niche}</Tag>
          </div>
        )}
        {memberSessions(own ? data.viewerId : m.id)}
        {memberBadges(m)}
        <div className="member-actions">
          {own ? (
            <button
              className="btn secondary full"
              onClick={() => {
                setProfile(data.profile);
                setModal("profile");
              }}
            >
              <UserRound size={17} aria-hidden="true" />
              Bearbeiten
            </button>
          ) : (
            <>
              <button className="btn secondary full" onClick={() => setMember(m)}>
                Profil ansehen
              </button>
            </>
          )}
        </div>
      </article>
    );
  }
  /**
   * „Diese Woche“ unter Fortschritt: Kacheln, Wochenziel-Balken, Tagesmarke
   * und Tagesreihe aus der Tagesrunde. Ohne sie (kein Profil, Fehler) wie
   * bisher nur Kacheln und Säulen aus den eigenen Tagen.
   */
  function weekSection() {
    const goal = week ? week.goal : data.profile.goal || null;
    const attempts = week?.totals.attempts ?? 0;
    // Eine ganz pausierte Woche ist nur ein Satz; gemeldete Zahlen bleiben sichtbar.
    const paused = !!week?.paused;
    const reported = !paused || Object.values(week!.totals).some((v) => v !== null);
    const round = game?.round ?? null;
    const suggestion =
      week?.suggestion && goal && !paused && !hintHidden(week.from) ? week.suggestion : null;
    return (
      <section className="ca-section" aria-labelledby="ca-week">
        <div className="ca-section-head">
          <h2 id="ca-week">Diese Woche</h2>
          <span>
            {prettyDate(week?.from ?? dateKey(weekStart))} bis{" "}
            {prettyDate(week?.to ?? dateKey(weekEnd))}
          </span>
        </div>
        {paused && <p className="gp-week-paused">{GAME_TEXT.weekPaused}</p>}
        {reported && (
          <dl className="ca-week-stats">
            <div>
              <dt>Anwahlen</dt>
              <dd>{weekTotal("attempts")}</dd>
              {week && goal && !paused ? (
                <>
                  <Wochenbalken className="gp-week-bar" value={attempts} goal={goal} />
                  <small>von {goal.toLocaleString("de-DE")}</small>
                </>
              ) : (
                <small>
                  {goal ? `Wochenziel ${goal.toLocaleString("de-DE")}` : GAME_TEXT.noGoal}
                </small>
              )}
            </div>
            <div>
              <dt>Settings</dt>
              <dd>{weekTotal("settingsBooked")}</dd>
              <small>vereinbart</small>
            </div>
            <div>
              <dt>Closings</dt>
              <dd>{weekTotal("closingsBooked")}</dd>
              <small>vereinbart</small>
            </div>
          </dl>
        )}
        {week && !paused && (
          <div className="gp-week-game">
            {goal !== null &&
              (week.reached ? (
                <p className="gp-goal" data-reached="">
                  <CircleCheck size={18} aria-hidden="true" />
                  {GAME_TEXT.weekReached(attempts, goal)}
                </p>
              ) : (
                <p className="gp-goal">{GAME_TEXT.weekRemaining(week.remaining ?? goal)}</p>
              ))}
            {game?.mark && (
              <div className="gp-mark">
                <p className="gp-mark-line">
                  {/* Ohne eingereichten Tag bleibt der Ring offen: ein Entwurf zählt nicht. */}
                  <GameRing
                    value={round?.attempts != null ? round.attempts / round.mark : 0}
                    done={round?.markReached}
                  />
                  <span>{GAME_TEXT.markToday(game.mark.mark)}</span>
                </p>
                <details className="cm-rules-note gp-mark-how">
                  <summary>{GAME_TEXT.markHowTitle}</summary>
                  <p>{GAME_TEXT.markHowText}</p>
                </details>
              </div>
            )}
            {week.days.length > 0 && (
              <Tagesreihe
                className="gp-tagesreihe"
                label="Calling-Tage dieser Woche"
                days={week.days.map((d) => ({
                  ...d,
                  // Wie die Säulen: ein Tippen öffnet den Tag, künftige Tage nicht.
                  href: d.day <= (game?.today ?? dateKey()) ? `/tagesabschluss?tag=${d.day}` : undefined,
                }))}
                note={GAME_TEXT.fullRounds(week.fullRounds)}
              />
            )}
          </div>
        )}
        {!paused && (
          <div className="ca-chart">
            <p className="ca-chart-title">Anwahlen je Tag</p>
            <MiniChart
              start={week?.from ?? dateKey(weekStart)}
              onSelect={(date) => openClosing(date)}
              records={data.records}
            />
          </div>
        )}
        {suggestion && goal !== null && (
          <div className="gp-hint">
            <p>{GAME_TEXT.suggestion(goal, suggestion.value)}</p>
            <button
              type="button"
              className="gp-hint-close"
              aria-label="Hinweis ausblenden"
              onClick={() => hideHint(week!.from)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="ca-section-actions">
          <Link className="do-button do-button-secondary" href={`${href("profil")}#wochenziel`}>
            {goal ? GAME_TEXT.adjustGoal : GAME_TEXT.setGoal}
          </Link>
          <Link className="do-link" href={href("zahlen")}>
            Alle Tage ansehen
          </Link>
        </div>
      </section>
    );
  }
  const exchangeView = ["sessions", "wissen"].includes(initialView);
  return (
    <div className="operator-site">
      <OperatorHeader />
      <main id="inhalt" className="do-page ca-main">
        {/* Call-Partner ist ein eigener Reiter ohne Unterbereiche. */}
        <AreaNav area={exchangeView || initialView === "partner" ? "partner" : "mine"} />
          {!demo && !signedIn ? (
            <Empty
              icon={LogIn}
              title="Dein Fortschritt beginnt hier."
              text="Melde dich an und starte mit deinen eigenen Zahlen."
            >
              <button className="btn primary" onClick={own}>
                Anmelden
              </button>
            </Empty>
          ) : loading || (wantsGame && !closingSettled) ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Dein Bereich wird geladen …
            </div>
          ) : error ? (
            <Empty icon={Info} title="Gerade nicht erreichbar" text={error}>
              <button className="btn primary" onClick={() => void refresh()}>
                Erneut laden
              </button>
            </Empty>
          ) : (
            <>
              {initialView === "heute" && (
                <>
                  <PageHeading
                    title="Mein Fortschritt"
                  />
                  {weekSection()}
                  {game && <PersonalBests bests={game.bests} today={game.today} />}
                  {/* Derselbe Stand wie oben; ohne ihn (Fehler) lädt die Serie selbst. */}
                  <CommitmentDashboard initial={closing} />
                  {!demo && <MonthStanding />}
                  {!demo && (
                    <ActiveCallerCard
                      compact
                      state={data.activeCaller}
                      team={data.viewerTeam}
                    />
                  )}
                  <RankProgress records={data.records} />
                </>
              )}

              {initialView === "zahlen" && (
                <>
                  <PageHeading
                    title="Meine Tage"
                  >
                    {data.records.length > 0 && (
                      <div className="button-row">
                        <button
                          className="do-button do-button-secondary"
                          onClick={exportNumbers}
                        >
                          <Download size={17} aria-hidden="true" />
                          Als CSV herunterladen
                        </button>
                      </div>
                    )}
                  </PageHeading>
                  <section className="card">
                    {data.records.length > 0 && (
                      <div className="card-heading padded">
                        <div>
                          <h2>Deine Tage</h2>
                        </div>
                        <Tag>{data.records.length} {data.records.length === 1 ? "Eintrag" : "Einträge"}</Tag>
                      </div>
                    )}
                    {data.records.length ? (
                      <ul className="checkin-cards">
                        {[...data.records]
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .map((r) => {
                            const c = r.counts || {
                              ...emptyCounts(),
                              attempts: r.attempts,
                              legacyMeetings: r.meetings,
                            };
                            const notes = [r.win, r.next, r.help].filter(
                              Boolean,
                            );
                            // Tagesrunde dieses Tages: volle Runde, gehaltene
                            // Bestwerte (erst ab der Karte „Deine Bestwerte“)
                            // und was nach der Frist erhöht wurde. Nur privat.
                            const gameDay = gameDays.get(r.date);
                            const best = (k: string) =>
                              !!game?.bests.show &&
                              !!gameDay?.bestMetrics.includes(k as BestMetric);
                            return (
                              <li className="checkin-card" key={r.date}>
                                <div className="checkin-card-top">
                                  <div>
                                    <strong>{prettyDate(r.date)}</strong>
                                    {r.date === dateKey() && (
                                      <Tag tone="green">Heute</Tag>
                                    )}
                                    {gameDay?.fullRound && (
                                      <span className="gm-pill" data-tone="full">
                                        {GAME_TEXT.fullRound}
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    className="btn secondary"
                                    onClick={() => openClosing(r.date)}
                                  >
                                    Unter Mein Tag öffnen
                                  </button>
                                </div>
                                <dl className="checkin-card-kpis">
                                  {metrics.map((k) => (
                                    <div key={k}>
                                      <dt>{shortMetricLabels[k]}</dt>
                                      <dd className={best(k) ? "gp-kpi-best" : undefined}>
                                        {c[k] ?? "–"}
                                        {best(k) && (
                                          <span className="gm-pill" data-tone="best">
                                            {GAME_TEXT.bestPill}
                                          </span>
                                        )}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                                {!!gameDay?.differs.length && (
                                  <p className="gp-differs">
                                    {gameDay.differs
                                      .map((d) => GAME_TEXT.differs(d.metric, d.counted))
                                      .join(" ")}
                                  </p>
                                )}
                                <details className="checkin-card-more">
                                  <summary>
                                    {r.energy != null
                                      ? `Energie ${r.energy}/10`
                                      : "Übernommener Stand, ohne Reflexion"}
                                    {notes.length
                                      ? ` · ${notes.length} ${notes.length === 1 ? "Notiz" : "Notizen"}`
                                      : ""}
                                  </summary>
                                  <div>
                                    {r.energy != null && (
                                      <Progress value={r.energy * 10} />
                                    )}
                                    {notes.length ? (
                                      <>
                                        {r.win && (
                                          <p>
                                            <span>Lief gut</span>
                                            {r.win}
                                          </p>
                                        )}
                                        {r.next && (
                                          <p>
                                            <span>Nächster Schritt</span>
                                            {r.next}
                                          </p>
                                        )}
                                        {r.help && (
                                          <p>
                                            <span>Unterstützung</span>
                                            {r.help}
                                          </p>
                                        )}
                                      </>
                                    ) : (
                                      <p className="hint">
                                        Für diesen Tag ist keine Reflexion
                                        hinterlegt.
                                      </p>
                                    )}
                                  </div>
                                </details>
                              </li>
                            );
                          })}
                      </ul>
                    ) : (
                      <Empty
                        icon={BarChart3}
                        title="Jede Routine hat einen ersten Tag."
                        text="Trag deinen ersten Tag ein, dann siehst du hier deine Entwicklung."
                      >
                        <Link className="btn primary" href="/tagesabschluss">
                          Zahlen für heute eintragen
                        </Link>
                      </Empty>
                    )}
                  </section>
                </>
              )}

              {initialView === "partner" && (
                <>
                  <PageHeading
                    title="Call-Partner"
                    text="Wer wann zum Üben, für Feedback oder einen zusätzlichen Block callt."
                  >
                    {/* Solange das Profil nicht gezeigt wird, führt die Karte
                        darunter dorthin; kein zweiter Knopf. */}
                    {data.profile.listed && (
                      <button
                        className="btn secondary"
                        onClick={() => {
                          setProfile(data.profile);
                          setModal("profile");
                        }}
                      >
                        <UserRound size={17} aria-hidden="true" />
                        Mein Call-Profil
                      </button>
                    )}
                  </PageHeading>
                  <section className="call-partner-hub" aria-label="Gemeinsame Calls">
                    <div><span className="call-hub-kicker">Gemeinsam besser werden</span><h2>Einwände üben. Zusammen callen.</h2><p>Such dir einen Partner oder verabrede einen offenen Call. Der Treffpunkt ist Google Meet.</p></div>
                    <div className="call-hub-actions">
                      {data.callUrl && <a className="btn primary" href={data.callUrl} target="_blank" rel="noopener noreferrer"><Headphones size={18} />Zum Call<span className="do-sr"> (neues Fenster)</span></a>}
                      <Link className="btn secondary" href="/sessions?modus=eigen"><CalendarDays size={18} />Calls und Roleplays</Link>
                      <button className="btn secondary" onClick={openNewSession}><Plus size={18} />Call verabreden</button>
                    </div>
                    {data.sessions.filter((s) => !s.cancelled && sessionEnd(s) > new Date()).slice().sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time)).slice(0,3).map((s) => <button className="call-hub-upcoming" key={s.id} onClick={() => setSession(s)}><span><strong>{s.title}</strong><small>{sessionDay(s.date)} · {s.time} Uhr · mit {s.host}</small></span><span>{s.joined ? "Du bist dabei" : "Ansehen"}</span></button>)}
                  </section>
                  {data.viewerTeam && (
                    <p className="ca-team-note">
                      Als {data.viewerRole === "admin" ? "Admin" : "Moderator"} siehst
                      du alle Call-Profile. Profile mit „Nicht gezeigt“ sehen nur
                      Admins und Moderatoren.
                    </p>
                  )}
                  {data.profile.listed ? (
                    <p className="ca-visible">
                      <CircleCheck size={18} aria-hidden="true" />
                      <span>
                        Du bist als Call-Partner sichtbar, deine Karte steht
                        unten als erste.{" "}
                        Andere können dich direkt hier anfragen.
                      </span>
                    </p>
                  ) : (
                    <section className="ca-listing" aria-labelledby="ca-listing-title">
                      <div>
                        <h2 id="ca-listing-title">Zeig dich als Call-Partner</h2>
                        <p>
                          Zeig, wann du callst und was du suchst, dann finden dich die anderen hier.
                          E-Mail und Nummer bleiben privat.
                        </p>
                      </div>
                      <button
                        className="btn primary"
                        onClick={() => {
                          setProfile({ ...data.profile, listed: true });
                          setModal("profile");
                        }}
                      >
                        <UserRound size={17} aria-hidden="true" />
                        Call-Profil zeigen
                      </button>
                    </section>
                  )}
                  {data.members.length > 0 && (
                    <div className="filter-row">
                      <label className="search-input">
                        <Search size={18} aria-hidden="true" />
                        <input
                          type="search"
                          aria-label="Call-Partner durchsuchen"
                          placeholder="Name, Zielgruppe oder Thema suchen …"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <FieldSelect
                        label="Call-Zeit filtern"
                        value={filter}
                        onChange={setFilter}
                        options={[
                          ALL_TIMES,
                          "Vormittags",
                          "Nachmittags",
                          "Abends",
                          "Flexibel",
                        ]}
                      />
                    </div>
                  )}
                  <div className="member-grid">
                    {data.profile.listed &&
                      memberCard({ id: "self", ...data.profile, levels: data.ownLevels, packageName: data.ownPackageName }, true)}
                    {data.members
                      .filter(
                        (m) =>
                          (filter === ALL_TIMES || m.time === filter) &&
                          `${m.name} ${m.niche} ${m.role} ${m.bio}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((m) => memberCard(m))}
                  </div>
                  {!data.members.filter(
                    (m) =>
                      (filter === ALL_TIMES || m.time === filter) &&
                      `${m.name} ${m.niche} ${m.role} ${m.bio}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  ).length && (
                    <Empty
                      title={
                        data.members.length
                          ? "Noch kein passender Treffer."
                          : data.profile.listed
                            ? "Noch keine weiteren Call-Partner."
                            : "Noch keine Call-Partner sichtbar."
                      }
                      text={
                        data.members.length
                          ? "Probiere ein anderes Thema oder eine andere Call-Zeit."
                          : data.profile.listed
                            ? "Sobald weitere Caller ihr Call-Profil zeigen, stehen sie hier."
                            : "Mit deinem Call-Profil machst du den Anfang."
                      }
                    />
                  )}
                  <BuddyInbox
                    data={data}
                    mutate={mutate}
                    demo={demo}
                    saving={saving}
                  />
                </>
              )}

              {initialView === "sessions" && (
                <>
                  <PageHeading
                    title="Calls und Roleplay"
                    text="Roleplay, Feedback und gemeinsame Call-Blöcke. Treffpunkt: Google Meet."
                  >
                    {sessionsOpen && (
                      <button className="btn primary" onClick={openNewSession}>
                        <Plus size={18} />
                        Call verabreden
                      </button>
                    )}
                  </PageHeading>
                  <Tabs value={sessionFilter} onValueChange={setSessionFilter}>
                    {data.sessions.length > 0 && (
                      <TabsList>
                        {[
                          "Alle",
                          "Meine Calls",
                          "Call-Block",
                          "Roleplay",
                          "Reflexion",
                          "Vergangene",
                        ].map((v) => (
                          <TabsTrigger value={v} key={v}>
                            {v === "Alle" ? "Alle Calls" : sessionKindLabel(v)}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    )}
                    <div className="session-list">
                      {data.sessions
                        .filter((s) => matchesSession(s))
                        .sort((a, b) =>
                          (a.date + a.time).localeCompare(b.date + b.time),
                        )
                        .map((s) => (
                          <article className="card session-row" key={s.id}>
                            <div className="date-tile">
                              <span>
                                {new Date(
                                  `${s.date}T12:00:00`,
                                ).toLocaleDateString("de-DE", {
                                  month: "short",
                                })}
                              </span>
                              <strong>
                                {new Date(`${s.date}T12:00:00`).getDate()}
                              </strong>
                            </div>
                            <div className="session-row-main">
                              <div>
                                <Tag
                                  tone={s.kind === "Call-Block" ? "green" : ""}
                                >
                                  {sessionKindLabel(s.kind)}
                                </Tag>
                                {s.cancelled ? (
                                  <Tag>Abgesagt</Tag>
                                ) : (
                                  s.joined && (
                                    <Tag tone="blue">Du bist dabei</Tag>
                                  )
                                )}
                                {(s.mine || s.owner === data.viewerId) && (
                                  <Tag>Du organisierst</Tag>
                                )}
                                {s.team && <Tag tone="blue">Vom Team</Tag>}
                                {s.room && !s.cancelled && (
                                  <Tag tone="green">Google-Meet-Link bereit</Tag>
                                )}
                              </div>
                              <button
                                className="session-title-button"
                                onClick={() => setSession(s)}
                              >
                                <h2>{s.title}</h2>
                              </button>
                              <p>
                                <Clock3 size={14} />
                                {s.time} Uhr · {s.minutes} Min.
                                <span>mit {s.host}</span>
                              </p>
                            </div>
                            <div className="session-seats">
                              <Users size={16} />
                              {s.attendees}/{s.capacity}
                              <small>Plätze belegt</small>
                            </div>
                            <button
                              className="btn secondary"
                              onClick={() => setSession(s)}
                            >
                              Ansehen
                            </button>
                          </article>
                        ))}
                    </div>
                  </Tabs>
                  {!data.sessions.filter((s) => matchesSession(s)).length && (
                    <Empty
                      icon={CalendarDays}
                      title={data.sessions.length ? "Keine Sessions in dieser Auswahl." : "Noch keine Sessions."}
                      text={
                        sessionsOpen
                          ? "Leg einen Übungstermin oder Call-Block mit deinen Call-Partnern an. Getroffen wird sich direkt im Google-Call."
                          : "Verabrede einen Call-Block, Roleplay oder einen kurzen Rückblick zu zweit."
                      }
                    >
                      {sessionsOpen && !data.sessions.length && (
                        <button className="btn primary" onClick={openNewSession}>
                          Erste Call verabreden
                        </button>
                      )}
                    </Empty>
                  )}
                  {sessionsOpen && (
                    <div className="session-principles">
                      <div>
                        <Headphones size={23} />
                        <h3>Call-Block</h3>
                        <p>
                          Zu zweit oder im kleinen Kreis zusätzlich callen. Den
                          Ablauf stimmt ihr selbst ab.
                        </p>
                      </div>
                      <div>
                        <MessageCircle size={23} />
                        <h3>Roleplay</h3>
                        <p>
                          Gespräche üben, Feedback bekommen und mit mehr
                          Sicherheit starten.
                        </p>
                      </div>
                      <div>
                        <Sparkles size={23} />
                        <h3>Rückblick</h3>
                        <p>
                          Kurzer Rückblick mit deinem Call-Partner: Was lief gut,
                          was probiert ihr als Nächstes?
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {initialView === "wissen" && (
                <>
                  <PageHeading
                    title="Wissen und Feedback"
                    text="Echte Erfahrungen anderer Caller und kurze Impulse für deine nächsten Calls."
                  />
                  <Tabs value={knowledgeTab} onValueChange={setKnowledgeTab}>
                    <TabsList>
                      <TabsTrigger value="Austausch">Austausch</TabsTrigger>
                      <TabsTrigger value="Bibliothek">Impulse</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {knowledgeTab === "Austausch" ? (
                    <ExchangeBoard
                      data={data}
                      demo={demo}
                      mutate={mutate}
                      saving={saving}
                      onProfile={() => {
                        setProfile(data.profile);
                        setModal("profile");
                      }}
                    />
                  ) : (
                    <>
                      <div className="filter-row">
                        <label className="search-input">
                          <Search size={18} aria-hidden="true" />
                          <input
                            type="search"
                            aria-label="Wissen durchsuchen"
                            placeholder="Suche nach Einstieg, Einwänden, Fokus …"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                        <button
                          className={`btn secondary ${filter === "saved" ? "chosen" : ""}`}
                          onClick={() =>
                            setFilter(filter === "saved" ? ALL_TIMES : "saved")
                          }
                        >
                          <Bookmark size={17} />
                          Merkliste ({data.bookmarks.length})
                        </button>
                      </div>
                      <div className="knowledge-grid">
                        {resources
                          .filter(
                            (r) =>
                              (filter !== "saved" ||
                                data.bookmarks.includes(r.id)) &&
                              `${r.title} ${r.summary} ${r.category}`
                                .toLowerCase()
                                .includes(search.toLowerCase()),
                          )
                          .map((r, i) => (
                            <article className="card resource-card" key={r.id}>
                              <div className={`resource-cover cover-${i}`}>
                                <span className="resource-number">
                                  0{resources.indexOf(r) + 1}
                                </span>
                                {r.icon === "phone" ? (
                                  <Phone size={50} />
                                ) : r.icon === "message" ? (
                                  <MessageCircle size={50} />
                                ) : (
                                  <Clock3 size={50} />
                                )}
                                <span>OPERATOR NOTES</span>
                              </div>
                              <div className="resource-body">
                                <div className="resource-meta">
                                  <span>{r.category}</span>
                                  <button
                                    className={`icon-button ${data.bookmarks.includes(r.id) ? "bookmarked" : ""}`}
                                    aria-label={
                                      data.bookmarks.includes(r.id)
                                        ? "Aus Merkliste entfernen"
                                        : "In Merkliste speichern"
                                    }
                                    onClick={() =>
                                      mutate("bookmark", r.id, (d) => ({
                                        ...d,
                                        bookmarks: d.bookmarks.includes(r.id)
                                          ? d.bookmarks.filter(
                                              (x) => x !== r.id,
                                            )
                                          : [...d.bookmarks, r.id],
                                      }))
                                    }
                                  >
                                    <Bookmark size={18} />
                                  </button>
                                </div>
                                <h2>{r.title}</h2>
                                <p>{r.summary}</p>
                                <button
                                  className="text-link"
                                  onClick={() => setResource(r)}
                                >
                                  Impuls lesen
                                  <small>{r.minutes} Min.</small>
                                </button>
                              </div>
                            </article>
                          ))}
                      </div>
                      {!resources.filter(
                        (r) =>
                          (filter !== "saved" ||
                            data.bookmarks.includes(r.id)) &&
                          `${r.title} ${r.summary} ${r.category}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      ).length && (
                        <Empty
                          icon={Bookmark}
                          title="Hier ist noch Platz für gute Impulse."
                          text="Speichere einen Beitrag in deiner Merkliste oder passe die Suche an."
                        />
                      )}
                      {sessionsOpen && (
                        <section className="feedback-banner">
                          <div>
                            <Tag tone="green">AUS DER PRAXIS.</Tag>
                            <h2>Feedback zu deinem Einstieg holen.</h2>
                            <p>
                              Bring deinen echten Gesprächseinstieg ins nächste
                              Roleplay.
                              <br />
                              Gemeinsam findet ihr heraus, was verständlich ist
                              und was noch hakt.
                            </p>
                          </div>
                          <Link href={href("sessions")} className="btn primary">
                            Feedback-Session finden
                          </Link>
                        </section>
                      )}
                    </>
                  )}
                </>
              )}

              {initialView === "profil" && (
                <>
                  <PageHeading
                    title="Profil und Einstellungen"
                  />
                  <div className="ca-settings">
                    {data.viewerRole && (
                      <section className="ca-role" aria-labelledby="ca-role-title">
                        <div>
                          <p className="ca-role-kicker">Deine Rolle im Team</p>
                          <h2 id="ca-role-title">
                            {data.viewerRole === "admin" ? "Admin" : "Moderator"}
                          </h2>
                          <p>
                            {data.viewerRole === "admin"
                              ? "Du verwaltest alles: Team-Inbox, Übernahmen, Prüffälle, Pausen, Importe, Regeln, Benachrichtigungen, Discord und Team & Rollen. Bei Call-Partner siehst du alle Call-Profile, auch nicht gezeigte."
                              : "Du bearbeitest in der Verwaltung Team-Inbox, Übernahmen, Prüffälle, Pausen und den Wins-Import und moderierst Sessions. Bei Call-Partner siehst du alle Call-Profile, auch nicht gezeigte."}
                          </p>
                        </div>
                        <Link className="btn secondary" href="/verwaltung">
                          Zur Verwaltung
                        </Link>
                      </section>
                    )}
                    {memberBadges({ id: "self", ...data.profile, levels: data.ownLevels, packageName: data.ownPackageName })}
                    <AccountSettings
                      key={demo ? "demo" : "own"}
                      demo={demo}
                      plan={<div className="form-stack">{planFields()}</div>}
                      extra={<div className="form-stack">{callFields()}</div>}
                      onSaved={saveCallProfile}
                      standalone={
                        <div className="account-extra">
                          <h3>Für Call-Partner</h3>
                          {profileForm()}
                        </div>
                      }
                    />
                    <PushSetup settings={settings} />
                    {!demo && <AccountAccess />}
                  </div>
                </>
              )}
            </>
          )}
      </main>
      <OperatorFooter />

      <Dialog open={!!modal} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent
          className={
            modal === "reflection" || modal === "profile" ? "wide-dialog" : ""
          }
        >
          <DialogHeader>
            <DialogTitle>
              {modal === "metrics"
                ? "Deine Woche im Detail"
                : modal === "reflection"
                  ? "Dein Tagesabschluss"
                    : modal === "profile"
                      ? "Dein Profil"
                      : modal === "create-session"
                        ? editSessionId
                          ? "Deine Session bearbeiten"
                          : "Neue Call verabreden"
                        : modal === "buddy"
                          ? "Call-Partner anfragen"
                          : "Hier zählt, dass du dranbleibst."}
            </DialogTitle>
            <DialogDescription>
              {demo
                ? "Du bist in der Vorschau. Personen, Termine und Einträge sind Beispiele."
                : "Dein Bereich. Was andere sehen, steht beim Tagesabschluss."}
            </DialogDescription>
          </DialogHeader>
          {modal === "metrics" ? (
            <div className="form-stack">
              <div className="metrics-detail">
                {metrics.map((k) => (
                  <div key={k}>
                    <span>{metricLabels[k]}</span>
                    <strong>{metricTotal(k)}</strong>
                  </div>
                ))}
              </div>
              <p className="hint">
                Quoten brauchen zusammengehörige Gespräche und Ergebnisse. Aus
                unabhängigen Tagesständen wird deshalb keine Qualitätsquote
                abgeleitet.
              </p>
              <button className="btn primary" onClick={() => openClosing()}>
                <Plus size={17} />
                Tagesabschluss öffnen
              </button>
            </div>
          ) : modal === "profile" ? (
            profileForm()
          ) : modal === "create-session" ? (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const start = new Date(`${newSession.date}T${newSession.time}`);
                const original = editSessionId
                  ? data.sessions.find((x) => x.id === editSessionId)
                  : null;
                // Vorlauf gilt für neue und für verschobene Sessions.
                const moved =
                  !original ||
                  new Date(
                    original.startsAt || `${original.date}T${original.time}`,
                  ).getTime() !== start.getTime();
                const problem = moved ? sessionLeadError(start) : null;
                if (problem) {
                  toast.error(problem);
                  return;
                }
                const payload = {
                  ...newSession,
                  startsAt: new Date(
                    `${newSession.date}T${newSession.time}`,
                  ).toISOString(),
                  ...(editSessionId ? { id: editSessionId } : {}),
                };
                const ok = await mutate(
                  editSessionId ? "editSession" : "session",
                  payload,
                  (d) => ({
                    ...d,
                    sessions: editSessionId
                      ? d.sessions.map((s) =>
                          s.id === editSessionId ? { ...s, ...payload } : s,
                        )
                      : [
                          ...d.sessions,
                          {
                            ...payload,
                            id: crypto.randomUUID(),
                            host: d.profile.name || "Du",
                            owner: d.viewerId,
                            attendees: 1,
                            joined: true,
                            mine: true,
                            roster: [
                              { id: d.viewerId, name: d.profile.name || "Du" },
                            ],
                          },
                        ],
                  }),
                );
                if (ok) {
                  setModal(null);
                  setEditSessionId(null);
                  setNewSession({ ...newSession, title: "" });
                  toast.success(
                    editSessionId
                      ? "Session aktualisiert."
                      : demo
                        ? "Beispielsession angelegt."
                        : "Deine Session ist jetzt für andere Angemeldete sichtbar. Der Call ist unter Call-Partner zu finden.",
                  );
                }
              }}
            >
              <label>
                Wie heißt dein Call?
                <input
                  required
                  minLength={4}
                  maxLength={100}
                  value={newSession.title}
                  onChange={(e) =>
                    setNewSession({ ...newSession, title: e.target.value })
                  }
                  placeholder="Zum Beispiel: Extra-Block am Dienstag"
                />
              </label>
              <label>
                Format
                <FieldSelect
                  label="Session-Format"
                  value={newSession.kind}
                  onChange={(v) => setNewSession({ ...newSession, kind: v })}
                  options={["Call-Block", "Roleplay", "Reflexion"]}
                  optionLabel={sessionKindLabel}
                />
              </label>
              <div className="form-grid">
                <label>
                  Datum
                  <input
                    type="date"
                    min={demo ? dateKey() : earliestSessionDay()}
                    required
                    value={newSession.date}
                    onChange={(e) =>
                      setNewSession({ ...newSession, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  Uhrzeit
                  <input
                    type="time"
                    required
                    value={newSession.time}
                    onChange={(e) =>
                      setNewSession({ ...newSession, time: e.target.value })
                    }
                  />
                </label>
                <label>
                  Dauer in Minuten
                  <input
                    type="number"
                    min={15}
                    max={180}
                    required
                    value={newSession.minutes}
                    onChange={(e) =>
                      setNewSession({
                        ...newSession,
                        minutes: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Plätze
                  <input
                    type="number"
                    min={2}
                    max={25}
                    required
                    value={newSession.capacity}
                    onChange={(e) =>
                      setNewSession({
                        ...newSession,
                        capacity: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <div className="session-where">
                <Headphones size={20} aria-hidden="true" />
                <div>
                  <strong>Treffpunkt: Google Meet</strong>
                  <p>
                    Der Google-Meet-Link steht direkt beim Termin. Zusagen, zur Startzeit öffnen und loslegen.
                  </p>
                </div>
              </div>
              <p className="hint">
                Zeiten gelten in deiner lokalen Zeitzone (
                {Intl.DateTimeFormat().resolvedOptions().timeZone}).
              </p>
              <button className="btn primary full" disabled={saving}>
                {editSessionId ? "Änderungen speichern" : "Call verabreden"}{" "}
                <Plus size={17} />
              </button>
            </form>
          ) : modal === "buddy" ? (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!member) return;
                if (
                  data.buddies.some(
                    (b) =>
                      (b.to === member.id || b.from === member.id) &&
                      ["pending", "accepted"].includes(b.status),
                  )
                ) {
                  toast.info(
                    "Zu dieser Person besteht bereits eine Verbindung oder offene Anfrage. Du findest sie unter Call-Partner.",
                  );
                  setModal(null);
                  setMember(null);
                  return;
                }
                const ok = await mutate(
                  "buddy",
                  { target: member.id, message },
                  (d) => ({
                    ...d,
                    buddies: [
                      ...d.buddies,
                      {
                        id: crypto.randomUUID(),
                        from: d.viewerId,
                        to: member.id,
                        name: d.profile.name,
                        peerName: member.name,
                        message,
                        status: "pending",
                        incoming: false,
                      },
                    ],
                  }),
                );
                if (ok) {
                  setModal(null);
                  setMember(null);
                  toast.success(
                    demo
                      ? "Demo-Anfrage vorgemerkt. Es wurde niemand kontaktiert."
                      : "Anfrage gespeichert. Die Person sieht sie in ihrem Profil.",
                  );
                }
              }}
            >
              <p>
                Eine persönliche Anfrage an <strong>{member?.name}</strong>.
              </p>
              <label>
                Deine Nachricht
                <textarea
                  minLength={5}
                  maxLength={800}
                  required
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <p className="hint">
                Die Anfrage erscheint in der Website. Es wird keine Nachricht
                an einen externen Messenger oder per E-Mail verschickt.
              </p>
              <button className="btn primary" disabled={saving}>
                <Send size={17} />
                {demo ? "Demo-Anfrage vormerken" : "Anfrage senden"}
              </button>
            </form>
          ) : (
            <div className="form-stack">
              <p>
                Sechs Bereiche für Zahlen, Reflexion, Call-Partner, Sessions,
                Wissen und Austausch. Nutze, was dir hilft.
              </p>
              <Link
                className="btn primary"
                href="/so-funktionierts"
                onClick={() => setModal(null)}
              >
                So funktioniert’s
              </Link>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!member && modal !== "buddy"}
        onOpenChange={(open) => !open && setMember(null)}
      >
        <SheetContent className="member-sheet">
          <SheetHeader>
            <SheetTitle>Dein nächster Call-Partner?</SheetTitle>
            <SheetDescription>
              {demo
                ? "Fiktives Beispielprofil"
                : "Freiwillig geteiltes Profil"}
            </SheetDescription>
          </SheetHeader>
          {member && (
            <div className="sheet-body">
              <Avatar name={member.name} color={member.color} />
              <h2>{member.name}</h2>
              <p>{member.role}</p>
              <div className="member-tags">
                {nicheOf(member.niche) && <Tag>{member.niche}</Tag>}
                <Tag>{member.time}</Tag>
              </div>
              {member.latest && (
                <div className="shared-stats">
                  <small>
                    Freiwillig geteilt · {prettyDate(member.latest.date)}
                  </small>
                  <div>
                    <span>
                      <strong>{member.latest.attempts}</strong>Anwahlen
                    </span>
                    <span>
                      <strong>{member.latest.meetings}</strong>Termine
                    </span>
                  </div>
                </div>
              )}
              <h3>So möchte ich mich austauschen</h3>
              <p>{member.bio}</p>
              <div className="profile-facts">
                <span>
                  Mein Wochenziel<strong>{member.goal} Anwahlen</strong>
                </span>
                <span>
                  Meine Tage
                  <strong>
                    {member.days.map((d) => dayNames[d]).join(", ")}
                  </strong>
                </span>
              </div>
              {memberBadges(member)}
              {memberSessions(member.id)}
              <button
                className="btn primary full"
                onClick={() => setModal("buddy")}
              >
                <Send size={17} aria-hidden="true" />
                Call-Partner anfragen
              </button>
              <p className="privacy-note">
                <ShieldCheck size={16} />
                Eine Anfrage ist noch keine Zusage. Findet gemeinsam einen
                Rhythmus, der zu euch passt.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog
        open={!!session}
        onOpenChange={(open) => !open && setSession(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{session?.title}</DialogTitle>
            <DialogDescription>
              {demo
                ? "Fiktiver Beispieltermin · keine echte Veranstaltung"
                : `Eine Session mit ${session?.host}`}
            </DialogDescription>
          </DialogHeader>
          {session && (
            <div className="form-stack">
              <Tag tone="green">{session.kind}</Tag>
              <div className="session-details">
                <span>
                  <CalendarDays size={18} />
                  {sessionDay(session.date)}, {session.time} Uhr
                </span>
                <span>
                  <Clock3 size={18} />
                  {session.minutes} Minuten
                </span>
                <span>
                  <Users size={18} />
                  {session.attendees} von {session.capacity} Plätzen
                </span>
              </div>
              <p>
                {session.kind === "Call-Block"
                  ? "Ein zusätzlicher Block mit deinem Call-Partner. Wie ihr ihn gestaltet, stimmt ihr selbst ab."
                  : session.kind === "Roleplay"
                    ? "Bring einen Gesprächseinstieg oder einen Einwand mit. Geübt wird im kleinen Kreis, mit konkretem und respektvollem Feedback."
                    : "Kurzer Rückblick mit deinem Call-Partner: Was lief gut, was probiert ihr als Nächstes?"}
              </p>
              <button
                className="btn primary full"
                disabled={
                  saving ||
                  session.cancelled ||
                  new Date(
                    session.startsAt || `${session.date}T${session.time}`,
                  ) <= new Date() ||
                  (!session.joined && session.attendees >= session.capacity) ||
                  (!session.joined && !sessionsOpen)
                }
                onClick={async () => {
                  const current = session;
                  const ok = await mutate("rsvp", current.id, (d) => ({
                    ...d,
                    sessions: d.sessions.map((s) =>
                      s.id === current.id
                        ? {
                            ...s,
                            joined: !s.joined,
                            attendees: s.attendees + (s.joined ? -1 : 1),
                            roster: s.joined
                              ? s.roster?.filter((p) => p.id !== d.viewerId)
                              : [
                                  ...(s.roster || []),
                                  {
                                    id: d.viewerId,
                                    name: d.profile.name || "Du",
                                  },
                                ],
                          }
                        : s,
                    ),
                  }));
                  if (ok) {
                    setSession({
                      ...current,
                      joined: !current.joined,
                      attendees: current.attendees + (current.joined ? -1 : 1),
                    });
                    toast.success(
                      demo
                        ? "Teilnahme in der Demo geändert."
                        : current.joined
                          ? "Teilnahme abgesagt."
                          : "Du bist dabei. Trag dir den Termin im Kalender ein.",
                    );
                  }
                }}
              >
                {session.cancelled
                  ? "Session abgesagt"
                  : new Date(
                        session.startsAt || `${session.date}T${session.time}`,
                      ) <= new Date()
                    ? "Session beendet"
                    : session.joined
                      ? "Teilnahme absagen"
                      : session.attendees >= session.capacity
                        ? "Alle Plätze belegt"
                        : demo
                          ? "In der Demo teilnehmen"
                          : "Ich bin dabei"}
              </button>
              {(session.mine ||
                session.owner === data.viewerId ||
                data.viewerTeam) &&
                !session.cancelled && (
                  <div className="button-row">
                    <button
                      className="btn secondary"
                      onClick={() => {
                        setEditSessionId(session.id);
                        setNewSession({
                          title: session.title,
                          kind: session.kind,
                          date: session.date,
                          time: session.time,
                          minutes: session.minutes,
                          capacity: session.capacity,
                        });
                        setSession(null);
                        setModal("create-session");
                      }}
                    >
                      Session bearbeiten
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setCancelSession(session)}
                    >
                      Session absagen
                    </button>
                  </div>
                )}
              {!!session.roster?.length && (
                <div className="session-roster">
                  <h3>Dabei sind</h3>
                  <div>
                    {session.roster.map((p) => (
                      <span key={p.id}>
                        <Avatar name={p.name} small />
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!demo && data.viewerTeam && !session.cancelled && sessionEnd(session) > new Date() && (
                <SessionGuests
                  session={session}
                  people={data.people ?? []}
                  mutate={(action, value) => mutate(action, value)}
                  saving={saving}
                />
              )}
              {!demo &&
                (data.viewerTeam || session.mine || session.owner === data.viewerId) &&
                !session.cancelled &&
                !(session.room && !session.roomManual) &&
                sessionEnd(session) > new Date() && (
                  <SessionRoomLink
                    key={`${session.id}:${session.room ?? ""}`}
                    session={session}
                    mutate={(action, value) => mutate(action, value)}
                    saving={saving}
                  />
                )}
              {(demo || session.mine || session.owner === data.viewerId) &&
                !session.joined && (
                  <button
                    className="btn secondary full"
                    onClick={() => downloadCalendar(session)}
                  >
                    <Download size={17} />
                    Kalendereintrag herunterladen
                  </button>
                )}
              {!session.cancelled && !demo && (
                <div className="session-guide">
                  {callRoomOf(session.room, data.callUrl) ? <a className="btn primary full" href={callRoomOf(session.room, data.callUrl)} target="_blank" rel="noopener noreferrer"><Headphones size={18} />Zum Call<span className="do-sr"> (neues Fenster)</span></a> : <p className="hint">Der Google-Meet-Link wird vom Team ergänzt.</p>}
                  {session.joined && <><PushPrompt variant="call" /><button className="btn secondary full" onClick={() => downloadCalendar(session)}><Download size={17} />Im Kalender speichern</button></>}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!resource}
        onOpenChange={(open) => !open && setResource(null)}
      >
        <DialogContent className="article-dialog">
          <DialogHeader>
            <DialogTitle>{resource?.title}</DialogTitle>
            <DialogDescription>
              {resource?.category} · {resource?.minutes} Minuten · Operator
              Notes
            </DialogDescription>
          </DialogHeader>
          <div className="article-copy">
            {resource?.content.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <Link
            className="btn primary"
            href={href("sessions")}
            onClick={() => setResource(null)}
          >
            Mit Call-Partnern üben
          </Link>
        </DialogContent>
      </Dialog>
      <Dialog open={!!shareText} onOpenChange={(v) => !v && setShareText("")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dein Tagesabschluss zum Kopieren</DialogTitle>
            <DialogDescription>
              Markiere und kopiere den Text. Er wird nicht automatisch
              versendet.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="share-copy"
            aria-label="Tagesabschluss zum Kopieren"
            readOnly
            rows={12}
            value={shareText}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareText);
                toast.success("Text kopiert.");
              } catch {
                toast.info(
                  "Bitte markiere den Text und nutze Kopieren im Browser.",
                );
              }
            }}
          >
            <Copy size={17} />
            Kopieren
          </button>
        </DialogContent>
      </Dialog>
      <ConfirmAction
        open={!!cancelSession}
        onClose={() => setCancelSession(null)}
        title="Session für alle absagen?"
        text="Die Session wird als abgesagt markiert. Ihre bisherigen Angaben bleiben erhalten."
        busy={saving}
        onConfirm={async () => {
          if (!cancelSession) return;
          if (
            await mutate("cancelSession", cancelSession.id, (d) => ({
              ...d,
              sessions: d.sessions.map((s) =>
                s.id === cancelSession.id ? { ...s, cancelled: true } : s,
              ),
            }))
          ) {
            setCancelSession(null);
            setSession(null);
            toast.success("Die Session ist abgesagt.");
          }
        }}
      />
      <Toaster richColors position="bottom-right" closeButton />
    </div>
  );
}
function PageHeading({
  title,
  text,
  children,
}: {
  /** Frühere Unterzeile; nicht mehr angezeigt. */
  eyebrow?: string;
  title: string;
  text?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="do-page-head">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}

