"use client";
import { useState, useEffect, useCallback } from "react";
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
import CheckinEditor from "./features/checkin-editor";
import { StreakStrip } from "./features/commitment-dashboard";
import RankProgress from "./features/rank-progress";
import AccountSettings from "./features/account-settings";
import BuddyInbox from "./features/buddy-inbox";
import ExchangeBoard from "./features/exchange-board";
import DiscordNudge from "./features/discord-nudge";
import OperatorWordmark from "./features/operator-wordmark";
import { ConfirmAction } from "./features/shared";
import { emptyWorkflows } from "./workflow-data";

import {
  BarChart3,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  Flame,
  Headphones,
  LayoutDashboard,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  LoaderCircle,
  Heart,
  LogIn,
  Download,
  Info,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
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
  labels,
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
const icons = {
  heute: LayoutDashboard,
  zahlen: BarChart3,
  reflexion: MessageCircle,
  crew: Users,
  sessions: Headphones,
  wissen: BookOpen,
  profil: Settings2,
  community: Info,
};
const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const blankRecord = (): RecordDay => ({
  date: dateKey(),
  attempts: 0,
  conversations: 0,
  meetings: 0,
  energy: null,
  win: "",
  next: "",
  help: "",
  shared: false,
});
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
function FieldSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
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
function Stat({
  icon: Icon,
  label,
  value,
  note,
  accent = false,
  onClick,
}: {
  icon: any;
  label: string;
  value: string | number;
  note: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`stat card ${accent ? "stat-accent" : ""}`}
    >
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={19} />
      </div>
      <strong>{value}</strong>
      <span className="stat-note">{note}</span>
    </button>
  );
}
function MiniChart({
  records,
  days = 7,
  onSelect,
}: {
  records: RecordDay[];
  days?: number;
  onSelect?: (date: string) => void;
}) {
  const series = Array.from({ length: days }, (_, i) => {
    const date = offset(i - days + 1);
    return { date, record: records.find((r) => r.date === date) };
  });
  const max = Math.max(60, ...series.map((x) => x.record?.attempts || 0));
  return (
    <div
      className="chart"
      role="group"
      aria-label={`Anrufversuche der letzten ${days} Tage: ${series.map((x) => `${prettyDate(x.date)}: ${x.record?.attempts ?? "kein Eintrag"}`).join(", ")}`}
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
            aria-label={`Tagesabschluss für ${prettyDate(date)} öffnen`}
            onClick={() => onSelect?.(date)}
          >
            <div className="bar-space">
              <span className="bar-value">{record?.attempts ?? "–"}</span>
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
  discordUrl,
}: {
  initialView: View;
  signedIn: boolean;
  discordUrl: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeQuery = searchParams.get("modus");
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
  const [record, setRecord] = useState<RecordDay>(blankRecord);
  const [profile, setProfile] = useState<Profile>(demoData().profile);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Alle");
  const [sessionFilter, setSessionFilter] = useState("Alle");
  const [message, setMessage] = useState(
    "Hey, ich würde gern gemeinsam mit dir callen. Passt dir ein Call-Block diese Woche?",
  );
  const [newSession, setNewSession] = useState({
    title: "",
    kind: "Call-Block",
    date: offset(1),
    time: "09:00",
    minutes: 50,
    capacity: 8,
    url: "",
  });
  const [recordPeriod, setRecordPeriod] = useState("7");
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
          setRecord(
            result.records.find((r: RecordDay) => r.date === dateKey()) ||
              blankRecord(),
          );
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
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Navigation closes drafts belonging to the previous section.
    setSearch("");
    setFilter("Alle");
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
          "Open a section of the caller community. Does not save or submit data.",
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
          console.warn("Community tools are unavailable in this browser."),
        );
      } catch {
        console.warn("Community tools are unavailable in this browser.");
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
      router.push("/beitreten");
      return;
    }
    router.push("/heute?modus=eigen");
    setMode("own");
    setData(blankData);
    void refresh();
  }
  function openNewSession() {
    if (!data.profile.name) {
      toast.info(
        "Ergänze zuerst deinen Anzeigenamen, damit die Crew weiß, wer die Session anbietet.",
      );
      setProfile(data.profile);
      setModal("profile");
      return;
    }
    setEditSessionId(null);
    setNewSession({
      title: "",
      kind: "Call-Block",
      date: offset(1),
      time: "09:00",
      minutes: 50,
      capacity: 8,
      url: "",
    });
    setModal("create-session");
  }
  function openMetrics() {
    if (initialView === "zahlen") setModal("metrics");
    else router.push(href("zahlen"));
  }
  // Zahlen und Reflexion laufen über den Tagesabschluss (/api/closing).
  function openClosing(date?: string) {
    router.push(
      date && date !== dateKey()
        ? `/tagesabschluss?tag=${date}`
        : "/tagesabschluss",
    );
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
  function reflectionText(r: RecordDay) {
    const counts = r.counts || {
      ...emptyCounts(),
      attempts: r.attempts,
      legacyMeetings: r.meetings,
    };
    return `Mein Tagesabschluss · ${prettyDate(r.date)}\n${metrics
      .filter((k) => counts[k] !== null)
      .map((k) => `${metricLabels[k]}: ${counts[k]}`)
      .join(
        " · ",
      )}${r.energy != null ? `\nEnergie: ${r.energy}/10` : ""}\nMein Learning: ${r.win || "–"}\nNächster Schritt: ${r.next}\nWobei ich Hilfe suche: ${r.help || "–"}`;
  }
  async function copyReflection(r: RecordDay) {
    const text = reflectionText(r);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Kopiert.");
    } catch {
      setShareText(text);
      toast.info(
        "Markiere den Text im geöffneten Fenster und kopiere ihn.",
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
  const weekRecords = data.records.filter(
    (r) => r.date >= dateKey(weekStart) && r.date <= dateKey(),
  );
  const total = (
    key: "attempts" | "conversations" | "meetings",
    records = weekRecords,
  ) => records.reduce((sum, r) => sum + (r[key] ?? 0), 0);
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
  const metricTotal = (k: Metric) => (totals[k] === null ? "—" : totals[k]!);
  const doneToday = data.records.some((r) => r.date === dateKey());
  const percent = Math.min(
    100,
    Math.round((total("attempts") / data.profile.goal) * 100),
  );
  const nextSession = data.sessions
    .filter(
      (s) =>
        !s.cancelled &&
        new Date(s.startsAt || `${s.date}T${s.time}`) > new Date(),
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const name = data.profile.name.split(" ")[0] || "Operator";
  function downloadCalendar(s: Session) {
    const start = new Date(s.startsAt || `${s.date}T${s.time}`);
    const end = new Date(start.getTime() + s.minutes * 60000);
    const fmt = (d: Date) =>
      d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const esc = (v: string) =>
      v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, "\\$&");
    const value = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Deal Operator//Community//DE\r\nBEGIN:VEVENT\r\nUID:${s.id}@aktivecaller\r\nDTSTAMP:${fmt(new Date())}\r\nDTSTART:${fmt(start)}\r\nDTEND:${fmt(end)}\r\nSUMMARY:${esc((demo ? "[DEMO] " : "") + s.title)}\r\nDESCRIPTION:${esc(demo ? "Fiktiver Beispieltermin. Keine echte Session." : s.kind + " mit " + s.host)}\r\n${s.url ? "URL:" + s.url + "\r\n" : ""}END:VEVENT\r\nEND:VCALENDAR`;
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
      (sessionFilter === "Meine Sessions"
        ? s.joined || s.mine || s.owner === data.viewerId
        : s.kind === sessionFilter)
    );
  }
  function nav(v: View) {
    return (
      <NavigationItem
        key={v}
        view={v}
        href={href(v)}
        active={initialView === v}
      />
    );
  }
  function reflectionForm() {
    return (
      <CheckinEditor
        initialDate={record.date}
        onSubmitted={async () => {
          if (!demo) await refresh(true);
        }}
      />
    );
  }
  function planForm() {
    return (
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!profile.days.length) {
            toast.error("Wähle mindestens einen Call-Tag.");
            return;
          }
          if (
            await mutate(
              "plan",
              { goal: profile.goal, days: profile.days },
              (d) => ({
                ...d,
                profile: {
                  ...d.profile,
                  goal: profile.goal,
                  days: profile.days,
                },
              }),
            )
          ) {
            setModal(null);
            toast.success("Dein Wochenplan ist gespeichert.");
          }
        }}
      >
        <label>
          Dein Ziel: Anrufversuche pro Woche
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
                  onCheckedChange={(v) =>
                    setProfile({
                      ...profile,
                      days: v
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
        <div className="plan-estimate">
          <Target size={23} />
          <span>
            <strong>
              {profile.days.length
                ? Math.ceil(profile.goal / profile.days.length)
                : "–"}{" "}
              Versuche pro Call-Tag
            </strong>
            <small>
              Ein Richtwert für deine Planung. Du kannst dein Ziel jederzeit
              anpassen.
            </small>
          </span>
        </div>
        <button className="btn primary" disabled={saving}>
          <Check size={17} />
          Wochenplan speichern
        </button>
      </form>
    );
  }
  function profileForm() {
    return (
      <form onSubmit={saveProfile} className="form-stack">
        <div className="form-grid">
          <label>
            Dein Anzeigename
            <input
              required
              minLength={2}
              maxLength={60}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder="Wie möchtest du genannt werden?"
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
          <label>
            Dein Markt / deine Zielgruppe
            <input
              required
              maxLength={80}
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
          Das suchst du in der Community
          <textarea
            maxLength={500}
            rows={3}
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="Zum Beispiel: einen festen Buddy für Dienstag und Donnerstag …"
          />
        </label>
        <div className="form-grid">
          <label>
            Anrufversuche pro Woche
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
          </label>
          <label>
            Dein Community-Kanal
            <FieldSelect
              label="Community-Kanal"
              // Ein älterer gespeicherter Wert wird nicht mehr angeboten und
              // zeigt deshalb nur den Platzhalter.
              value={
                ["Discord", "Telegram"].includes(profile.channel)
                  ? profile.channel
                  : ""
              }
              placeholder="Bitte wählen"
              onChange={(v) => setProfile({ ...profile, channel: v })}
              options={["Discord", "Telegram"]}
            />
          </label>
        </div>
        <fieldset>
          <legend>Deine geplanten Call-Tage</legend>
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
        <label className="checkbox-row">
          <Checkbox
            checked={profile.listed}
            onCheckedChange={(v) => setProfile({ ...profile, listed: !!v })}
          />
          <span>
            Mein Profil in der Crew anzeigen
            <small>
              Andere angemeldete Mitglieder sehen Name, Rolle, Zielgruppe,
              Call-Zeit, Wochenziel, Call-Tage, bevorzugten Kanal und
              Beschreibung. Deine E-Mail und Reflexionen bleiben privat.
            </small>
          </span>
        </label>
        <button className="btn primary" disabled={saving}>
          <Check size={18} />
          {saving ? "Wird gespeichert …" : "Profil & Wochenziel speichern"}
        </button>
      </form>
    );
  }
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "242px" } as React.CSSProperties}
    >
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <Link
            href={href("heute")}
            className="brand"
            aria-label="Deal Operator – Übersicht"
          >
            <OperatorWordmark />
          </Link>
          <span className="brand-sub">GEMEINSAM DRANBLEIBEN.</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>DEIN FORTSCHRITT</SidebarGroupLabel>
            <SidebarMenu>
              {(["heute", "zahlen", "reflexion"] as View[]).map(nav)}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>
              DEINE COMMUNITY <span className="free-mini">KOSTENFREI</span>
            </SidebarGroupLabel>
            <SidebarMenu>
              {(["crew", "sessions", "wissen"] as View[]).map(nav)}
            </SidebarMenu>
          </SidebarGroup>
          <div className="sidebar-note">
            <span className="small-circle">
              <Heart size={15} />
            </span>
            <strong>Hier zählt, dass du dranbleibst.</strong>
            <p>
              Gute Tage. Zähe Tage.
              <br />
              Gemeinsam weiter.
            </p>
            <Link href={href("community")}>Unsere Community</Link>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <Link href={href("profil")} className="profile-nav">
            <Avatar name={name} color="green" small />
            <span>
              <strong>{name}</strong>
              <small>
                {demo ? "Beispielprofil" : "Dein kostenfreier Bereich"}
              </small>
            </span>
            <Settings2 size={17} />
          </Link>
        </SidebarFooter>
      </Sidebar>
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-left">
            <SidebarTrigger />
            <span className="breadcrumb">
              Community <strong>{labels[initialView]}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="free-status">
              <span />
              Community ist kostenfrei
            </span>
            <button
              className="icon-button"
              onClick={() => setModal("about")}
              aria-label="So funktioniert die Community"
            >
              <Info size={19} />
            </button>
            <Link href={href("profil")} aria-label="Mein Profil">
              <Avatar name={name} small />
            </Link>
          </div>
        </header>
        <div className="mode-bar own-mode">
          <span>
            <span className="mode-dot" />
            <strong>Dein persönlicher Bereich</strong>
            <span className="mode-description">
              {" "}
              – deine Einträge bleiben privat.
            </span>
          </span>
          <Link href="/ranking">Zum Community-Ranking</Link>
        </div>
        <main className="main-content">
          <div className="signup-inline">
            <p>Gemeinsam wird Dranbleiben sichtbar.</p>
            <Link href="/ranking">Community-Ranking ansehen</Link>
          </div>
          {!demo && !signedIn ? (
            <Empty
              icon={LogIn}
              title="Dein Fortschritt beginnt hier."
              text="Melde dich an und starte mit deinen eigenen Zahlen. Die Community-Funktionen sind kostenfrei."
            >
              <button className="btn primary" onClick={own}>
                Kostenfrei anmelden
              </button>
            </Empty>
          ) : loading ? (
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
              {["heute", "zahlen"].includes(initialView) && (
                <RankProgress records={data.records} />
              )}
              {initialView === "heute" && (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">
                        DEIN TAG. DEINE CREW. DEIN FORTSCHRITT.
                      </p>
                      <h1>
                        Nicht allein am Hörer<span className="lime-dot">.</span>
                      </h1>
                      <p>
                        Hey {name}, schön, dass du da bist. Lass uns heute
                        dranbleiben.
                      </p>
                    </div>
                  </div>
                  <StreakStrip />
                  <div className="dashboard-top">
                    <div className="week-banner">
                      <span className="round-icon">
                        <Flame size={23} />
                      </span>
                      <div>
                        <strong>Eine gute Woche beginnt mit einem Call.</strong>
                        <p>
                          Dein Ziel: {data.profile.goal} Anrufversuche. Jeder
                          ehrliche Schritt zählt.
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => {
                          setProfile(data.profile);
                          setModal("plan");
                        }}
                      >
                        Ziel anpassen
                      </button>
                    </div>
                  </div>
                  <div className="section-caption">
                    <span>DEINE WOCHE IM BLICK</span>
                    <span>
                      {prettyDate(dateKey(weekStart))} – {prettyDate(dateKey())}
                    </span>
                  </div>
                  <div className="stats-grid">
                    <Stat
                      onClick={openMetrics}
                      icon={Phone}
                      label="Anrufversuche"
                      value={metricTotal("attempts")}
                      note={`${percent} % deines Wochenziels`}
                      accent
                    />
                    <Stat
                      onClick={openMetrics}
                      icon={CalendarDays}
                      label="Settings vereinbart"
                      value={metricTotal("settingsBooked")}
                      note="Aus Anwahlen werden nächste Schritte."
                    />
                    <Stat
                      onClick={openMetrics}
                      icon={CheckCheck}
                      label="Settings gehalten"
                      value={metricTotal("settingsHeld")}
                      note="Termine, die wirklich stattgefunden haben."
                    />
                  </div>
                  <div className="dashboard-grid">
                    <section className="card chart-card">
                      <div className="card-heading">
                        <div>
                          <h2>Dranbleiben wird sichtbar.</h2>
                          <p>Deine Anrufversuche der letzten 7 Tage</p>
                        </div>
                        <Link
                          href={href("zahlen")}
                          className="icon-button"
                          aria-label="Alle Zahlen ansehen"
                        ></Link>
                      </div>
                      <MiniChart
                        onSelect={(date) => openClosing(date)}
                        records={data.records}
                      />
                      <div className="chart-footer">
                        <span>
                          <i />
                          Anrufversuche
                        </span>
                        <span>Dein Tempo. Dein Fortschritt.</span>
                      </div>
                    </section>
                    <section className="session-spotlight">
                      <div className="spotlight-top">
                        <Tag tone="dark">DEIN NÄCHSTER CALL-BLOCK</Tag>
                        <Headphones size={23} />
                      </div>
                      <div className="spotlight-art">
                        <div className="orbit orbit-one" />
                        <div className="orbit orbit-two" />
                        <Phone size={35} />
                        <span className="orbit-dot one" />
                        <span className="orbit-dot two" />
                      </div>
                      <h2>
                        {nextSession
                          ? nextSession.title
                          : "Zusammen fällt der erste Call leichter."}
                      </h2>
                      <p>
                        {nextSession
                          ? `${sessionDay(nextSession.date)}, ${nextSession.time} Uhr · ${nextSession.minutes} Minuten`
                          : "Leg einen gemeinsamen Call-Block an und lade deine Crew ein."}
                      </p>
                      {nextSession && (
                        <div className="session-people">
                          <span className="avatar-stack">
                            {data.members.slice(0, 3).map((m) => (
                              <Avatar
                                key={m.id}
                                name={m.name}
                                color={m.color}
                                small
                              />
                            ))}
                          </span>
                          <span>
                            {nextSession.attendees} von {nextSession.capacity}{" "}
                            Plätzen belegt
                          </span>
                        </div>
                      )}
                      <button
                        className="btn lime full"
                        onClick={() =>
                          nextSession
                            ? setSession(nextSession)
                            : openNewSession()
                        }
                      >
                        {nextSession ? "Session ansehen" : "Call-Block anlegen"}
                      </button>
                      <small>Kostenfrei. Gemeinsam. Verbindlich.</small>
                    </section>
                  </div>
                  <div className="dashboard-bottom">
                    <section className="card routine-card">
                      <div className="card-heading">
                        <div>
                          <h2>Dein kleiner täglicher Fortschritt</h2>
                          <p>Eine Routine, die dich weiterbringt.</p>
                        </div>
                        <span className="icon-tile">
                          <CheckCheck size={21} />
                        </span>
                      </div>
                      <div className="routine-row">
                        <span className="step-number done">
                          <Check size={17} />
                        </span>
                        <div>
                          <strong>Setz dir ein realistisches Ziel</strong>
                          <p>
                            {data.profile.goal} Versuche an{" "}
                            {data.profile.days.length} geplanten Call-Tagen
                          </p>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Wochenziel bearbeiten"
                          onClick={() => {
                            setProfile(data.profile);
                            setModal("plan");
                          }}
                        ></button>
                      </div>
                      <div className="routine-row">
                        <span
                          className={`step-number ${doneToday ? "done" : ""}`}
                        >
                          {doneToday ? <Check size={17} /> : 2}
                        </span>
                        <div>
                          <strong>
                            {doneToday
                              ? "Heute reflektiert. Stark."
                              : "Zahlen rein. Kopf frei."}
                          </strong>
                          <p>Zahlen und Reflexion in einem Tagesabschluss</p>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Tagesabschluss öffnen"
                          onClick={() => openClosing()}
                        ></button>
                      </div>
                      <div className="routine-row">
                        <span className="step-number">3</span>
                        <div>
                          <strong>Hol dir Rückenwind von deiner Crew</strong>
                          <p>Ein Learning teilen oder einen Buddy finden</p>
                        </div>
                        <Link
                          className="icon-button"
                          href={href("crew")}
                          aria-label="Crew öffnen"
                        ></Link>
                      </div>
                    </section>
                    <section className="card buddy-teaser">
                      <div className="card-heading">
                        <h2>Finde deinen Call-Buddy.</h2>
                        <Users size={21} />
                      </div>
                      <p>
                        Ähnlicher Rhythmus. Ehrliches Feedback.
                        <br />
                        Jemand, der mit dir dranbleibt.
                      </p>
                      <div className="buddy-faces">
                        {data.members.slice(0, 4).map((m) => (
                          <button
                            key={m.id}
                            onClick={() => setMember(m)}
                            aria-label={`Profil von ${m.name}`}
                          >
                            <Avatar name={m.name} color={m.color} />
                          </button>
                        ))}
                        {data.members.length === 0 && (
                          <span className="quiet-text">
                            Deine Crew kann hier wachsen.
                          </span>
                        )}
                      </div>
                      <Link className="text-link" href={href("crew")}>
                        Crew entdecken
                      </Link>
                      <span className="free-line">
                        <Check size={14} />
                        Buddy-Suche ist immer kostenfrei.
                      </span>
                    </section>
                  </div>
                </>
              )}

              {initialView === "zahlen" && (
                <>
                  <PageHeading
                    eyebrow="MEHR KLARHEIT. WENIGER BAUCHGEFÜHL."
                    title="Dein Fortschritt in Zahlen."
                    text="Verstehe deine Entwicklung und plane den nächsten realistischen Schritt."
                  >
                    <div className="button-row">
                      <button
                        className="btn secondary"
                        disabled={!data.records.length}
                        onClick={exportNumbers}
                      >
                        <Download size={17} />
                        CSV exportieren
                      </button>
                      <button
                        className="btn primary"
                        onClick={() => openClosing()}
                      >
                        <Plus size={18} />
                        Tagesabschluss
                      </button>
                    </div>
                  </PageHeading>
                  <div className="stats-grid">
                    <Stat
                      onClick={openMetrics}
                      icon={Phone}
                      label="Anrufversuche diese Woche"
                      value={metricTotal("attempts")}
                      note={`Von ${data.profile.goal} geplanten Versuchen`}
                      accent
                    />
                    <Stat
                      onClick={openMetrics}
                      icon={MessageCircle}
                      label="Settings vereinbart"
                      value={metricTotal("settingsBooked")}
                      note="Neu gebuchte Setting-Termine"
                    />
                    <Stat
                      onClick={openMetrics}
                      icon={Target}
                      label="Deals gewonnen"
                      value={metricTotal("dealsWon")}
                      note="Gewonnene Aufträge im Zeitraum"
                    />
                  </div>
                  <section className="card chart-card">
                    <div className="card-heading">
                      <div>
                        <h2>Deine Aktivität</h2>
                        <p>Ehrliche Zahlen, auch an ruhigen Tagen.</p>
                      </div>
                      <FieldSelect
                        label="Zeitraum"
                        value={recordPeriod}
                        onChange={setRecordPeriod}
                        options={["7", "14"]}
                      />
                    </div>
                    <MiniChart
                      onSelect={(date) => openClosing(date)}
                      records={data.records}
                      days={Number(recordPeriod)}
                    />
                  </section>
                  <section className="card goal-card">
                    <div>
                      <h3>Dein Wochenziel</h3>
                      <p>
                        {total("attempts")} von {data.profile.goal}{" "}
                        Anrufversuchen · {percent} %
                      </p>
                    </div>
                    <Progress value={percent} />
                    <button
                      className="btn secondary"
                      onClick={() => {
                        setProfile(data.profile);
                        setModal("plan");
                      }}
                    >
                      <Settings2 size={16} />
                      Anpassen
                    </button>
                  </section>
                  <section className="card">
                    <div className="card-heading padded">
                      <div>
                        <h2>Deine Tage</h2>
                        <p>Wähle einen Tag, um ihn im Tagesabschluss zu öffnen.</p>
                      </div>
                      <Tag>{data.records.length} Einträge</Tag>
                    </div>
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
                            return (
                              <li className="checkin-card" key={r.date}>
                                <div className="checkin-card-top">
                                  <div>
                                    <strong>{prettyDate(r.date)}</strong>
                                    {r.date === dateKey() && (
                                      <Tag tone="green">Heute</Tag>
                                    )}
                                  </div>
                                  <button
                                    className="btn secondary"
                                    onClick={() => openClosing(r.date)}
                                  >
                                    <Settings2 size={15} />
                                    Bearbeiten
                                  </button>
                                </div>
                                <dl className="checkin-card-kpis">
                                  {metrics.map((k) => (
                                    <div key={k}>
                                      <dt>{shortMetricLabels[k]}</dt>
                                      <dd>{c[k] ?? "—"}</dd>
                                    </div>
                                  ))}
                                </dl>
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
                        text="Reiche deinen ersten Tagesabschluss ein. Danach siehst du hier deine Entwicklung."
                      />
                    )}
                  </section>
                </>
              )}

              {initialView === "reflexion" && (
                <>
                  <PageHeading
                    eyebrow="ZWEI MINUTEN FÜR DICH."
                    title="Was nimmst du heute mit?"
                    text="Zahlen zeigen, was passiert. Deine Reflexion zeigt, was du daraus machst."
                  />
                  <div className="two-columns">
                    <section className="card padded">
                      <div className="card-heading">
                        <h2>Dein Tagesabschluss</h2>
                        <Tag tone="green">Kostenfrei</Tag>
                      </div>
                      {reflectionForm()}
                    </section>
                    <aside>
                      <DiscordNudge context="reflection" url={discordUrl} />
                      <div className="reflection-note">
                        <Sparkles size={26} />
                        <h2>Ein Learning ist auch ein Win.</h2>
                        <p>
                          Du brauchst keinen perfekten Tag. Nur einen ehrlichen
                          Blick darauf, was funktioniert hat und was du morgen
                          probieren möchtest.
                        </p>
                        <span>DRANBLEIBEN &gt; PERFEKT SEIN</span>
                      </div>
                      <div className="card padded recent-reflections">
                        <h3>Deine letzten Gedanken</h3>
                        {data.records.length ? (
                          [...data.records]
                            .sort((a, b) => b.date.localeCompare(a.date))
                            .slice(0, 3)
                            .map((r) => (
                              <div className="reflection-snippet" key={r.date}>
                                <small>
                                  {prettyDate(r.date)}
                                  {r.energy != null ? ` · Energie ${r.energy}/10` : ""}
                                </small>
                                <p>{r.win || "Kein Learning eingetragen."}</p>
                                <button
                                  className="text-button"
                                  onClick={() => copyReflection(r)}
                                >
                                  <Copy size={14} />
                                  Text kopieren
                                </button>
                              </div>
                            ))
                        ) : (
                          <p>
                            Deine eingereichten Reflexionen erscheinen hier.
                          </p>
                        )}
                        <Link className="text-link" href="/reflexionen">
                          Reflexionen der Crew ansehen
                        </Link>
                      </div>
                    </aside>
                  </div>
                </>
              )}

              {initialView === "crew" && (
                <>
                  <PageHeading
                    eyebrow="GEMEINSAM IST ES EINFACHER."
                    title="Deine Crew. Dein Rückenwind."
                    text="Finde Menschen, die deinen Alltag verstehen – und mit dir am Hörer bleiben."
                  >
                    <button
                      className="btn secondary"
                      onClick={() => {
                        setProfile(data.profile);
                        setModal("profile");
                      }}
                    >
                      <Plus size={17} />
                      Mein Buddy-Profil
                    </button>
                  </PageHeading>
                  <DiscordNudge context="buddy" url={discordUrl} />
                  <div className="filter-row">
                    <div className="search-input">
                      <Search size={18} />
                      <input
                        aria-label="Crew durchsuchen"
                        placeholder="Name, Zielgruppe oder Thema suchen …"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <FieldSelect
                      label="Call-Zeit filtern"
                      value={filter}
                      onChange={setFilter}
                      options={[
                        "Alle",
                        "Vormittags",
                        "Nachmittags",
                        "Abends",
                        "Flexibel",
                      ]}
                    />
                  </div>
                  <div className="member-grid">
                    {data.members
                      .filter(
                        (m) =>
                          (filter === "Alle" || m.time === filter) &&
                          `${m.name} ${m.niche} ${m.role} ${m.bio}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((m) => (
                        <article className="card member-card" key={m.id}>
                          <div className="member-top">
                            <Avatar name={m.name} color={m.color} />
                            <Tag tone="green">Buddy gesucht</Tag>
                          </div>
                          <h2>{m.name}</h2>
                          <span className="member-role">{m.role}</span>
                          <p>{m.bio}</p>
                          {m.latest && (
                            <div className="member-stats">
                              <span>
                                <strong>{m.latest.attempts}</strong>Versuche
                              </span>
                              <span>
                                <strong>{m.latest.meetings}</strong>Termine
                              </span>
                              <small>
                                Freiwillig geteilt · {prettyDate(m.latest.date)}
                              </small>
                            </div>
                          )}
                          <div className="member-tags">
                            <Tag>{m.niche}</Tag>
                            <Tag>
                              <Clock3 size={12} />
                              {m.time}
                            </Tag>
                          </div>
                          <button
                            className="btn secondary full"
                            onClick={() => setMember(m)}
                          >
                            Profil kennenlernen
                          </button>
                        </article>
                      ))}
                  </div>
                  {!data.members.filter(
                    (m) =>
                      (filter === "Alle" || m.time === filter) &&
                      `${m.name} ${m.niche} ${m.role} ${m.bio}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  ).length && (
                    <Empty
                      title={
                        data.members.length
                          ? "Noch kein passender Treffer."
                          : "Die Crew beginnt mit dir."
                      }
                      text={
                        data.members.length
                          ? "Probiere ein anderes Thema oder eine andere Call-Zeit."
                          : "Erstelle dein Profil und gib es für andere angemeldete Mitglieder frei. In der privaten Vorschau gibt es noch keine weiteren Mitglieder."
                      }
                    />
                  )}
                  <BuddyInbox
                    data={data}
                    mutate={mutate}
                    demo={demo}
                    saving={saving}
                  />
                  <div className="bottom-note">
                    <ShieldCheck size={17} />
                    Deine Kontaktdaten bleiben bei dir. Ein Buddy-Kontakt
                    startet mit einer bewussten Anfrage.
                  </div>
                </>
              )}

              {initialView === "sessions" && (
                <>
                  <PageHeading
                    eyebrow="AUS VORSÄTZEN WERDEN TERMINE."
                    title="Zusammen an den Hörer."
                    text="Feste Call-Blöcke, ehrliches Roleplay und Platz für deinen Wochenrückblick."
                  >
                    <button className="btn primary" onClick={openNewSession}>
                      <Plus size={18} />
                      Session anbieten
                    </button>
                  </PageHeading>
                  <Tabs value={sessionFilter} onValueChange={setSessionFilter}>
                    <TabsList>
                      {[
                        "Alle",
                        "Meine Sessions",
                        "Call-Block",
                        "Roleplay",
                        "Reflexion",
                        "Vergangene",
                      ].map((v) => (
                        <TabsTrigger value={v} key={v}>
                          {v === "Alle" ? "Alle Sessions" : v}
                        </TabsTrigger>
                      ))}
                    </TabsList>
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
                                  {s.kind}
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
                      title="Platz für deinen nächsten Call-Block."
                      text="Biete eine Session mit Datum, Uhrzeit und einem optionalen Raum-Link an."
                    >
                      <button className="btn primary" onClick={openNewSession}>
                        Erste Session anlegen
                      </button>
                    </Empty>
                  )}
                  <div className="session-principles">
                    <div>
                      <Headphones size={23} />
                      <h3>Call-Block</h3>
                      <p>
                        Kurz einchecken. Gemeinsam fokussieren. Jeder führt
                        seine eigenen Calls.
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
                      <h3>Reflexion</h3>
                      <p>
                        Learnings teilen. Schwierigkeiten ansprechen. Den
                        nächsten Schritt planen.
                      </p>
                    </div>
                  </div>
                </>
              )}

              {initialView === "wissen" && (
                <>
                  <PageHeading
                    eyebrow="WAS EINEM HILFT, BRINGT ALLE WEITER."
                    title="Besser werden. Wissen teilen."
                    text="Echte Erfahrungen aus der Crew und kurze Impulse für deinen nächsten Call-Block."
                  />
                  <Tabs value={knowledgeTab} onValueChange={setKnowledgeTab}>
                    <TabsList>
                      <TabsTrigger value="Austausch">
                        Community-Austausch
                      </TabsTrigger>
                      <TabsTrigger value="Bibliothek">
                        Impulse & Merkliste
                      </TabsTrigger>
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
                        <div className="search-input">
                          <Search size={18} />
                          <input
                            aria-label="Wissen durchsuchen"
                            placeholder="Suche nach Einstieg, Einwänden, Fokus …"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                        <button
                          className={`btn secondary ${filter === "saved" ? "chosen" : ""}`}
                          onClick={() =>
                            setFilter(filter === "saved" ? "Alle" : "saved")
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
                      <section className="feedback-banner">
                        <div>
                          <Tag tone="green">VON DER CREW. FÜR DIE CREW.</Tag>
                          <h2>Du musst nicht alles allein herausfinden.</h2>
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
                    </>
                  )}
                </>
              )}

              {initialView === "profil" && (
                <>
                  <AccountSettings key={demo ? "demo" : "own"} demo={demo} />
                  <PageHeading
                    eyebrow="DEIN RHYTHMUS. DEINE ENTSCHEIDUNG."
                    title="Mach die Community zu deiner."
                    text="Ein klares Profil hilft dir, passende Call-Buddys und realistische Ziele zu finden."
                  />
                  <div className="two-columns">
                    <section className="card padded">{profileForm()}</section>
                    <aside>
                      <section className="card padded">
                        <h3>Dein persönlicher Bereich</h3>
                        <p>
                          Deine Zahlen und Reflexionen sind nur für dich
                          sichtbar. Du kannst Tageszahlen bewusst in deinem
                          Crew-Profil freigeben und Reflexionen in deine Gruppe
                          kopieren.
                        </p>
                        <p>
                          Du kannst dein Crew-Profil jederzeit ausblenden. Dein
                          privater Fortschritt bleibt erhalten.
                        </p>
                        <Tag tone="green">
                          Alle Community-Funktionen kostenfrei
                        </Tag>
                      </section>
                      <section className="card padded requests">
                        <h3>Deine Buddy-Anfragen</h3>
                        {!data.buddies.length ? (
                          <p>
                            Noch keine Anfragen. Entdecke die Crew und finde
                            einen passenden Rhythmus.
                          </p>
                        ) : (
                          data.buddies.map((b: any) => (
                            <div key={b.id} className="request">
                              <strong>
                                {b.incoming
                                  ? b.name
                                  : `An ${b.peerName || "deinen Buddy"}`}
                              </strong>
                              <p>{b.message}</p>
                              <Tag>
                                {b.status === "accepted"
                                  ? "Angenommen"
                                  : b.status === "declined"
                                    ? "Abgelehnt"
                                    : "Offen"}
                              </Tag>
                              {b.incoming && b.status === "pending" && (
                                <div className="button-row">
                                  <button
                                    className="btn secondary"
                                    onClick={() =>
                                      mutate(
                                        "buddyReply",
                                        { id: b.id, status: "accepted" },
                                        (d) => ({
                                          ...d,
                                          buddies: d.buddies.map((x) =>
                                            x.id === b.id
                                              ? { ...x, status: "accepted" }
                                              : x,
                                          ),
                                        }),
                                      )
                                    }
                                  >
                                    Annehmen
                                  </button>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      mutate(
                                        "buddyReply",
                                        { id: b.id, status: "declined" },
                                        (d) => ({
                                          ...d,
                                          buddies: d.buddies.map((x) =>
                                            x.id === b.id
                                              ? { ...x, status: "declined" }
                                              : x,
                                          ),
                                        }),
                                      )
                                    }
                                  >
                                    Ablehnen
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </section>
                    </aside>
                  </div>
                </>
              )}
              {initialView === "community" && (
                <>
                  <PageHeading
                    eyebrow="FÜR MENSCHEN, DIE WIRKLICH CALLEN."
                    title="Gemeinsam dranbleiben."
                    text="Eine Sales-Community, in der Aktivität, ehrlicher Austausch und gegenseitiger Rückenwind zählen."
                  />
                  <div className="community-manifest">
                    <span className="manifest-number">01—06</span>
                    <h2>
                      Die Community ist kostenfrei.
                      <br />
                      Der Einsatz kommt von dir.
                    </h2>
                    <p>
                      Wir setzen uns Ziele, callen, reflektieren und helfen
                      einander. Ein schlechter Tag ist kein Ausschlussgrund.
                      Dauerhaft nur mitlesen passt nicht zu dieser Community.
                    </p>
                  </div>
                  <div className="principle-grid">
                    {[
                      [
                        "Zahlen & Fortschritt",
                        "Tracke deine eigenen Anwahlen, Termine und Deals.",
                      ],
                      [
                        "Tägliche Reflexion",
                        "Teile Learnings und deinen nächsten Schritt.",
                      ],
                      [
                        "Crew & Buddy-Suche",
                        "Finde Menschen mit ähnlichem Rhythmus.",
                      ],
                      [
                        "Call-Blöcke & Roleplay",
                        "Arbeite gemeinsam und übe in einem sicheren Rahmen.",
                      ],
                      [
                        "Wissen & Feedback",
                        "Tausche Erfahrungen, Fragen und konkrete Tipps aus.",
                      ],
                      [
                        "Austausch & Commitment",
                        "Lies die Reflexionen der Crew und antworte auf Discord.",
                      ],
                    ].map(([title, text], i) => (
                      <div className="card padded" key={title}>
                        <span className="principle-index">0{i + 1}</span>
                        <h3>{title}</h3>
                        <p>{text}</p>
                        <Tag tone="green">Kostenfrei</Tag>
                      </div>
                    ))}
                  </div>
                  <section className="card padded">
                    <h2>Unsere gemeinsame Basis</h2>
                    <div className="rules">
                      <p>
                        <Check />
                        Reiche an deinen Calling-Tagen einen ehrlichen
                        Tagesabschluss ein. Wochenenden sind freiwillig.
                      </p>
                      <p>
                        <Check />
                        Urlaub, Krankheit und Pausen sind okay. Beantrage sie im
                        Tagesabschluss, dann zählen die Tage nicht als Pflicht.
                      </p>
                      <p>
                        <Check />
                        Hilf konkret, respektiere ein Nein und teile keine
                        vertraulichen Kundendaten.
                      </p>
                      <p>
                        <Check />
                        Fehlen drei Abschlüsse, meldet sich das Team persönlich.
                        Niemand wird automatisch ausgeschlossen.
                      </p>
                    </div>
                    <p className="hint">
                      Die endgültigen Aktivitätsregeln und Einladungen legt die
                      jeweilige Gruppe gemeinsam mit ihren Admins fest.
                    </p>
                  </section>
                  <section className="channels" id="discord">
                    <h2>Ein Ort für Zahlen. Ein Ort für Gespräche.</h2>
                    <p>
                      Auf der Website stehen deine Zahlen und Reflexionen. Auf
                      Discord antwortest du, findest Buddys und verabredest
                      Call-Blöcke.
                    </p>
                    <div className="channel-grid">
                      <div className="card padded">
                        <MessageCircle size={25} />
                        <h3>Reflexionen</h3>
                        <p>
                          Lies die eingereichten Tagesabschlüsse der Crew und
                          nimm Learnings für deinen nächsten Calling-Tag mit.
                        </p>
                        <Link className="text-link" href="/reflexionen">
                          Reflexionen ansehen
                        </Link>
                      </div>
                      <div className="card padded">
                        <MessageCircle size={25} />
                        <h3>Discord</h3>
                        <p>
                          Verabrede einen Fokusblock, übe einen Einwand oder
                          bring dein Learning mit in die Runde.
                        </p>
                        <a
                          className="text-link"
                          href={discordUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Discord öffnen
                        </a>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              Deal Operator <span>Gemeinsam dranbleiben.</span>
            </span>
            <Link href={href("community")}>So funktioniert’s</Link>
          </footer>
        </main>
      </div>

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
                  : modal === "plan"
                    ? "Dein Wochenplan"
                    : modal === "profile"
                      ? "Dein Profil"
                      : modal === "create-session"
                        ? editSessionId
                          ? "Deine Session bearbeiten"
                          : "Eine Session für deine Crew"
                        : modal === "buddy"
                          ? "Gemeinsam starten"
                          : "Hier zählt, dass du dranbleibst."}
            </DialogTitle>
            <DialogDescription>
              {demo
                ? "Du bist in der Vorschau. Personen, Termine und Einträge sind Beispiele."
                : "Kostenfreier Community-Bereich. Du bestimmst, was du teilst."}
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
          ) : modal === "reflection" ? (
            reflectionForm()
          ) : modal === "profile" ? (
            profileForm()
          ) : modal === "plan" ? (
            planForm()
          ) : modal === "create-session" ? (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  new Date(`${newSession.date}T${newSession.time}`) <=
                  new Date()
                ) {
                  toast.error("Wähle einen zukünftigen Termin.");
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
                  setNewSession({ ...newSession, title: "", url: "" });
                  toast.success(
                    editSessionId
                      ? "Session aktualisiert."
                      : demo
                        ? "Beispielsession angelegt."
                        : "Deine Session ist für die Community sichtbar.",
                  );
                }
              }}
            >
              <label>
                Wie heißt deine Session?
                <input
                  required
                  minLength={4}
                  maxLength={100}
                  value={newSession.title}
                  onChange={(e) =>
                    setNewSession({ ...newSession, title: e.target.value })
                  }
                  placeholder="Zum Beispiel: Gemeinsam in den Dienstag"
                />
              </label>
              <label>
                Format
                <FieldSelect
                  label="Session-Format"
                  value={newSession.kind}
                  onChange={(v) => setNewSession({ ...newSession, kind: v })}
                  options={["Call-Block", "Roleplay", "Reflexion"]}
                />
              </label>
              <div className="form-grid">
                <label>
                  Datum
                  <input
                    type="date"
                    min={dateKey()}
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
                    max={100}
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
              <label>
                Raum-Link (optional, HTTPS)
                <input
                  type="url"
                  pattern="https://.*"
                  value={newSession.url}
                  onChange={(e) =>
                    setNewSession({ ...newSession, url: e.target.value })
                  }
                  placeholder="https://…"
                />
              </label>
              <p className="hint">
                Zeiten gelten in deiner lokalen Zeitzone (
                {Intl.DateTimeFormat().resolvedOptions().timeZone}). Der
                Raum-Link wird angemeldeten Mitgliedern angezeigt.
              </p>
              <button className="btn primary full" disabled={saving}>
                {editSessionId ? "Änderungen speichern" : "Session anlegen"}{" "}
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
                    "Zu dieser Person besteht bereits eine Verbindung oder offene Anfrage. Du findest sie unter Crew & Buddys.",
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
                      : "Anfrage gespeichert. Sie ist im Profil des Mitglieds sichtbar.",
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
                per Messenger, Discord oder E-Mail verschickt.
              </p>
              <button className="btn primary" disabled={saving}>
                <Send size={17} />
                {demo ? "Demo-Anfrage vormerken" : "Buddy-Anfrage senden"}
              </button>
            </form>
          ) : (
            <div className="form-stack">
              <p>
                Sechs kostenfreie Community-Bereiche helfen dir, aktiv zu
                bleiben: Zahlen, Reflexion, Buddys, Sessions, Wissen und
                Austausch.
              </p>
              <Link
                className="btn primary"
                href={href("community")}
                onClick={() => setModal(null)}
              >
                Mehr über die Community
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
            <SheetTitle>Dein nächster Call-Buddy?</SheetTitle>
            <SheetDescription>
              {demo
                ? "Fiktives Beispielprofil"
                : "Freiwillig geteiltes Community-Profil"}
            </SheetDescription>
          </SheetHeader>
          {member && (
            <div className="sheet-body">
              <Avatar name={member.name} color={member.color} />
              <h2>{member.name}</h2>
              <p>{member.role}</p>
              <div className="member-tags">
                <Tag>{member.niche}</Tag>
                <Tag>{member.time}</Tag>
              </div>
              {member.latest && (
                <div className="shared-stats">
                  <small>
                    Freiwillig geteilt · {prettyDate(member.latest.date)}
                  </small>
                  <div>
                    <span>
                      <strong>{member.latest.attempts}</strong>Versuche
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
                  Mein Wochenziel<strong>{member.goal} Anrufversuche</strong>
                </span>
                <span>
                  Meine Tage
                  <strong>
                    {member.days.map((d) => dayNames[d]).join(", ")}
                  </strong>
                </span>
                {["Discord", "Telegram"].includes(member.channel) && (
                  <span>
                    Mein bevorzugter Kanal<strong>{member.channel}</strong>
                  </span>
                )}
              </div>
              <button
                className="btn primary full"
                onClick={() => setModal("buddy")}
              >
                <MessageCircle size={17} />
                Buddy-Anfrage starten
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
                : `Eine kostenfreie Session mit ${session?.host}`}
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
                  ? "Wir starten mit einem kurzen Check-in, arbeiten dann fokussiert an unseren eigenen Calls und teilen zum Schluss ein Learning."
                  : session.kind === "Roleplay"
                    ? "Bring einen Gesprächseinstieg oder einen Einwand mit. Wir üben in kleinen Runden und geben konkretes, respektvolles Feedback."
                    : "Was lief gut? Was war schwer? Teile einen Gedanken und nimm einen konkreten nächsten Schritt mit."}
              </p>
              <button
                className="btn primary full"
                disabled={
                  saving ||
                  session.cancelled ||
                  new Date(
                    session.startsAt || `${session.date}T${session.time}`,
                  ) <= new Date() ||
                  (!session.joined && session.attendees >= session.capacity)
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
              {(session.mine || session.owner === data.viewerId) &&
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
                          url: session.url,
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
              <button
                className="btn secondary full"
                onClick={() => downloadCalendar(session)}
              >
                <Download size={17} />
                Kalendereintrag herunterladen
              </button>
              {session.url ? (
                <a
                  href={session.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link"
                >
                  Raum öffnen
                </a>
              ) : (
                <p className="hint">
                  {demo
                    ? "Der Demo-Termin hat keinen echten Raum-Link."
                    : "Noch kein Raum-Link hinterlegt. Stimmt den Treffpunkt in eurer Gruppe ab."}
                </p>
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
            Gemeinsam ausprobieren
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
    </SidebarProvider>
  );
}
function PageHeading({
  eyebrow,
  title,
  text,
  children,
}: {
  eyebrow: string;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}

function NavigationItem({
  view,
  href,
  active,
}: {
  view: View;
  href: string;
  active: boolean;
}) {
  const { setOpenMobile } = useSidebar();
  const Icon = icons[view];
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <Link href={href} onClick={() => setOpenMobile(false)}>
          <Icon size={19} />
          <span>{labels[view]}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
