import { DISCORD_INVITE } from "../lib/discord";

// Official invitation supplied by Nick for the public website.
export function discordDestination() {
  const configured = process.env.DISCORD_INVITE_URL?.trim() || DISCORD_INVITE;
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.protocol === "https:" &&
        (url.hostname === "discord.gg" || url.hostname === "discord.com") &&
        !url.username &&
        !url.password
      )
        return { url: url.toString(), invite: true };
    } catch {
      /* Use the owner-supplied invite if an override is invalid. */
    }
  }
  return { url: DISCORD_INVITE, invite: true };
}
