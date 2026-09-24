import { cancelSession, createSession, editSession, toggleAttendance } from "@/server/sessions";
import { sessionRoomsReady } from "@/server/discord-sessions";
import { teamRecipients } from "@/server/roles";
import { discordDestination } from "@/server/discord";
import { activeCallerFor } from "@/server/active-caller";
import { ACTIVE_MIN_ATTEMPTS, ACTIVE_RUN_DAYS } from "@/lib/active-caller";
import { loadWorkflows, handleWorkflow } from "./workflows";
import { database } from "@/server/database";
import { loadOwnRecords } from "@/server/records";
import { body as readBody, errorResponse } from "@/server/http";
import { AppError, rateLimit } from "@/server/operator";
import { getCurrentUser, isTeam, type Actor } from "@/server/auth";
import type { Database } from "@/server/database";
import { emptyProfile, resources } from "../../data";
import { z } from "zod";
const s = z.string().trim();
const profileSchema = z.object({
  name: s.min(2).max(60),
  role: s.max(80),
  niche: s.min(1).max(80),
  time: z.enum(["Vormittags", "Nachmittags", "Abends", "Flexibel"]),
  bio: s.max(500),
  goal: z.number().int().min(1).max(5000),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  listed: z.boolean(),
  // Ein früher gespeicherter „bevorzugter Kanal“ wird beim Lesen und Speichern
  // verworfen: Treffpunkt für Call-Partner und Sessions ist Discord.
});
const validDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
  );
const sessionSchema = z.object({
  title: s.min(4).max(100),
  kind: z.enum(["Call-Block", "Roleplay", "Reflexion"]),
  date: validDate,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  minutes: z.number().int().min(15).max(180),
  // Der Host legt die Plätze fest; der Discord-Raum übernimmt die Zahl.
  capacity: z.number().int().min(2).max(25),
  // Einen eigenen Raum-Link gibt es nicht mehr: der Raum entsteht im Discord.
  startsAt: z.string().datetime().optional(),
});
/**
 * Sessions & Roleplay sind mit dem Rang „Aktiver Caller“ freigeschaltet. Das
 * Team (Admins, Moderatoren) legt Sessions an und betreut sie immer.
 */
