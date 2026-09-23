import { createPublicKey, verify } from "node:crypto";

/**
 * Discord-Anbindung — vorbereitet, ohne Zugangsdaten nicht aktiv.
 *
 * Website und Discord verwenden EINE Datenquelle: die Tagesabschlüsse in der
 * Datenbank. Discord bekommt nie eine eigene Zählung und kann keine Zahlen
 * ohne vollständige Reflexion einreichen; Befehle dort antworten mit einem
 * Link zur Website.
 *
 * Benötigte Serverumgebung (keiner dieser Werte gehört ins Repository):
 * - DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET  Kontoverknüpfung (OAuth2 „identify“)
 * - DISCORD_BOT_TOKEN, DISCORD_GUILD_ID       Beiträge, Rollen, Channels
 * - DISCORD_REFLECTION_CHANNEL_ID            Ziel-Channel (Text oder Forum)
 * - DISCORD_PUBLIC_KEY                       Signaturprüfung der Interactions
 * - DISCORD_SESSION_CATEGORY_ID              Kategorie für Session-Räume (optional)
 * - DISCORD_MODERATOR_ROLE_ID                Rolle für Admins und Moderatoren
 * - DISCORD_ACTIVE_ROLE_ID                   Rang „Aktiver Caller“
 */
export type DiscordConfig = {
  clientId: string;
  clientSecret: string;
  botToken: string;
  guildId: string;
  reflectionChannelId: string;
  publicKey: string;
  sessionCategoryId: string;
  moderatorRoleId: string;
  activeRoleId: string;
};

const NAMES: Record<keyof DiscordConfig, string> = {
  clientId: "DISCORD_CLIENT_ID",
  clientSecret: "DISCORD_CLIENT_SECRET",
  botToken: "DISCORD_BOT_TOKEN",
  guildId: "DISCORD_GUILD_ID",
  reflectionChannelId: "DISCORD_REFLECTION_CHANNEL_ID",
  publicKey: "DISCORD_PUBLIC_KEY",
  sessionCategoryId: "DISCORD_SESSION_CATEGORY_ID",
  moderatorRoleId: "DISCORD_MODERATOR_ROLE_ID",
  activeRoleId: "DISCORD_ACTIVE_ROLE_ID",
};

export function discordConfig(env = process.env): Partial<DiscordConfig> {
  return Object.fromEntries(
    Object.entries(NAMES)
      .map(([key, name]) => [key, env[name]?.trim() || ""])
      .filter(([, value]) => value),
  ) as Partial<DiscordConfig>;
}

/** Welche Werte für einen Teil der Anbindung fehlen. */
export function discordMissing(
  part: "link" | "posts" | "interactions" | "inventory" | "sessions" | "moderators" | "active",
  env = process.env,
): string[] {
  const config = discordConfig(env);
  const need: (keyof DiscordConfig)[] = {
    link: ["clientId", "clientSecret"] as (keyof DiscordConfig)[],
    posts: ["botToken", "reflectionChannelId", "guildId"] as (keyof DiscordConfig)[],
    interactions: ["publicKey"] as (keyof DiscordConfig)[],
    inventory: ["botToken", "guildId"] as (keyof DiscordConfig)[],
    // Die Kategorie für Session-Räume ist freiwillig.
    sessions: ["botToken", "guildId"] as (keyof DiscordConfig)[],
    moderators: ["botToken", "guildId", "moderatorRoleId"] as (keyof DiscordConfig)[],
    active: ["botToken", "guildId", "activeRoleId"] as (keyof DiscordConfig)[],
  }[part];
  return need.filter((key) => !config[key]).map((key) => NAMES[key]);
}

