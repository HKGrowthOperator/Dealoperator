import { z } from "zod";
import type { Database } from "./database";
import type { Actor } from "./auth";
import { daySchema, visibleMetrics, type Counts } from "../lib/kpis";
import { eligibility } from "./closing";
import { discordConfig, postLink } from "./discord-bridge";
import { discordDestination } from "./discord";

/**
 * Austausch der Reflexionen.
 *
 * Sichtbar nur für verifizierte Mitglieder: angemeldet (bestätigte E-Mail),
 * gültige Telefonnummer hinterlegt, nutzbares persönliches Profil. Die
 * Prüfung sitzt hier auf dem Server; die Seite zeigt ohne Berechtigung nur
 * die Erklärung, wie man dazukommt.
 *
 * Es erscheinen ausschließlich Abschlüsse, die über den erklärten
 * Einreichvorgang kamen (origin='closing' AND shared). Importe und alte
 * private Reflexionen tauchen nie auf. Zahlen stehen nur auf der Karte, wenn
 * die Person der öffentlichen Anzeige zugestimmt hat.
 */
export const feedQuerySchema = z
  .object({
    day: daySchema.optional(),
    person: z.string().trim().min(1).max(100).optional(),
    before: z.string().max(80).optional(),
  })
  .strict();

export type ReflectionCard = {
  participant: string;
  name: string;
  day: string;
  submittedAt: string;
  numbers: Partial<Counts> | null;
  energy: number;
  win: string;
  next: string;
  help: string;
  reply:
    | { kind: "post"; url: string }
    | { kind: "invite"; url: string };
};

const PAGE = 24;

export async function reflectionFeed(
  db: Database,
  actor: Actor | null,
  raw: unknown,
) {
  const q = feedQuerySchema.parse(raw ?? {});
  const access = await eligibility(db, actor);
  if (!access.eligible)
    return { allowed: false as const, missing: access.missing, cards: [], people: [] };

  // Stabiles Blättern über (Tag, Einreichzeit, Person) statt OFFSET.
  const cursor = q.before ? q.before.split("|") : null;
  const rows = await db.query(
    `SELECT c.participant,c.day,c.counts,c.reflection,c.submitted_at,
            p.name,
            dp.channel_id,dp.message_id
       FROM checkins c
       JOIN participants p ON p.id=c.participant
       LEFT JOIN discord_posts dp ON dp.participant=c.participant AND dp.day=c.day
      WHERE c.origin='closing' AND c.shared AND p.kind='person'
        AND ($1::text IS NULL OR c.day=$1)
        AND ($2::text IS NULL OR c.participant=$2)
        AND ($3::text IS NULL OR (c.day, c.submitted_at, c.participant) < ($3::text, $4::timestamptz, $5::text))
      ORDER BY c.day DESC, c.submitted_at DESC, c.participant DESC
      LIMIT ${PAGE + 1}`,
    [
      q.day ?? null,
      q.person ?? null,
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
      cursor?.[2] ?? null,
    ],
  );
  const people = await db.query(
    `SELECT DISTINCT p.id,p.name FROM checkins c JOIN participants p ON p.id=c.participant
      WHERE c.origin='closing' AND c.shared AND p.kind='person' ORDER BY p.name`,
  );

  const config = discordConfig();
  const invite = discordDestination().url;
  const page = rows.slice(0, PAGE);
  const cards: ReflectionCard[] = page.map((r) => {
    const reflection = r.reflection as {
      energy: number;
      win: string;
      next: string;
      help?: string;
    };
    // Gemeldete Zahlen stehen immer dabei, wie in der Rangliste.
    const numbers = Object.fromEntries(
      visibleMetrics
        .map((m) => [m, (r.counts as Counts)[m]])
        .filter(([, v]) => v !== null),
    ) as Partial<Counts>;
    return {
      participant: r.participant,
      name: r.name,
      day: r.day,
      submittedAt: new Date(r.submitted_at).toISOString(),
      numbers,
      energy: reflection.energy,
      win: reflection.win,
      next: reflection.next,
      // Der Unterstützungswunsch geht nur an das Team (siehe submitClosing).
      help: "",
      // Nur ein tatsächlich gespeicherter Beitrag führt direkt dorthin.
      // Sonst ehrlich: der Einstieg in den Austausch, kein erfundener Thread.
      reply:
        r.message_id && config.guildId
          ? { kind: "post", url: postLink(config.guildId, r.channel_id, r.message_id) }
          : { kind: "invite", url: invite },
    };
  });
  const lastRow = page.at(-1);
  return {
    allowed: true as const,
    missing: [],
    cards,
    people: people.map((p) => ({ id: p.id as string, name: p.name as string })),
    next:
      rows.length > PAGE && lastRow
        ? `${lastRow.day}|${new Date(lastRow.submitted_at).toISOString()}|${lastRow.participant}`
        : null,
  };
}