async function requireSessionAccess(database: Database, user: Actor) {
  if (user.admin || user.moderator) return;
  if ((await activeCallerFor(database, user.userId)).active) return;
  throw new AppError(
    `Sessions & Roleplay schaltest du als aktiver Caller frei: ${ACTIVE_RUN_DAYS} Calling-Tage am Stück mit mindestens ${ACTIVE_MIN_ATTEMPTS} Anwahlen.`,
    403,
  );
}
function db() {
  return database();
}
function json(v: unknown, status = 200) {
  return Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
}
async function readPrefs(id: string) {
  const row = await db()
    .prepare("SELECT data FROM preferences WHERE owner = ?")
    .bind(id)
    .first<{ data: string }>();
  return row ? JSON.parse(row.data) : { bookmarks: [], interest: false };
}
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Bitte melde dich zuerst an." }, 401);
  try {
    const database = db();
    const [
      profile,
      records,
      crew,
      sessions,
      rsvps,
      buddies,
      prefs,
      shared,
      workflows,
      team,
    ] = await Promise.all([
      database
        .prepare("SELECT data FROM profiles WHERE id = ?")
        .bind(user.userId)
        .first<{ data: string }>(),
      loadOwnRecords(database, user.userId),
      database
        .prepare(
          "SELECT id,data FROM profiles WHERE (data::jsonb->>'listed') = 'true'",
        )
        .all(),
      database.prepare("SELECT id,owner,data FROM sessions").all(),
      database.prepare("SELECT session,owner FROM rsvps").all(),
      database
        .prepare(
          "SELECT id,sender,recipient,data FROM buddies WHERE sender = ? OR recipient = ?",
        )
        .bind(user.userId, user.userId)
        .all(),
      readPrefs(user.userId),
      database
        .prepare(
          "SELECT r.owner,r.data FROM records r INNER JOIN profiles p ON p.id = r.owner WHERE (r.data::jsonb->>'shared') = 'true' AND (p.data::jsonb->>'listed') = 'true' ORDER BY r.date DESC LIMIT 200",
        )
        .all(),
      loadWorkflows(database, user.userId),
      teamRecipients(database),
    ]);
    const active = await activeCallerFor(database, user.userId);
    // Name und Rolle gibt es nur einmal: aus dem eigenen Profil in der
    // Rangliste. Das Call-Profil ergänzt nur Zielgruppe, Zeit und Tage.
    const [own] = await database.query(
      "SELECT name,role FROM participants WHERE owner=$1 AND kind='person' LIMIT 1",
      [user.userId],
    );
    const stored = profile ? JSON.parse(profile.data) : emptyProfile;
    // Kontakt über Discord nur für Personen, die ihr Call-Profil zeigen und
    // ihr Discord-Konto selbst verknüpft haben. Kein Discord-Name, nur der Link.
    const listedIds = crew.results
      .map((r: any) => r.id as string)
      .filter((id: string) => id !== user.userId);
    const discordLinks = listedIds.length
      ? await database.query(
          "SELECT owner,discord_user_id FROM discord_links WHERE owner = ANY($1::text[])",
          [listedIds],
        )
      : [];
    const discordFor = (owner: string) => {
      const link = discordLinks.find((l) => l.owner === owner);
      const id = link ? String(link.discord_user_id) : "";
      return /^\d{5,25}$/.test(id) ? `https://discord.com/users/${id}` : undefined;
    };
    return json({
      ...workflows,
      // Treffpunkt für Sessions und Call-Partner ist Discord.
      discord: { invite: discordDestination().url, rooms: sessionRoomsReady() },
      viewerTeam: isTeam(user),
      // Rang „Aktiver Caller“: schaltet Sessions & Roleplay frei.
      activeCaller: active,
      profile: own
        ? { ...stored, name: own.name as string, role: (own.role as string) || "" }
        : stored,
      ownProfile: !!own,
      records: records.results.map((r: any) => JSON.parse(r.data)),
      members: crew.results
        .filter((r: any) => r.id !== user.userId)
        // Ein unvollständiges Profil fehlt in der Liste, statt sie für alle
        // zu blockieren.
        .flatMap((r: any) => {
          const parsed = profileSchema.safeParse(JSON.parse(r.data));
          return parsed.success ? [{ row: r, profile: parsed.data }] : [];
        })
        .map(({ row: r, profile: p }: { row: any; profile: z.infer<typeof profileSchema> }) => ({
          id: r.id,
          ...p,
          discord: discordFor(r.id),
          latest: (() => {
            const record = shared.results.find((x: any) => x.owner === r.id);
            if (!record) return undefined;
            const v = JSON.parse(record.data as string);
            return {
              date: v.date,
              attempts: v.attempts,
              conversations: v.conversations,
              meetings: v.meetings,
            };
          })(),
        })),
      sessions: sessions.results.map((r: any) => {
        const { discord, ...data } = JSON.parse(r.data);
        return {
        ...data,
        // Nur der Link in den Discord-Raum, keine internen Kennungen.
        room: discord?.url && !discord.closed ? discord.url : "",
        roomEvent: discord?.eventUrl && !discord.closed ? discord.eventUrl : "",
        team: team.includes(r.owner),
        id: r.id,
        owner: r.owner,
        mine: r.owner === user.userId,
        roster: rsvps.results
          .filter((x: any) => x.session === r.id)
          .map((x: any) => ({
            id: x.owner,
            name: crew.results.find((p: any) => p.id === x.owner)
              ? JSON.parse(
                  (crew.results.find((p: any) => p.id === x.owner) as any).data,
                ).name
              : x.owner === user.userId
                ? "Du"
                : "Caller",
          })),
        attendees: rsvps.results.filter((x: any) => x.session === r.id).length,
        joined: rsvps.results.some(
          (x: any) => x.session === r.id && x.owner === user.userId,
        ),
        };
      }),
      buddies: buddies.results.map((r: any) => ({
        ...JSON.parse(r.data),
        id: r.id,
        from: r.sender,
        to: r.recipient,
        incoming: r.recipient === user.userId,
      })),
      ...prefs,
    });
  } catch {
    return json(
      {
        error:
          "Deine Daten konnten nicht geladen werden. Bitte versuche es erneut.",
      },
      503,
    );
  }
}
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Bitte melde dich zuerst an." }, 401);
  try {
    const body = await readBody(request, 20000);
    const database = db();
    const id = user.userId;
    await rateLimit(database, `community:${id}`, 40);
    const handled = await handleWorkflow(database, id, body);
    if (handled) return handled;
    if (body.action === "profile") {
      const value = profileSchema.parse(body.value);
      await database.transaction(async (tx) => {
        // Name und Rolle ändert nur „Konto und Sichtbarkeit“; hier werden sie
        // aus dem eigenen Profil übernommen, nie umgekehrt.
        const [own] = await tx.query(
          "SELECT name,role FROM participants WHERE owner=$1 AND kind='person' LIMIT 1",
          [id],
        );
        const data = own ? { ...value, name: own.name, role: own.role || "" } : value;
        await tx.query(
          "INSERT INTO profiles (id,data) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          [id, JSON.stringify(data)],
        );
      });
    } else if (body.action === "record" || body.action === "deleteRecord")
      return json(
        {
          error:
            "Bitte den aktuellen Check-in verwenden. Tagesstände werden mit einem Änderungsverlauf korrigiert.",
        },
        409,
      );
    else if (body.action === "bookmark" || body.action === "interest") {
      const prefs = await readPrefs(id);
      if (body.action === "interest")
        prefs.interest = z.boolean().parse(body.value);
      else {
        const rid = z
          .enum(resources.map((r) => r.id) as [string, ...string[]])
          .parse(body.value);
        prefs.bookmarks = prefs.bookmarks.includes(rid)
          ? prefs.bookmarks.filter((x: string) => x !== rid)
          : [...prefs.bookmarks, rid];
      }
      await database
        .prepare(
          "INSERT INTO preferences (owner,data) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data",
        )
        .bind(id, JSON.stringify(prefs))
        .run();
    } else if (body.action === "session" || body.action === "editSession") {
      const value = sessionSchema.parse(body.value);
      if (body.action === "session") await requireSessionAccess(database, user);
      const profile = await database
        .prepare("SELECT data FROM profiles WHERE id = ?")
        .bind(id)
        .first<{ data: string }>();
      if (!profile || !JSON.parse(profile.data).name)
        return json(
          { error: "Lege zuerst dein Profil mit Anzeigenamen an." },
          400,
        );
      if (body.action === "editSession") {
        const sid = s.min(1).parse(body.value.id);
        await editSession(database, { userId: id, team: isTeam(user) }, sid, value);
      } else {
        const created = await createSession(database, id, JSON.parse(profile.data).name, value);
        return json({ ok: true, id: created.id });
      }
    } else if (body.action === "cancelSession") {
      const sid = s.min(1).parse(body.value);
      await cancelSession(database, { userId: id, team: isTeam(user) }, sid);
    } else if (body.action === "rsvp") {
      const sid = s.min(1).max(100).parse(body.value);
      // Absagen geht immer; zusagen nur mit freigeschalteten Sessions.
      const [present] = await database.query("SELECT 1 FROM rsvps WHERE session=$1 AND owner=$2", [sid, id]);
      if (!present) await requireSessionAccess(database, user);
      await toggleAttendance(database, id, sid);
    } else if (body.action === "buddy") {
      const value = z
        .object({ target: s.min(1).max(100), message: s.min(5).max(800) })
        .parse(body.value);
      if (value.target === id)
        return json({ error: "Wähle eine andere Person." }, 400);
      const target = await database
        .prepare(
          "SELECT id FROM profiles WHERE id = ? AND (data::jsonb->>'listed') = 'true'",
        )
        .bind(value.target)
        .first();
      const profile = await database
        .prepare("SELECT data FROM profiles WHERE id = ?")
        .bind(id)
        .first<{ data: string }>();
      if (!target || !profile || !JSON.parse(profile.data).name)
        return json(
          {
            error:
              "Beide Personen benötigen ein Profil. Das Zielprofil muss sichtbar sein.",
          },
          400,
        );
      const existing = await database
        .prepare(
          "SELECT id FROM buddies WHERE ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)) AND (data::jsonb->>'status') IN ('pending','accepted')",
        )
        .bind(id, value.target, value.target, id)
        .first();
      if (existing)
        return json(
          { error: "Du hast dieser Person bereits eine Anfrage geschickt." },
          409,
        );
      await database
        .prepare(
          "INSERT INTO buddies (id,sender,recipient,data) VALUES (?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          id,
          value.target,
          JSON.stringify({
            name: JSON.parse(profile.data).name,
            message: value.message,
            status: "pending",
            peerName: await (async () => {
              const row = await database
                .prepare("SELECT data FROM profiles WHERE id = ?")
                .bind(value.target)
                .first<{ data: string }>();
              return row ? JSON.parse(row.data).name : "Caller";
            })(),
          }),
        )
        .run();
    } else if (body.action === "buddyReply") {
      const value = z
        .object({ id: s.min(1), status: z.enum(["accepted", "declined"]) })
        .parse(body.value);
      const row = await database
        .prepare("SELECT data FROM buddies WHERE id = ? AND recipient = ?")
        .bind(value.id, id)
        .first<{ data: string }>();
      if (!row) return json({ error: "Anfrage nicht gefunden." }, 404);
      if (JSON.parse(row.data).status !== "pending")
        return json({ error: "Diese Anfrage wurde bereits beantwortet." }, 409);
      await database
        .prepare("UPDATE buddies SET data = ? WHERE id = ? AND recipient = ?")
        .bind(
          JSON.stringify({ ...JSON.parse(row.data), status: value.status }),
          value.id,
          id,
        )
        .run();
    } else if (body.action === "registerAccess") {
      const access = await database
        .prepare(
          "SELECT owner FROM entitlements WHERE owner = ? AND expires > ?",
        )
        .bind(id, new Date().toISOString())
        .first();
      if (!access)
        return json(
          {
            error:
              "Für das private Register ist eine gesonderte Freischaltung erforderlich. Es ist noch nicht buchbar.",
          },
          403,
        );
      return json({ entries: [] });
    } else return json({ error: "Unbekannte Aktion." }, 400);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error);
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues[0]?.message || "Bitte prüfe deine Angaben." },
        400,
      );
    return json(
      {
        error:
          "Speichern nicht möglich. Deine Eingabe bleibt erhalten. Bitte erneut versuchen.",
      },
      503,
    );
  }
}
