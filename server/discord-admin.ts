import { randomBytes } from "node:crypto";
import type { Database } from "./database";
import type { Actor } from "./auth";
import { AppError } from "./operator";
import {
  discordConfig,
  discordMissing,
  exchangeIdentity,
  guildInventory,
  type DiscordConfig,
} from "./discord-bridge";

/**
 * Diagnose und Kontoverknüpfung für Discord. Ohne die Zugangsdaten meldet
 * alles ehrlich „nicht eingerichtet“ und nennt die fehlenden Werte — nichts
 * wird als verbunden dargestellt.
 */
export async function discordStatus(db: Database) {
  const [links] = await db.query("SELECT count(*)::int AS n FROM discord_links");
  const [posts] = await db.query("SELECT count(*)::int AS n FROM discord_posts");
  const [outbox] = await db.query(
    "SELECT count(*) FILTER (WHERE state='pending')::int AS pending, count(*) FILTER (WHERE state='failed')::int AS failed FROM sync_outbox",
  );
  return {
    missing: {
      link: discordMissing("link"),
      posts: discordMissing("posts"),
      interactions: discordMissing("interactions"),
      inventory: discordMissing("inventory"),
    },
    linkedAccounts: links.n as number,
    postedReflections: posts.n as number,
    outbox: { pending: outbox.pending as number, failed: outbox.failed as number },
  };
}

/** Rollen und Channels des Servers lesen, um sie zuzuordnen. Nur lesend. */
export async function discordInventory(fetcher?: typeof fetch) {
  const missing = discordMissing("inventory");
  if (missing.length) return { configured: false as const, missing };
  const config = discordConfig() as Required<Pick<DiscordConfig, "botToken" | "guildId">>;
  return { configured: true as const, ...(await guildInventory(config, fetcher)) };
}

export const DISCORD_STATE_COOKIE = "do_discord_state";

export function newState() {
  return randomBytes(32).toString("base64url");
}

export function redirectUri() {
  return new URL("/api/discord/callback", process.env.APP_URL || "http://localhost:3000").toString();
}

/**
 * Eine Discord-Identität gehört genau einem Website-Konto. Ein zweites Konto
 * kann dieselbe Identität nicht übernehmen; ein neues Verknüpfen desselben
 * Kontos ersetzt die alte Identität.
 */
export async function linkDiscord(
  db: Database,
  actor: Actor,
  code: string,
  fetcher?: typeof fetch,
) {
  const missing = discordMissing("link");
  if (missing.length)
    throw new AppError(`Discord-Verknüpfung ist noch nicht eingerichtet (${missing.join(", ")}).`, 503);
  const config = discordConfig() as Required<Pick<DiscordConfig, "clientId" | "clientSecret">>;
  const identity = await exchangeIdentity(config, code, redirectUri(), fetcher);
  return db.transaction(async (tx) => {
    const [taken] = await tx.query(
      "SELECT owner FROM discord_links WHERE discord_user_id=$1 FOR UPDATE",
      [identity.id],
    );
    if (taken && taken.owner !== actor.userId)
      throw new AppError("Dieses Discord-Konto ist bereits mit einem anderen Deal-Operator-Konto verknüpft.", 409);
    await tx.query(
      `INSERT INTO discord_links(owner,discord_user_id,discord_name) VALUES($1,$2,$3)
       ON CONFLICT(owner) DO UPDATE SET discord_user_id=excluded.discord_user_id,
         discord_name=excluded.discord_name,linked_at=now()`,
      [actor.userId, identity.id, identity.name.slice(0, 80)],
    );
    return { ok: true, name: identity.name };
  });
}

export async function unlinkDiscord(db: Database, actor: Actor) {
  await db.query("DELETE FROM discord_links WHERE owner=$1", [actor.userId]);
  return { ok: true };
}

export async function discordLink(db: Database, owner: string) {
  const [row] = await db.query("SELECT discord_name,linked_at FROM discord_links WHERE owner=$1", [owner]);
  return row
    ? { name: row.discord_name as string, since: new Date(row.linked_at).toISOString() }
    : null;
}

/** Website-Konto zu einer Discord-Identität — nur über eine bestehende Verknüpfung. */
export async function ownerForDiscordUser(db: Database, discordUserId: string) {
  const [row] = await db.query("SELECT owner FROM discord_links WHERE discord_user_id=$1", [discordUserId]);
  return (row?.owner as string | undefined) ?? null;
}
