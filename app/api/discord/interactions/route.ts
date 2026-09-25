import { database, databaseReady } from "@/server/database";
import { discordConfig, verifyDiscordSignature } from "@/server/discord-bridge";
import { ownerForDiscordUser } from "@/server/discord-admin";
import { discordStreakText } from "@/server/commitment-public";

export const dynamic = "force-dynamic";

const MAX_BODY = 20_000;
const EPHEMERAL = 64;

function reply(content: string) {
  return Response.json({
    type: 4,
    data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  });
}

/**
 * Discord-Interactions. Signatur wird VOR dem Lesen des Inhalts geprüft,
 * alte Zeitstempel werden abgelehnt. Antworten sind nur für die fragende
 * Person sichtbar. Zahlen lassen sich hier nicht einreichen — dafür gibt es
 * den Tagesabschluss auf der Website mit derselben Prüfung für alle.
 */
export async function POST(request: Request) {
  const publicKey = discordConfig().publicKey;
  if (!publicKey) return new Response(null, { status: 404 });
  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_BODY) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413 });
  const timestamp = request.headers.get("x-signature-timestamp");
  if (
    !verifyDiscordSignature(publicKey, request.headers.get("x-signature-ed25519"), timestamp, raw) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return new Response("invalid request signature", { status: 401 });

  const interaction = JSON.parse(raw) as {
    type: number;
    data?: { name?: string };
    member?: { user?: { id: string } };
    user?: { id: string };
  };
  if (interaction.type === 1) return Response.json({ type: 1 });

  const site = process.env.APP_URL || "https://dealoperator.hk-growthoperator.de";
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (interaction.type !== 2 || !userId)
    return reply("Diese Aktion kenne ich nicht.");
  if (!databaseReady()) return reply("Deal Operator ist gerade nicht erreichbar.");
  const owner = await ownerForDiscordUser(database(), userId);
  if (!owner)
    return reply(
      `Dein Discord-Konto ist noch nicht mit Deal Operator verknüpft. Verknüpfen kannst du es unter Profil und Einstellungen: ${site}/profil`,
    );
  switch (interaction.data?.name) {
    case "tagesabschluss":
      return reply(`Deinen Tagesabschluss mit Zahlen und kurzer Reflexion trägst du hier ein: ${site}/reflexionen`);
    case "serie":
      return reply(await discordStreakText(database(), owner));
    default:
      return reply(`Alles Weitere findest du auf ${site}.`);
  }
}