// ---------------------------------------------------------------------------
// Interactions: Ed25519-Signatur prüfen, bevor irgendetwas gelesen wird.

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  rawBody: string,
): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{64}$/i.test(publicKeyHex))
    return false;
  if (!/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// REST-Aufrufe (API v10). Der Bot-Token verlässt den Server nie.

const API = "https://discord.com/api/v10";

export async function discordFetch(
  path: string,
  init: RequestInit & { token: string },
  fetcher: typeof fetch = fetch,
) {
  const { token, ...rest } = init;
  const response = await fetcher(`${API}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(rest.headers || {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const error = new Error(`Discord antwortet mit ${response.status}.`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

export type ReflectionPost = {
  name: string;
  day: string;
  numbers: string | null;
  energy: number;
  win: string;
  next: string;
  help: string;
  url: string;
};

/** Beitragstext. Keine Kontaktdaten, keine privaten Felder. */
export function reflectionMessage(post: ReflectionPost) {
  const lines = [
    `**${post.name}** · ${post.day}${post.numbers ? ` · ${post.numbers}` : ""}`,
    `Energie ${post.energy}/10`,
    `**Lief richtig gut:** ${post.win}`,
    `**Beim nächsten Calling-Tag besser:** ${post.next}`,
  ];
  if (post.help) lines.push(`**Wünscht sich Unterstützung bei:** ${post.help}`);
  lines.push(post.url);
  // Discord erlaubt 2000 Zeichen je Nachricht.
  const text = lines.join("\n");
  return text.length > 1990 ? `${text.slice(0, 1985)}…` : text;
}

export async function createReflectionPost(
  config: Required<Pick<DiscordConfig, "botToken" | "reflectionChannelId">>,
  post: ReflectionPost,
  fetcher?: typeof fetch,
  /** Gleiche Nonce innerhalb weniger Minuten → Discord legt nichts doppelt an. */
  nonce?: string,
) {
  const message = (await discordFetch(
    `/channels/${config.reflectionChannelId}/messages`,
    {
      method: "POST",
      token: config.botToken,
      body: JSON.stringify({
        content: reflectionMessage(post),
        allowed_mentions: { parse: [] },
        ...(nonce ? { nonce: nonce.slice(0, 25), enforce_nonce: true } : {}),
      }),
    },
    fetcher,
  )) as { id: string; channel_id: string };
  return { channelId: message.channel_id, messageId: message.id };
}

export async function updateReflectionPost(
  config: Required<Pick<DiscordConfig, "botToken">>,
  target: { channelId: string; messageId: string },
  post: ReflectionPost,
  fetcher?: typeof fetch,
) {
  await discordFetch(
    `/channels/${target.channelId}/messages/${target.messageId}`,
    {
      method: "PATCH",
      token: config.botToken,
      body: JSON.stringify({
        content: reflectionMessage(post),
        allowed_mentions: { parse: [] },
      }),
    },
    fetcher,
  );
}

/** Direkter Link zum Beitrag für den Antwort-Knopf. */
/** Zurückgenommene Discord-Freigabe: den Beitrag entfernen. 404 = schon weg. */
export async function deleteReflectionPost(
  config: Required<Pick<DiscordConfig, "botToken">>,
  target: { channelId: string; messageId: string },
  fetcher?: typeof fetch,
) {
  try {
    await discordFetch(
      `/channels/${target.channelId}/messages/${target.messageId}`,
      { method: "DELETE", token: config.botToken },
      fetcher,
    );
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }
}

export function postLink(guildId: string, channelId: string, messageId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** Rollen und Channels des Servers, um sie passend zuzuordnen. */
export async function guildInventory(
  config: Required<Pick<DiscordConfig, "botToken" | "guildId">>,
  fetcher?: typeof fetch,
) {
  const [roles, channels] = await Promise.all([
    discordFetch(`/guilds/${config.guildId}/roles`, { token: config.botToken }, fetcher),
    discordFetch(`/guilds/${config.guildId}/channels`, { token: config.botToken }, fetcher),
  ]);
  return {
    roles: (roles as { id: string; name: string; position: number }[])
      .map(({ id, name, position }) => ({ id, name, position }))
      .sort((a, b) => b.position - a.position),
    channels: (channels as { id: string; name: string; type: number; parent_id: string | null }[])
      .map(({ id, name, type, parent_id }) => ({ id, name, type, parentId: parent_id })),
  };
}

// ---------------------------------------------------------------------------
// Kontoverknüpfung (OAuth2, nur „identify“).

export function authorizeUrl(clientId: string, redirectUri: string, state: string) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "none");
  return url.toString();
}

export async function exchangeIdentity(
  config: Required<Pick<DiscordConfig, "clientId" | "clientSecret">>,
  code: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch,
) {
  const token = await fetcher(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!token.ok) throw Error(`Discord-Anmeldung abgelehnt (${token.status}).`);
  const { access_token } = (await token.json()) as { access_token: string };
  const me = await fetcher(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!me.ok) throw Error(`Discord-Profil nicht lesbar (${me.status}).`);
  const user = (await me.json()) as { id: string; username: string; global_name?: string };
  return { id: user.id, name: user.global_name || user.username };
}
