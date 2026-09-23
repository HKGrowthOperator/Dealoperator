import { z } from "zod";
import { AppError } from "./operator";
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json(
      { error: error.issues[0]?.message || "Bitte prüfe die Eingabe." },
      400,
    );
  // Gleichzeitige Änderung an denselben Daten: kein Ausfall, sondern ein
  // Zustand, den ein Neuladen auflöst.
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505" || code === "40P01" || code === "40001")
    return json(
      {
        error:
          "Das wurde gerade gleichzeitig an anderer Stelle geändert. Bitte lade die Seite neu und prüfe den Stand.",
      },
      409,
    );
  return json(
    {
      error:
        "Der Dienst ist gerade nicht verfügbar. Deine Eingabe wurde nicht verworfen.",
    },
    503,
  );
}
export async function body(request: Request, max = 300000) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : new URL(request.url).origin;
  if (!origin || origin !== expected)
    throw new AppError("Diese Anfrage ist nicht erlaubt.", 403);
  const reader = request.body?.getReader();
  let size = 0,
    text = "";
  if (!reader) throw new AppError("Die Eingabe fehlt.");
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new AppError("Die Eingabe ist zu groß.", 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new AppError("Die Eingabe konnte nicht gelesen werden.");
  }
}
