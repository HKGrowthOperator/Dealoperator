/** Gemeinsamer Google-Meet-Raum. Ein vom Team hinterlegter Termin-Link geht vor. */
export const CALL_ROOM_URL = "https://meet.google.com/dki-umso-umr";

export function googleCallLink(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || url.username || url.password || url.port) return "";
    if (!/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)) return "";
    return url.toString();
  } catch { return ""; }
}

export function callRoomOf(manual: unknown, previous: unknown = "") {
  return googleCallLink(manual) || googleCallLink(previous) || CALL_ROOM_URL;
}
