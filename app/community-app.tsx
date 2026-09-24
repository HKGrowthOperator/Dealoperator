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
import CommitmentDashboard from "./features/commitment-dashboard";
import RankProgress from "./features/rank-progress";
import AccountSettings, { AccountAccess } from "./features/account-settings";
import PushSetup from "./features/push-setup";
import DiscordLink from "./features/discord-link";
import type { CommitmentSettings } from "@/lib/commitment";
import BuddyInbox from "./features/buddy-inbox";
import ExchangeBoard from "./features/exchange-board";
import DiscordNudge from "./features/discord-nudge";
import ActiveCallerCard from "./features/active-caller-card";
import {
  earliestSessionDay,
  SESSION_LEAD_HOURS,
  sessionLeadError,
} from "@/lib/session-rules";
import { ConfirmAction } from "./features/shared";
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
  Target,
  UserRound,
  Users,
  LoaderCircle,
  LogIn,
  Download,
  Info,
  Lock,
  ArrowUpRight,
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
  discordUrl,
  settings,
  discordLink,
  discordResult,
}: {
  initialView: View;
  signedIn: boolean;
  discordUrl: string;
  /** Regeln für Erinnerungen (nur Profil). */
  settings?: CommitmentSettings;
  /** Stand der Discord-Verknüpfung (nur Profil). */
  discordLink?: { available: boolean; link: { name: string; since: string } | null } | null;
  discordResult?: string;
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
  const [profile, setProfile] = useState<Profile>(demoData().profile);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Alle");
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
  // Sessions & Roleplay: mit dem Rang „Aktiver Caller“; das Team immer.
  const sessionsOpen =
    demo || !!data.viewerTeam || !!data.activeCaller?.active;
  const discordInvite = data.discord?.invite || discordUrl;
  function openNewSession() {
    if (!sessionsOpen) {
      toast.info(
        "Sessions legst du als aktiver Caller an: 5 Calling-Tage am Stück mit mindestens 50 Anwahlen.",
      );
      return;
    }
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
    router.push(
      date && date !== dateKey()
        ? `/tagesabschluss?tag=${date}`
        : "/tagesabschluss",
    );
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
  function downloadCalendar(s: Session) {
    const start = new Date(s.startsAt || `${s.date}T${s.time}`);
    const end = new Date(start.getTime() + s.minutes * 60000);
    const fmt = (d: Date) =>
      d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const esc = (v: string) =>
      v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, "\\$&");
    const value = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Deal Operator//Sessions//DE\r\nBEGIN:VEVENT\r\nUID:${s.id}@aktivecaller\r\nDTSTAMP:${fmt(new Date())}\r\nDTSTART:${fmt(start)}\r\nDTEND:${fmt(end)}\r\nSUMMARY:${esc((demo ? "[DEMO] " : "") + s.title)}\r\nDESCRIPTION:${esc(demo ? "Fiktiver Beispieltermin. Keine echte Session." : s.kind + " mit " + s.host)}\r\n${s.room || s.url ? "URL:" + (s.room || s.url) + "\r\n" : ""}END:VEVENT\r\nEND:VCALENDAR`;
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
          Dein Ziel: Anwahlen pro Woche
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
          <legend>Deine Call-Tage (nur zur Planung)</legend>
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
  /** Angaben nur für Call-Partner; Name und Rolle stehen im Profil. */
  function callFields() {
    return (
      <>
        <div className="form-grid">
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
          Das suchst du beim gemeinsamen Callen
          <textarea
            maxLength={500}
            rows={3}
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="Zum Beispiel: einen festen Call-Partner für Dienstag und Donnerstag …"
          />
        </label>
        <div className="form-grid">
          <label>
            Wochenziel (Anwahlen)
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
        </div>
        <fieldset>
          <legend>Deine geplanten Call-Tage (nur zur Planung)</legend>
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
            Mein Profil bei den Call-Partnern anzeigen
            <small>
              Andere Angemeldete sehen Name, Rolle, Zielgruppe, Call-Zeit,
              Wochenziel, Call-Tage und Beschreibung, bei verknüpftem Discord
              auch einen Link zum Anschreiben. E-Mail und Telefonnummer
              bleiben privat.
            </small>
          </span>
        </label>
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
        {callFields()}
        <button className="btn primary" disabled={saving}>
          <Check size={18} />
          {saving ? "Wird gespeichert …" : "Speichern"}
        </button>
      </form>
    );
  }
  const exchangeView = ["sessions", "wissen"].includes(initialView);
  return (
    <div className="operator-site">
      <OperatorHeader discordUrl={discordUrl} />
      <main id="inhalt" className="do-page ca-main">
        {/* Call-Partner ist ein eigener Reiter ohne Unterbereiche. */}
        {initialView !== "partner" && <AreaNav area={exchangeView ? "exchange" : "mine"} />}
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
              {initialView === "heute" && (
                <>
                  <PageHeading
                    title="Mein Fortschritt"
                    text="Deine Woche, deine Abschluss-Serie und deine Level."
                  />
                  <section className="ca-section" aria-labelledby="ca-week">
                    <div className="ca-section-head">
                      <h2 id="ca-week">Diese Woche</h2>
                      <span>
                        {prettyDate(dateKey(weekStart))} bis {prettyDate(dateKey())}
                      </span>
                    </div>
                    <dl className="ca-week-stats">
                      <div>
                        <dt>Anwahlen</dt>
                        <dd>{metricTotal("attempts")}</dd>
                        <small>
                          {data.profile.goal
                            ? `Wochenziel ${data.profile.goal.toLocaleString("de-DE")}`
                            : "Kein Wochenziel"}
                        </small>
                      </div>
                      <div>
                        <dt>Settings</dt>
                        <dd>{metricTotal("settingsBooked")}</dd>
                        <small>vereinbart</small>
                      </div>
                      <div>
                        <dt>Closings</dt>
                        <dd>{metricTotal("closingsBooked")}</dd>
                        <small>vereinbart</small>
                      </div>
                    </dl>
                    <div className="ca-chart">
                      <p className="ca-chart-title">Anwahlen je Tag</p>
                      <MiniChart
                        start={dateKey(weekStart)}
                        onSelect={(date) => openClosing(date)}
                        records={data.records}
                      />
                    </div>
                    <div className="ca-section-actions">
                      <button
                        className="do-button do-button-secondary"
                        onClick={() => {
                          setProfile(data.profile);
                          setModal("plan");
                        }}
                      >
                        Wochenziel anpassen
                      </button>
                      <Link className="do-link" href={href("zahlen")}>
                        Alle Tage ansehen
                      </Link>
                    </div>
                  </section>
                  <CommitmentDashboard />
                  {!demo && (
                    <ActiveCallerCard
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
                    title="Meine Zahlen"
                    text="Jeder Tag einzeln, mit Zahlen und Reflexion. Einen Tag korrigierst du im Tagesabschluss."
                  >
                    <div className="button-row">
                      <button
                        className="do-button do-button-secondary"
                        disabled={!data.records.length}
                        onClick={exportNumbers}
                      >
                        <Download size={17} aria-hidden="true" />
                        Als CSV herunterladen
                      </button>
                    </div>
                  </PageHeading>
                  <section className="card">
                    <div className="card-heading padded">
                      <div>
                        <h2>Deine Tage</h2>
                      </div>
                      <Tag>{data.records.length} {data.records.length === 1 ? "Eintrag" : "Einträge"}</Tag>
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
                                    Im Tagesabschluss öffnen
                                  </button>
                                </div>
                                <dl className="checkin-card-kpis">
                                  {metrics.map((k) => (
                                    <div key={k}>
                                      <dt>{shortMetricLabels[k]}</dt>
                                      <dd>{c[k] ?? "–"}</dd>
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

              {initialView === "partner" && (
                <>
                  <PageHeading
                    title="Call-Partner"
                    text="Wer wann einen Call-Partner sucht: zum Üben, für ehrliches Feedback oder einen zusätzlichen Block. Verabredet wird sich im Discord."
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
                  {data.profile.listed ? (
                    <p className="ca-visible">
                      <CircleCheck size={18} aria-hidden="true" />
                      <span>
                        Du bist als Call-Partner sichtbar.{" "}
                        {discordLink?.link ? (
                          "Andere können dich über Discord anschreiben."
                        ) : !discordLink?.available ? null : (
                          <>
                            Damit dich andere über Discord anschreiben können,{" "}
                            <Link href="/profil?modus=eigen#discord">
                              verknüpfe Discord im Profil
                            </Link>
                            .
                          </>
                        )}
                      </span>
                    </p>
                  ) : (
                    <section className="ca-listing" aria-labelledby="ca-listing-title">
                      <div>
                        <h2 id="ca-listing-title">Zeig dich als Call-Partner</h2>
                        <p>
                          Andere finden dich hier erst, wenn du dein Call-Profil
                          zeigst: wann du callst, für wen und was du suchst. Ist
                          dein Discord verknüpft, können sie dich dort direkt
                          anschreiben. E-Mail und Telefonnummer bleiben privat.
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
                            <Tag tone="green">Sucht Call-Partner</Tag>
                          </div>
                          <h2>{m.name}</h2>
                          <span className="member-role">{m.role}</span>
                          <p>{m.bio}</p>
                          {m.latest && (
                            <div className="member-stats">
                              <span>
                                <strong>{m.latest.attempts}</strong>Anwahlen
                              </span>
                              <span>
                                <strong>{m.latest.meetings}</strong>Termine
                              </span>
                              <small>
                                Freiwillig geteilt · {prettyDate(m.latest.date)}
                              </small>
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
                          {m.niche && (
                            <div className="member-tags">
                              <Tag>{m.niche}</Tag>
                            </div>
                          )}
                          <div className="member-actions">
                            {m.discord && (
                              <a
                                className="btn primary full"
                                href={m.discord}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <MessageCircle size={17} aria-hidden="true" />
                                Auf Discord schreiben
                                <span className="do-sr">(öffnet Discord)</span>
                              </a>
                            )}
                            <button
                              className="btn secondary full"
                              onClick={() => setMember(m)}
                            >
                              Profil ansehen
                            </button>
                          </div>
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
                          : "Noch keine Call-Partner sichtbar."
                      }
                      text={
                        data.members.length
                          ? "Probiere ein anderes Thema oder eine andere Call-Zeit."
                          : data.profile.listed
                            ? "Sobald weitere Caller ihr Call-Profil zeigen, stehen sie hier."
                            : "Noch hat niemand sein Call-Profil gezeigt. Mit deinem machst du den Anfang."
                      }
                    />
                  )}
                  <BuddyInbox
                    data={data}
                    mutate={mutate}
                    demo={demo}
                    saving={saving}
                  />
                  <DiscordNudge context="buddy" url={discordUrl} />
                  <div className="bottom-note">
                    <ShieldCheck size={17} />
                    Deine Kontaktdaten bleiben bei dir. Ein Kontakt zu einem
                    Call-Partner startet mit einer bewussten Anfrage.
                  </div>
                </>
              )}

              {initialView === "sessions" && (
                <>
                  <PageHeading
                    title="Sessions und Roleplay"
                    text="Übungstermine und zusätzliche Call-Blöcke. Getroffen wird sich im Discord: Jede Session bekommt dort ihren eigenen Raum."
                  >
                    {sessionsOpen && (
                      <button className="btn primary" onClick={openNewSession}>
                        <Plus size={18} />
                        Session anlegen
                      </button>
                    )}
                  </PageHeading>
                  {!demo && (
                    <ActiveCallerCard
                      state={data.activeCaller}
                      team={data.viewerTeam}
                    />
                  )}
                  <Tabs value={sessionFilter} onValueChange={setSessionFilter}>
                    {data.sessions.length > 0 && (
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
                            {v === "Alle" ? "Alle Sessions" : sessionKindLabel(v)}
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
                                  <Tag tone="green">Discord-Raum bereit</Tag>
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
                          ? "Leg einen Übungstermin oder Call-Block mit deinen Call-Partnern an. Den Raum im Discord legen wir dafür an."
                          : "Sessions legst du als aktiver Caller an. Wie du das wirst, steht oben."
                      }
                    >
                      {sessionsOpen && !data.sessions.length && (
                        <button className="btn primary" onClick={openNewSession}>
                          Erste Session anlegen
                        </button>
                      )}
                    </Empty>
                  )}
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
                    </>
                  )}
                </>
              )}

              {initialView === "profil" && (
                <>
                  <PageHeading
                    title="Profil und Einstellungen"
                    text="Wie du in der Rangliste und bei Call-Partnern erscheinst, und deine Erinnerungen."
                  />
                  <div className="ca-settings">
                    <AccountSettings
                      key={demo ? "demo" : "own"}
                      demo={demo}
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
                    <DiscordLink initial={discordLink} result={discordResult} />
                    {!demo && <AccountAccess />}
                  </div>
                </>
              )}
            </>
          )}
      </main>
      <OperatorFooter discordUrl={discordUrl} />

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
                          : "Neue Session anlegen"
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
          ) : modal === "plan" ? (
            planForm()
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
                        : "Deine Session ist jetzt für andere Angemeldete sichtbar. Der Raum im Discord folgt.",
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
                  <strong>Treffpunkt: Discord</strong>
                  <p>
                    Für deine Session entsteht im Discord ein eigener
                    Sprachkanal mit Chat. Der Link erscheint hier, sobald er
                    angelegt ist. Leg Sessions spätestens am Vortag an,
                    mindestens {SESSION_LEAD_HOURS} Stunden vorher.
                  </p>
                </div>
              </div>
              <p className="hint">
                Zeiten gelten in deiner lokalen Zeitzone (
                {Intl.DateTimeFormat().resolvedOptions().timeZone}).
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
                per Messenger, Discord oder E-Mail verschickt.
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
              {member.discord && (
                <a
                  className="btn primary full"
                  href={member.discord}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle size={17} aria-hidden="true" />
                  Auf Discord schreiben
                  <span className="do-sr">(öffnet Discord)</span>
                </a>
              )}
              <button
                className={`btn ${member.discord ? "secondary" : "primary"} full`}
                onClick={() => setModal("buddy")}
              >
                <Send size={17} aria-hidden="true" />
                {member.discord ? "Hier anfragen" : "Call-Partner anfragen"}
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
                          : !sessionsOpen
                            ? "Als aktiver Caller freischalten"
                            : "Ich bin dabei"}
              </button>
              {!sessionsOpen && !session.joined && (
                <p className="session-locked">
                  <Lock size={17} aria-hidden="true" />
                  <span>
                    Zusagen kannst du als aktiver Caller: 5 Calling-Tage am
                    Stück mit mindestens 50 Anwahlen. Dein Stand steht oben auf
                    dieser Seite.
                  </span>
                </p>
              )}
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
              {demo ? (
                <p className="hint">
                  Der Demo-Termin hat keinen echten Raum im Discord.
                </p>
              ) : session.cancelled ? null : session.joined ? (
                <div className="session-guide">
                  <h3>So kommst du in den Raum</h3>
                  <ol>
                    <li>
                      <div>
                        <span>
                          Einmalig dem Deal-Operator-Server im Discord
                          beitreten, falls du noch nicht drin bist.
                        </span>
                        <a
                          className="btn secondary"
                          href={discordInvite}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Discord-Server beitreten
                          <ArrowUpRight size={16} />
                        </a>
                      </div>
                    </li>
                    <li data-done={session.room ? "" : undefined}>
                      <div>
                        {session.room ? (
                          <>
                            <span>
                              Zur Startzeit in den Raum dieser Session. Dort
                              gibt es Sprache und einen eigenen Chat.
                            </span>
                            <a
                              className="btn primary"
                              href={session.room}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Headphones size={17} />
                              Zum Session-Raum im Discord
                            </a>
                            {session.roomEvent && (
                              <a
                                className="text-link"
                                href={session.roomEvent}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Discord-Event ansehen und erinnern lassen
                              </a>
                            )}
                          </>
                        ) : (
                          <span>
                            {data.discord?.rooms
                              ? "Der Raum dieser Session entsteht im Discord vor dem Termin. Der Link erscheint dann genau hier."
                              : "Treffpunkt ist der Discord-Server. Der Link zum Raum dieser Session erscheint hier, sobald er angelegt ist."}
                          </span>
                        )}
                      </div>
                    </li>
                    <li>
                      <div>
                        <span>Termin in den Kalender, damit nichts untergeht.</span>
                        <button
                          className="btn secondary"
                          onClick={() => downloadCalendar(session)}
                        >
                          <Download size={17} />
                          Kalendereintrag herunterladen
                        </button>
                      </div>
                    </li>
                  </ol>
                  {session.url && !session.room && (
                    <a
                      href={session.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link"
                    >
                      Früher hinterlegten Raum-Link öffnen
                    </a>
                  )}
                </div>
              ) : (
                <p className="hint">
                  Treffpunkt ist ein eigener Raum im Discord. Nach deiner Zusage
                  führen wir dich Schritt für Schritt hinein.
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
  text: string;
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

