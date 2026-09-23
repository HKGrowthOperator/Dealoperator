import { createHash } from "node:crypto";
import type { Database } from "./database";
import { discordConfig, discordFetch, discordMissing, type DiscordConfig } from "./discord-bridge";
import { teamRecipients } from "./roles";
import { activeDiscordUsers } from "./active-caller";
import type { SessionRoom } from "./sessions";
import { sessionEnd, sessionStart } from "../lib/session-rules";
import { berlinDate } from "../lib/kpis";

/**
 * Website → Discord für Sessions und Team-Rollen.
 *
 * Sessions werden auf der Website angelegt; getroffen wird sich im Discord.
 * Der Abgleich legt je Session einen Sprachkanal (mit eigenem Chat) und ein
 * Discord-Event an und trägt den Link in die Session ein. Änderungen an Titel,
 * Zeit oder Plätzen zieht er nach; nach einer Absage oder sechs Stunden nach
 * dem Ende räumt er Kanal und Event wieder ab.
 *
 * Rollen: Admins und Moderatoren mit verknüpftem Discord-Konto bekommen die
 * Moderatorrolle (DISCORD_MODERATOR_ROLE_ID), wer den Rang „Aktiver Caller“
 * hält, die Rolle aus DISCORD_ACTIVE_ROLE_ID. Entzogen wird eine Rolle nur
 * denen, denen der Abgleich sie selbst gegeben hat; von Hand vergebene Rollen
 * im Discord bleiben unberührt. Ist die Rolle „Aktiver Caller“ hinterlegt,
 * können Session-Räume nur mit ihr (oder als Moderator) betreten werden;
 * sehen können sie alle.
 *
 * Ohne Bot-Token und Server-ID passiert nichts, und die Website sagt das
 * ehrlich. Der Abgleich läuft per Knopf in der Verwaltung und zusätzlich alle
 * 15 Minuten im Server-Takt, damit auch spät angelegte Sessions rechtzeitig
 * einen Raum haben.
 */

const CLEANUP_AFTER_MS = 6 * 3600_000;
const AUTO_EVERY_MS = 15 * 60_000;

export function sessionRoomsReady() {
  return discordMissing("sessions").length === 0;
}

type Config = Required<Pick<DiscordConfig, "botToken" | "guildId">> & Partial<DiscordConfig>;

const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "Europe/Berlin" });
const DAY = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
const CLOCK = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

type StoredSession = {
  title: string;
  kind: string;
  date: string;
  time: string;
  minutes: number;
  capacity: number;
  startsAt?: string;
  host?: string;
  cancelled?: boolean;
  discord?: SessionRoom;
};

/** Was im Discord stehen soll. Keine Kontaktdaten, nur der Anzeigename des Hosts. */
export function roomFor(s: StoredSession, config: Partial<DiscordConfig> = {}) {
  const start = sessionStart(s);
  const end = sessionEnd(s);
  const when = `${WEEKDAY.format(start).replace(".", "")} ${DAY.format(start)} ${CLOCK.format(start)}`;
  const base = process.env.APP_URL || "https://dealoperator.hk-growthoperator.de";
  const channelName = `${s.kind} · ${when} · ${s.title}`.slice(0, 100);
  const description = [
    `${s.kind}${s.host ? ` mit ${s.host}` : ""}, ${s.minutes} Minuten, ${s.capacity} Plätze.`,
    `Zusagen und Details: ${new URL("/sessions", base).toString()}`,
  ]
    .join("\n")
    .slice(0, 1000);
  const desired = {
    channelName,
    userLimit: Math.min(99, Math.max(0, s.capacity)),
    name: s.title.slice(0, 100),
    start: start.toISOString(),
    end: end.toISOString(),
    description,
    overwrites: roomOverwrites(config),
  };
  return { ...desired, hash: createHash("sha256").update(JSON.stringify(desired)).digest("hex") };
}

const status = (error: unknown) => (error as { status?: number }).status;

