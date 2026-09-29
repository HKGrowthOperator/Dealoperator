/**
 * Offizieller Einladungslink, von Nick für die öffentliche Website bestätigt.
 *
 * Steht in lib/, weil ihn sowohl der Server (server/discord.ts, prüft eine
 * mögliche Umgebungsvariable) als auch Oberflächenbausteine im Browser
 * brauchen. Kein Geheimnis: der Link ist öffentlich.
 */
export const DISCORD_INVITE = "https://discord.gg/NjkFJtBkZm";

/**
 * Fester Raum für jede Roleplay-Session (auf Wunsch, 29.09.2026). Roleplay
 * bekommt keinen eigenen Raum vom Abgleich und keinen Hand-Link.
 */
export const ROLEPLAY_ROOM = "https://discord.gg/sp75ZrWahH";

/**
 * Raum-Link einer Session für die Oberfläche. Roleplay immer im festen Raum;
 * sonst geht ein vom Abgleich angelegter Raum vor dem Hand-Link.
 */
export function sessionRoomOf(
  kind: string,
  discord: { url?: string; closed?: boolean } | null | undefined,
  roomUrl: unknown,
) {
  if (kind === "Roleplay") return { room: ROLEPLAY_ROOM, roomManual: false };
  const synced = discord?.url && !discord.closed ? discord.url : "";
  const manual = typeof roomUrl === "string" ? roomUrl : "";
  return { room: synced || manual, roomManual: !synced && !!manual };
}
