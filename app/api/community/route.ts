import {
  addSessionGuest,
  cancelSession,
  createSession,
  editSession,
  removeSessionGuest,
  setSessionRoom,
  toggleAttendance,
} from "@/server/sessions";
import { teamRecipients } from "@/server/roles";
import { activeCallerFor } from "@/server/active-caller";
import { aggregate, progress } from "@/lib/kpis";
import { callRoomOf } from "@/lib/call-room";
import { loadWorkflows, handleWorkflow } from "./workflows";
import { database } from "@/server/database";
import { loadOwnRecords } from "@/server/records";
import { body as readBody, errorResponse } from "@/server/http";
import { AppError, rateLimit } from "@/server/operator";
import { getCurrentUser, isTeam } from "@/server/auth";
import { emptyProfile, resources } from "../../data";
import { z } from "zod";
const s = z.string().trim();
const profileSchema = z.object({
  name: s.min(2).max(60),
  role: s.max(80),
  niche: s.max(80),
  time: z.enum(["Vormittags", "Nachmittags", "Abends", "Flexibel"]),
  bio: s.max(500),
  goal: z.number().int().min(1).max(5000),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  listed: z.boolean(),
  // Discord-Benutzername (neu: 2 bis 32 Zeichen aus a-z, 0-9, _ und .;
  // ältere Namen mit #1234). Freiwillig, nur für Angemeldete sichtbar.
  discordName: s
    .max(40)
    .regex(/^(|[A-Za-z0-9_.]{2,32}(#\d{4})?)$/, "Bitte gib deinen Discord-Namen ohne Leerzeichen an, zum Beispiel max_muster.")
    .optional()
    .default(""),
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
      // Das Team (Admins, Moderatoren) sieht alle Call-Profile, um Call-Partner
      // und Sessions zu vermitteln; alle anderen nur gezeigte.
      database
        .prepare(
          isTeam(user)
            ? "SELECT id,data FROM profiles"
            : "SELECT id,data FROM profiles WHERE (data::jsonb->>'listed') = 'true'",
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
    // Vom Team vorgemerkte Teilnehmer (Profile aus der Rangliste, auch ohne Konto).
    const guestIds = [
      ...new Set(
        sessions.results.flatMap((r: any) => {
          const g = JSON.parse(r.data).guests;
          return Array.isArray(g) ? g.filter((x: unknown) => typeof x === "string") : [];
        }),
      ),
    ] as string[];
    const guestRows = guestIds.length
      ? await database.query("SELECT id,name FROM participants WHERE id = ANY($1::text[])", [guestIds])
      : [];
    const guestName = (id: string) => (guestRows.find((g) => g.id === id)?.name as string) || "Caller";
    // Fürs Team: Profile zum Vormerken (Name und Kennung, sonst nichts).
    const people = isTeam(user)
      ? await database.query("SELECT id,name FROM participants WHERE kind='person' ORDER BY lower(name)")
      : [];
    // Name und Rolle gibt es nur einmal: aus dem eigenen Profil in der
    // Rangliste. Das Call-Profil ergänzt nur Zielgruppe, Zeit und Tage.
    const [own] = await database.query(
      "SELECT name,role FROM participants WHERE owner=$1 AND kind='person' LIMIT 1",
      [user.userId],
    );
    const stored = profile ? JSON.parse(profile.data) : emptyProfile;
    const [verifiedPackages] = await database.query("SELECT value FROM app_settings WHERE key='dealuno_profiles'");
    const packageOf = (owner: string) => {
      const entry = verifiedPackages?.value?.[owner];
      return entry?.active === true && typeof entry.packageName === "string" ? entry.packageName.slice(0,60) : undefined;
    };
    const shownOwners = [...new Set([user.userId, ...crew.results.map((p: any) => String(p.id))])];
    const levelRows = await database.query(
      `SELECT p.owner,c.counts FROM participants p JOIN checkins c ON c.participant=p.id
       WHERE p.owner=ANY($1::text[]) AND p.kind='person'`, [shownOwners],
    );
    const levelsOf = (owner: string) => progress(aggregate(levelRows.filter((v) => v.owner === owner).map((v) => v.counts)))
      .filter((v) => v.level > 0).map((v) => ({ label: v.label, level: v.level }));
    return json({
      ...workflows,
      ownLevels: levelsOf(user.userId),
      ownPackageName: packageOf(user.userId),
      // Calls öffnen Google Meet, ohne Discord-Konto oder Level-Hürde.
      callUrl: callRoomOf(""),
      viewerTeam: isTeam(user),
      viewerRole: user.admin ? "admin" : user.moderator ? "moderator" : null,
      // Der Rang ist ein Profilstatus und keine Zugriffshürde.
      activeCaller: active,
      profile: own
        ? { ...stored, discordName: "", name: own.name as string, role: (own.role as string) || "" }
        : { ...stored, discordName: "" },
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
          levels: levelsOf(r.id),
          packageName: packageOf(r.id),
          discordName: undefined,
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
      people: people.map((p) => ({ id: p.id as string, name: p.name as string })),
      sessions: sessions.results.map((r: any) => {
        const { guests: rawGuests, roomUrl, ...data } = JSON.parse(r.data);
        const guests: string[] = Array.isArray(rawGuests) ? rawGuests.filter((x: unknown) => typeof x === "string") : [];
        return {
        ...data,
        discord: undefined,
        // Ein terminbezogener Google-Link geht vor dem gemeinsamen Raum.
        room: callRoomOf(roomUrl, data.url),
        roomManual: !!roomUrl,
        guests: guests.map((g) => ({ id: g, name: guestName(g) })),

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
          }))
          .concat(guests.map((g) => ({ id: `p:${g}`, name: guestName(g), guest: true }))),
        attendees: rsvps.results.filter((x: any) => x.session === r.id).length + guests.length,
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
    } else if (body.action === "sessionGuest") {
      const value = z
        .object({
          id: s.min(1).max(100),
          participant: s.min(1).max(100).optional(),
          name: s.min(2).max(60).optional(),
        })
        .refine((v) => !!v.participant !== !!v.name)
        .parse(body.value);
      const added = await addSessionGuest(database, { userId: id, team: isTeam(user) }, value.id, value);
      return json({ ok: true, ...added });
    } else if (body.action === "removeSessionGuest") {
      const value = z.object({ id: s.min(1).max(100), participant: s.min(1).max(100) }).parse(body.value);
      await removeSessionGuest(database, { userId: id, team: isTeam(user) }, value.id, value.participant);
    } else if (body.action === "sessionRoom") {
      const value = z.object({ id: s.min(1).max(100), url: z.string().trim().max(300) }).parse(body.value);
      await setSessionRoom(database, { userId: id, team: isTeam(user) }, value.id, value.url);
    } else if (body.action === "cancelSession") {
      const sid = s.min(1).parse(body.value);
      await cancelSession(database, { userId: id, team: isTeam(user) }, sid);
    } else if (body.action === "rsvp") {
      const sid = s.min(1).max(100).parse(body.value);
      // Zusagen und Absagen sind unabhängig vom Level.
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