// Discord-Berechtigungen (Bitfelder) für Session-Räume.
const VIEW = 1 << 10;
const CONNECT = 1 << 20;
const SPEAK = 1 << 21;
const MOVE = 1 << 24;

/**
 * Wer einen Session-Raum betreten darf: mit hinterlegter Rolle „Aktiver
 * Caller“ nur diese und die Moderatoren. Sehen können den Raum alle, damit
 * sichtbar ist, was man freischalten kann.
 */
export function roomOverwrites(config: Partial<DiscordConfig>) {
  if (!config.activeRoleId || !config.guildId) return null;
  const join = (VIEW | CONNECT | SPEAK).toString();
  return [
    { id: config.guildId, type: 0, allow: "0", deny: CONNECT.toString() },
    { id: config.activeRoleId, type: 0, allow: join, deny: "0" },
    ...(config.moderatorRoleId
      ? [{ id: config.moderatorRoleId, type: 0, allow: (VIEW | CONNECT | SPEAK | MOVE).toString(), deny: "0" }]
      : []),
  ];
}

async function saveRoom(db: Database, id: string, room: SessionRoom) {
  // Nur das Feld „discord“ ersetzen: eine gleichzeitige Bearbeitung der
  // Session auf der Website geht dabei nicht verloren.
  await db.query(
    "UPDATE sessions SET data=(data::jsonb || jsonb_build_object('discord', $2::jsonb))::text WHERE id=$1",
    [id, JSON.stringify(room)],
  );
}

async function removeQuietly(path: string, config: Config, fetcher?: typeof fetch) {
  try {
    await discordFetch(path, { method: "DELETE", token: config.botToken }, fetcher);
  } catch (error) {
    if (status(error) !== 404) throw error;
  }
}

export async function syncSessionRooms(db: Database, fetcher?: typeof fetch, now = new Date()) {
  const missing = discordMissing("sessions");
  if (missing.length) return { configured: false as const, missing };
  const config = discordConfig() as Config;
  const guild = config.guildId;
  let created = 0,
    updated = 0,
    closed = 0,
    failed = 0;
  const rows = await db.query("SELECT id,data FROM sessions");
  for (const row of rows) {
    const s = JSON.parse(row.data as string) as StoredSession;
    const room: SessionRoom = { ...(s.discord || {}) };
    if (room.closed) continue;
    const end = sessionEnd(s);
    const start = sessionStart(s);
    try {
      // Abgesagt oder längst vorbei: Kanal und Event abräumen.
      if (s.cancelled || end.getTime() + CLEANUP_AFTER_MS < now.getTime()) {
        if (!room.channelId && !room.eventId) continue;
        if (room.eventId)
          await removeQuietly(`/guilds/${guild}/scheduled-events/${room.eventId}`, config, fetcher);
        if (room.channelId) await removeQuietly(`/channels/${room.channelId}`, config, fetcher);
        await saveRoom(db, row.id, { closed: true, syncedAt: now.toISOString() });
        closed++;
        continue;
      }
      // Läuft gerade oder ist eben vorbei: nichts mehr verändern.
      if (end <= now) continue;
      const want = roomFor(s, config);
      if (room.hash === want.hash && room.channelId && (room.eventId || start <= now)) continue;
      let changed = false;
      if (room.channelId) {
        try {
          await discordFetch(
            `/channels/${room.channelId}`,
            {
              method: "PATCH",
              token: config.botToken,
              body: JSON.stringify({
                name: want.channelName,
                user_limit: want.userLimit,
                ...(want.overwrites ? { permission_overwrites: want.overwrites } : {}),
              }),
            },
            fetcher,
          );
          changed = true;
        } catch (error) {
          // Im Discord gelöscht: neu anlegen.
          if (status(error) !== 404) throw error;
          room.channelId = undefined;
          room.eventId = undefined;
          room.eventUrl = undefined;
        }
      }
      if (!room.channelId) {
        const channel = (await discordFetch(
          `/guilds/${guild}/channels`,
          {
            method: "POST",
            token: config.botToken,
            body: JSON.stringify({
              name: want.channelName,
              type: 2,
              user_limit: want.userLimit,
              ...(config.sessionCategoryId ? { parent_id: config.sessionCategoryId } : {}),
              ...(want.overwrites ? { permission_overwrites: want.overwrites } : {}),
            }),
          },
          fetcher,
        )) as { id: string };
        room.channelId = channel.id;
        room.url = `https://discord.com/channels/${guild}/${channel.id}`;
        // Sofort sichern: ein Fehler beim Event legt beim nächsten Mal keinen
        // zweiten Kanal an.
        await saveRoom(db, row.id, room);
        created++;
      }
      // Events brauchen einen Start in der Zukunft.
      if (start > now) {
        const event = {
          name: want.name,
          description: want.description,
          scheduled_start_time: want.start,
          scheduled_end_time: want.end,
        };
        if (room.eventId) {
          try {
            await discordFetch(
              `/guilds/${guild}/scheduled-events/${room.eventId}`,
              { method: "PATCH", token: config.botToken, body: JSON.stringify(event) },
              fetcher,
            );
            changed = true;
          } catch (error) {
            if (status(error) !== 404) throw error;
            room.eventId = undefined;
          }
        }
        if (!room.eventId) {
          const made = (await discordFetch(
            `/guilds/${guild}/scheduled-events`,
            {
              method: "POST",
              token: config.botToken,
              body: JSON.stringify({ ...event, channel_id: room.channelId, entity_type: 2, privacy_level: 2 }),
            },
            fetcher,
          )) as { id: string };
          room.eventId = made.id;
          room.eventUrl = `https://discord.com/events/${guild}/${made.id}`;
        }
      }
      room.hash = want.hash;
      room.syncedAt = now.toISOString();
      await saveRoom(db, row.id, room);
      if (changed) updated++;
    } catch (error) {
      // Eine Session hält die übrigen nicht auf.
      failed++;
      console.error("Discord-Sessions:", (error as Error).message);
    }
  }
  return { configured: true as const, created, updated, closed, failed };
}

