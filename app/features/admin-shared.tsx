"use client";
import { useId, useState, type ReactNode } from "react";
import type { CommitmentSettings } from "@/lib/commitment";
import type { Counts, Metric } from "@/lib/kpis";
import type { RankingEvent } from "@/lib/ranking-history";

/**
 * Gemeinsame Typen und Bausteine der Verwaltung. Alle Daten kommen aus
 * /api/admin (nur Verwaltungskonten) und /api/operator (Profilliste).
 */

export type DeliveryState =
  | "delivered"
  | "waiting_config"
  | "waiting_device"
  | "waiting_address"
  | "retrying"
  | "queued"
  | "expired"
  | "skipped"
  | "failed";
export type DeliveryGroup = {
  channel: string;
  state: DeliveryState;
  label: string;
  count: number;
};
export type InboxItem = {
  id: number;
  kind: string;
  ref: string;
  state: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  /** Zustellstand der Team-Hinweise zu diesem Eintrag, falls es welche gab. */
  delivery?: DeliveryGroup[];
};
export const DELIVERY_TONE: Record<DeliveryState, Tone> = {
  delivered: "ok",
  waiting_config: "warn",
  waiting_device: "warn",
  waiting_address: "warn",
  retrying: "neutral",
  queued: "neutral",
  expired: "muted",
  skipped: "muted",
  failed: "danger",
};
export type AdminPause = {
  id: string;
  name: string;
  from: string;
  to: string;
  reason: string;
  status: string;
};
export type NotificationStatus = {
  push: { keys: string; devices: number; needsReconsent?: number };
  email: { issues: string[] };
  counts: Partial<
    Record<"sent" | "waitingConfig" | "waitingDevice" | "open" | "skipped" | "failed", number>
  >;
  recent: {
    kind: string;
    channel: string;
    status: string;
    state: DeliveryState;
    label: string;
    detail: string | null;
    createdAt: string;
    sentAt: string | null;
  }[];
};
export type ReviewCase = {
  id: string;
  day: string;
  name_seen: string;
  excerpt: string;
  reason: string;
  status: string;
  created_at: string;
};
export type DiscordPart = "link" | "posts" | "interactions" | "inventory";
export type DiscordStatus = {
  missing: Record<DiscordPart, string[]>;
  linkedAccounts: number;
  postedReflections: number;
  outbox: { pending: number; failed: number };
};
/** Registrierungen mit noch unbestätigter E-Mail. Keine Inbox-Einträge. */
export type Unconfirmed = {
  count: number;
  recent: { id: string; kind: "new" | "claim"; name: string; since: string }[];
};
export type TeamMember = {
  owner: string;
  role: "owner" | "admin" | "moderator";
  email: string | null;
  name: string | null;
  fixed: boolean;
  grantedAt: string | null;
};
export type TeamOverview = {
  members: TeamMember[];
  accounts: { owner: string; email: string; name: string | null }[];
};
/** Moderatoren bekommen Einstellungen, Diagnose und Rollen nicht (null). */
export type AdminOverview = {
  role: "admin" | "moderator";
  inbox: InboxItem[];
  unconfirmed?: Unconfirmed;
  pauses: AdminPause[];
  events: RankingEvent[];
  rules: CommitmentSettings | null;
  notifications: NotificationStatus | null;
  cases: ReviewCase[];
  discord: DiscordStatus | null;
  team: TeamOverview | null;
};
export type Participant = {
  id: string;
  import_key: string | null;
  name: string;
  company: string;
  kind: "person" | "joint";
  claimed: boolean;
  public_consent: boolean;
  searchable: boolean;
};
export type WinsAction =
  | "neu"
  | "korrektur"
  | "unverändert"
  | "übersprungen"
  | "prüffall"
  | "ersetzt";
export type WinsRow = {
  key: string | null;
  author: string;
  participantId: string | null;
  participantName: string | null;
  day: string;
  time: string | null;
  action: WinsAction;
  revision: number;
  before: Partial<Counts> | null;
  after: Partial<Counts> | null;
  changed: Metric[];
  reasons: string[];
  notes: string[];
  excerpt: string;
};
export type WinsPreview = {
  rows: WinsRow[];
  summary: Record<WinsAction, number>;
};

export class AdminError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** POST an /api/admin. Fehlertexte des Servers werden direkt angezeigt. */
export async function adminPost<T = { ok: boolean }>(
  action: string,
  value?: unknown,
): Promise<T> {
  const response = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, value }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new AdminError(
      data?.error || "Die Aktion ist fehlgeschlagen. Bitte erneut versuchen.",
      response.status,
    );
  return data as T;
}

/** UUID für Wiederholungsschutz, auch ohne crypto.randomUUID. */
export function newKey() {
  // In unsicheren Kontexten (http ohne localhost) fehlt randomUUID.
  const source: Crypto = globalThis.crypto;
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function formatShortDay(day: string) {
  const [y, m, d] = day.split("-");
  return y && m && d ? `${d}.${m}.${y}` : day;
}

export type Tone = "neutral" | "ok" | "action" | "warn" | "muted" | "danger";
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span className="adm-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Feedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  if (error)
    return (
      <p className="adm-feedback" data-tone="danger" role="alert">
        {error}
      </p>
    );
  if (success)
    return (
      <p className="adm-feedback" data-tone="ok" role="status">
        {success}
      </p>
    );
  return null;
}

/**
 * Vorgeschlagenes Profil aus einem Prüfgrund wie „… Vorschlag: Max Muster.“
 * Nur bei genau einem gleichnamigen Personenprofil.
 */
export function suggestedProfile(reason: string, participants: Participant[]) {
  const match = /Vorschlag:\s*(.+?)\.(?:\s|$)/.exec(reason);
  if (!match) return "";
  const name = match[1].trim().toLocaleLowerCase("de");
  const hits = participants.filter(
    (p) => p.kind !== "joint" && p.name.trim().toLocaleLowerCase("de") === name,
  );
  return hits.length === 1 ? hits[0].id : "";
}

/** Profil auswählen: Suchfeld plus Liste. Gemeinsame Meldungen sind kein Ziel. */
export function ProfilePicker({
  participants,
  value,
  onChange,
  label = "Profil",
}: {
  participants: Participant[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const id = useId();
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLocaleLowerCase("de");
  const persons = participants
    .filter((p) => p.kind !== "joint")
    .toSorted((a, b) => a.name.localeCompare(b.name, "de"));
  const shown = persons.filter(
    (p) =>
      p.id === value ||
      !needle ||
      `${p.name} ${p.company}`.toLocaleLowerCase("de").includes(needle),
  );
  return (
    <div className="adm-picker">
      <label htmlFor={`${id}-filter`}>{label} suchen</label>
      <input
        id={`${id}-filter`}
        type="search"
        placeholder="Name oder Firma"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <label htmlFor={`${id}-select`} className="sr-only">
        {label}
      </label>
      <select
        id={`${id}-select`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {persons.length
            ? `${label} wählen (${shown.length} von ${persons.length})`
            : "Keine Profile geladen"}
        </option>
        {shown.map((p) => (
          <option key={p.id} value={p.id}>
            {`${p.name}${p.company ? ` · ${p.company}` : ""}${p.claimed ? " · übernommen" : ""}`}
          </option>
        ))}
      </select>
    </div>
  );
}