/**
 * Eine Rolle im Discord mit einer Menge von Discord-Konten abgleichen. Wer
 * dazukommt, bekommt die Rolle; wer herausfällt, verliert sie, aber nur, wenn
 * der Abgleich sie vergeben hatte (gemerkt in app_settings unter `key`).
 */
async function syncRole(
  db: Database,
  config: Config,
  roleId: string,
  key: string,
  should: Set<string>,
  fetcher?: typeof fetch,
) {
  const [stored] = await db.query("SELECT value FROM app_settings WHERE key=$1", [key]);
  const granted = new Set<string>((stored?.value?.granted as string[] | undefined) ?? []);
  let added = 0,
    removed = 0,
    waiting = 0;
  const path = (user: string) => `/guilds/${config.guildId}/members/${user}/roles/${roleId}`;
  for (const user of should) {
    if (granted.has(user)) continue;
    try {
      await discordFetch(path(user), { method: "PUT", token: config.botToken }, fetcher);
      granted.add(user);
      added++;
    } catch (error) {
      // Noch nicht auf dem Server: beim nächsten Abgleich erneut.
      if (status(error) !== 404) console.error("Discord-Rollen:", (error as Error).message);
      waiting++;
    }
  }
  for (const user of [...granted]) {
    if (should.has(user)) continue;
    try {
      await removeQuietly(path(user), config, fetcher);
      granted.delete(user);
      removed++;
    } catch (error) {
      console.error("Discord-Rollen:", (error as Error).message);
    }
  }
  await db.query(
    `INSERT INTO app_settings(key,value) VALUES($1,$2::jsonb)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
    [key, JSON.stringify({ granted: [...granted] })],
  );
  return { configured: true as const, added, removed, waiting };
}

/** Admins und Moderatoren mit verknüpftem Discord-Konto: Moderatorrolle. */
export async function syncModeratorRoles(db: Database, fetcher?: typeof fetch) {
  const missing = discordMissing("moderators");
  if (missing.length) return { configured: false as const, missing };
  const config = discordConfig() as Config & { moderatorRoleId: string };
  const team = new Set(await teamRecipients(db));
  const links = await db.query("SELECT owner,discord_user_id FROM discord_links");
  const should = new Set(
    links.filter((l) => team.has(l.owner as string)).map((l) => l.discord_user_id as string),
  );
  return syncRole(db, config, config.moderatorRoleId, "discord-moderators", should, fetcher);
}

/** Rang „Aktiver Caller“: freigeschaltet, gehalten, verloren wie auf der Website. */
export async function syncActiveRoles(db: Database, fetcher?: typeof fetch, now = new Date()) {
  const missing = discordMissing("active");
  if (missing.length) return { configured: false as const, missing };
  const config = discordConfig() as Config & { activeRoleId: string };
  const should = await activeDiscordUsers(db, berlinDate(now));
  return syncRole(db, config, config.activeRoleId, "discord-active", should, fetcher);
}

/**
 * Ein Abgleich zur Zeit: Knopf und Server-Takt teilen sich eine Sperre mit
 * Ablauf (fünf Minuten), damit nie zwei Läufe denselben Raum anlegen.
 */
export async function runDiscordRooms(
  db: Database,
  opts: { fetcher?: typeof fetch; now?: Date; auto?: boolean } = {},
) {
  const now = opts.now ?? new Date();
  if (discordMissing("sessions").length)
    return { configured: false as const, missing: discordMissing("sessions") };
  if (opts.auto) {
    const [last] = await db.query("SELECT value FROM app_settings WHERE key='discord-rooms'");
    const at = last?.value?.lastRun ? new Date(last.value.lastRun).getTime() : 0;
    if (now.getTime() - at < AUTO_EVERY_MS) return { configured: true as const, skipped: true };
  }
  const lease = await db.query(
    `INSERT INTO app_settings(key,value) VALUES('discord-rooms-lease',jsonb_build_object('until',$1::text))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()
      WHERE (app_settings.value->>'until')::timestamptz < $2::timestamptz
     RETURNING key`,
    [new Date(now.getTime() + 5 * 60_000).toISOString(), now.toISOString()],
  );
  if (!lease.length) return { configured: true as const, busy: true };
  try {
    const sessions = await syncSessionRooms(db, opts.fetcher, now);
    const roles = await syncModeratorRoles(db, opts.fetcher).catch((e: Error) => ({ error: e.message }));
    const active = await syncActiveRoles(db, opts.fetcher, now).catch((e: Error) => ({ error: e.message }));
    await db.query(
      `INSERT INTO app_settings(key,value) VALUES('discord-rooms',$1::jsonb)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
      [JSON.stringify({ lastRun: now.toISOString(), sessions, roles, active })],
    );
    return { configured: true as const, sessions, roles, active };
  } finally {
    await db.query(
      "UPDATE app_settings SET value=jsonb_build_object('until',$1::text) WHERE key='discord-rooms-lease'",
      [new Date(0).toISOString()],
    );
  }
}

/** Für die Verwaltung: wie viele Sessions haben einen Raum, wie viele warten. */
export async function sessionRoomStatus(db: Database, now = new Date()) {
  const rows = await db.query("SELECT data FROM sessions");
  let withRoom = 0,
    waiting = 0;
  for (const row of rows) {
    const s = JSON.parse(row.data as string) as StoredSession;
    if (s.cancelled || sessionEnd(s) <= now) continue;
    if (s.discord?.url && !s.discord.closed) withRoom++;
    else waiting++;
  }
  const [last] = await db.query("SELECT value FROM app_settings WHERE key='discord-rooms'");
  return {
    withRoom,
    waiting,
    lastRun: (last?.value?.lastRun as string | undefined) ?? null,
  };
}
