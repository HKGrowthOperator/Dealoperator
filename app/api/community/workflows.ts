import type { Database } from "@/server/database";
import { z } from "zod";
import { emptyProfile } from "../../data";
const text = z.string().trim();
const idSchema = text.min(1).max(150);
function result(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
async function nameOf(db: Database, owner: string) {
  const row = await db
    .prepare("SELECT data FROM profiles WHERE id = ?")
    .bind(owner)
    .first<{ data: string }>();
  return row ? JSON.parse(row.data).name : null;
}
async function hasRegister(db: Database, owner: string) {
  return !!(await db
    .prepare("SELECT owner FROM entitlements WHERE owner = ? AND expires > ?")
    .bind(owner, new Date().toISOString())
    .first());
}
export async function loadWorkflows(db: Database, owner: string) {
  const enabled = await hasRegister(db, owner);
  const [posts, comments, messages, relationships, intros] = await Promise.all([
    db
      .prepare(
        "SELECT id,owner,created,data FROM posts WHERE COALESCE((data::jsonb->>'archived'),'false') = 'false' ORDER BY created DESC LIMIT 100",
      )
      .all(),
    db
      .prepare(
        "SELECT c.id,c.post,c.owner,c.created,c.data FROM comments c INNER JOIN posts p ON p.id = c.post WHERE COALESCE((p.data::jsonb->>'archived'),'false') = 'false' ORDER BY c.created LIMIT 1000",
      )
      .all(),
    db
      .prepare(
        "SELECT m.id,m.thread,m.sender,m.created,m.data FROM buddy_messages m INNER JOIN buddies b ON b.id = m.thread WHERE b.sender = ? OR b.recipient = ? ORDER BY m.created LIMIT 1000",
      )
      .bind(owner, owner)
      .all(),
    enabled
      ? db
          .prepare(
            "SELECT id,owner,data FROM relationships WHERE owner = ? OR ((data::jsonb->>'shared') = 'true' AND COALESCE((data::jsonb->>'archived'),'false') = 'false')",
          )
          .bind(owner)
          .all()
      : Promise.resolve({ results: [] }),
    enabled
      ? db
          .prepare(
            "SELECT id,relationship,sender,recipient,data FROM intro_requests WHERE sender = ? OR recipient = ?",
          )
          .bind(owner, owner)
          .all()
      : Promise.resolve({ results: [] }),
  ]);
  return {
    viewerId: owner,
    registerEnabled: enabled,
    posts: posts.results.map((r: any) => ({
      ...JSON.parse(r.data),
      id: r.id,
      owner: r.owner,
      created: r.created,
    })),
    comments: comments.results.map((r: any) => ({
      ...JSON.parse(r.data),
      id: r.id,
      post: r.post,
      owner: r.owner,
      created: r.created,
    })),
    messages: messages.results.map((r: any) => ({
      ...JSON.parse(r.data),
      id: r.id,
      thread: r.thread,
      sender: r.sender,
      created: r.created,
    })),
    relationships: relationships.results.map((r: any) => ({
      ...JSON.parse(r.data),
      id: r.id,
      owner: r.owner,
    })),
    intros: intros.results.map((r: any) => ({
      ...JSON.parse(r.data),
      id: r.id,
      relationship: r.relationship,
      from: r.sender,
      to: r.recipient,
    })),
  };
}
const relationshipSchema = z
  .object({
    id: idSchema.optional(),
    company: text.min(2).max(100),
    sector: text.min(2).max(80),
    region: text.min(2).max(80),
    kind: z.enum([
      "Kundenprojekt",
      "Kooperation",
      "Empfehlung",
      "Gemeinsamer Deal",
    ]),
    year: z.string().regex(/^20\d{2}$/),
    context: text.min(10).max(1500),
    looking: text.max(500),
    intro: z.boolean(),
    shared: z.boolean(),
    consent: z.boolean(),
  })
  .refine(
    (v) => !v.shared || v.consent,
    "Bestätige bitte, dass du diese Angaben teilen darfst.",
  );
export async function handleWorkflow(
  db: Database,
  owner: string,
  body: any,
): Promise<Response | null> {
  const { action, value } = body;
  const now = new Date().toISOString();
  if (action === "plan") {
    const v = z
      .object({
        goal: z.number().int().min(1).max(5000),
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      })
      .parse(value);
    const row = await db
      .prepare("SELECT data FROM profiles WHERE id = ?")
      .bind(owner)
      .first<{ data: string }>();
    const profile = row ? JSON.parse(row.data) : emptyProfile;
    await db
      .prepare(
        "INSERT INTO profiles (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .bind(owner, JSON.stringify({ ...profile, ...v }))
      .run();
    return result({ ok: true });
  }
  if (action === "buddyMessage") {
    const v = z
      .object({ thread: idSchema, body: text.min(1).max(2000) })
      .parse(value);
    const thread = await db
      .prepare(
        "SELECT data FROM buddies WHERE id = ? AND (sender = ? OR recipient = ?)",
      )
      .bind(v.thread, owner, owner)
      .first<{ data: string }>();
    if (!thread)
      return result(
        { error: "Dieses Gespräch ist nicht für dich freigegeben." },
        403,
      );
    if (JSON.parse(thread.data).status !== "accepted")
      return result(
        {
          error:
            "Nachrichten sind möglich, sobald die Buddy-Anfrage angenommen wurde.",
        },
        409,
      );
    const name = await nameOf(db, owner);
    await db
      .prepare(
        "INSERT INTO buddy_messages (id,thread,sender,created,data) VALUES (?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        v.thread,
        owner,
        now,
        JSON.stringify({ name: name || "Mitglied", body: v.body }),
      )
      .run();
    return result({ ok: true });
  }
  if (action === "buddyCancel") {
    const id = idSchema.parse(value);
    const row = await db
      .prepare("SELECT data FROM buddies WHERE id = ? AND sender = ?")
      .bind(id, owner)
      .first<{ data: string }>();
    if (!row) return result({ error: "Anfrage nicht gefunden." }, 404);
    if (JSON.parse(row.data).status !== "pending")
      return result(
        { error: "Nur offene Anfragen können zurückgenommen werden." },
        409,
      );
    await db
      .prepare("UPDATE buddies SET data = ? WHERE id = ? AND sender = ?")
      .bind(
        JSON.stringify({ ...JSON.parse(row.data), status: "cancelled" }),
        id,
        owner,
      )
      .run();
    return result({ ok: true });
  }
  if (action === "post") {
    const v = z
      .object({
        title: text.min(5).max(120),
        body: text.min(10).max(4000),
        category: z.enum(["Learning", "Frage", "Feedback", "Mindset"]),
      })
      .parse(value);
    const name = await nameOf(db, owner);
    if (!name)
      return result(
        { error: "Vervollständige zuerst deinen Anzeigenamen im Profil." },
        400,
      );
    await db
      .prepare("INSERT INTO posts (id,owner,created,data) VALUES (?,?,?,?)")
      .bind(
        crypto.randomUUID(),
        owner,
        now,
        JSON.stringify({ ...v, name, archived: false }),
      )
      .run();
    return result({ ok: true });
  }
  if (action === "comment") {
    const v = z
      .object({ post: idSchema, body: text.min(2).max(2000) })
      .parse(value);
    const target = await db
      .prepare(
        "SELECT id FROM posts WHERE id = ? AND COALESCE((data::jsonb->>'archived'),'false') = 'false'",
      )
      .bind(v.post)
      .first();
    if (!target)
      return result({ error: "Dieser Beitrag ist nicht mehr verfügbar." }, 404);
    const name = await nameOf(db, owner);
    if (!name)
      return result(
        { error: "Vervollständige zuerst deinen Anzeigenamen im Profil." },
        400,
      );
    await db
      .prepare(
        "INSERT INTO comments (id,post,owner,created,data) VALUES (?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        v.post,
        owner,
        now,
        JSON.stringify({ name, body: v.body }),
      )
      .run();
    return result({ ok: true });
  }
  if (action === "archivePost") {
    const id = idSchema.parse(value);
    const row = await db
      .prepare("SELECT data FROM posts WHERE id = ? AND owner = ?")
      .bind(id, owner)
      .first<{ data: string }>();
    if (!row)
      return result(
        { error: "Du kannst nur eigene Beiträge zurückziehen." },
        403,
      );
    await db
      .prepare("UPDATE posts SET data = ? WHERE id = ? AND owner = ?")
      .bind(
        JSON.stringify({ ...JSON.parse(row.data), archived: true }),
        id,
        owner,
      )
      .run();
    return result({ ok: true });
  }
  if (
    ["relationship", "archiveRelationship", "intro", "introReply"].includes(
      action,
    )
  ) {
    if (!(await hasRegister(db, owner)))
      return result(
        {
          error:
            "Das private Partnerregister benötigt eine gesonderte Freischaltung. Die Community bleibt kostenfrei.",
        },
        403,
      );
    if (action === "relationship") {
      const v = relationshipSchema.parse(value);
      const name = await nameOf(db, owner);
      if (!name)
        return result({ error: "Vervollständige zuerst dein Profil." }, 400);
      if (v.id) {
        const row = await db
          .prepare("SELECT id FROM relationships WHERE id = ? AND owner = ?")
          .bind(v.id, owner)
          .first();
        if (!row)
          return result(
            { error: "Du kannst nur eigene Beziehungen bearbeiten." },
            403,
          );
        await db
          .prepare(
            "UPDATE relationships SET data = ? WHERE id = ? AND owner = ?",
          )
          .bind(JSON.stringify({ ...v, name, archived: false }), v.id, owner)
          .run();
      } else
        await db
          .prepare("INSERT INTO relationships (id,owner,data) VALUES (?,?,?)")
          .bind(
            crypto.randomUUID(),
            owner,
            JSON.stringify({ ...v, name, archived: false }),
          )
          .run();
    }
    if (action === "archiveRelationship") {
      const v = z.object({ id: idSchema, archived: z.boolean() }).parse(value);
      const row = await db
        .prepare("SELECT data FROM relationships WHERE id = ? AND owner = ?")
        .bind(v.id, owner)
        .first<{ data: string }>();
      if (!row)
        return result(
          { error: "Du kannst nur eigene Einträge archivieren." },
          403,
        );
      await db
        .prepare("UPDATE relationships SET data = ? WHERE id = ? AND owner = ?")
        .bind(
          JSON.stringify({
            ...JSON.parse(row.data),
            archived: v.archived,
            shared: false,
          }),
          v.id,
          owner,
        )
        .run();
    }
    if (action === "intro") {
      const v = z
        .object({ relationship: idSchema, message: text.min(10).max(1500) })
        .parse(value);
      const row = await db
        .prepare(
          "SELECT owner,data FROM relationships WHERE id = ? AND (data::jsonb->>'shared') = 'true' AND COALESCE((data::jsonb->>'archived'),'false') = 'false'",
        )
        .bind(v.relationship)
        .first<{ owner: string; data: string }>();
      if (!row || row.owner === owner)
        return result(
          {
            error:
              "Diese Beziehung steht für eine Intro-Anfrage nicht zur Verfügung.",
          },
          400,
        );
      const entry = JSON.parse(row.data);
      if (!entry.intro)
        return result(
          { error: "Das Mitglied bietet für diese Beziehung keine Intros an." },
          409,
        );
      const existing = await db
        .prepare(
          "SELECT id FROM intro_requests WHERE relationship = ? AND sender = ? AND (data::jsonb->>'status') = 'pending'",
        )
        .bind(v.relationship, owner)
        .first();
      if (existing)
        return result({ error: "Deine Anfrage ist bereits offen." }, 409);
      const name = await nameOf(db, owner);
      if (!name)
        return result({ error: "Vervollständige zuerst dein Profil." }, 400);
      await db
        .prepare(
          "INSERT INTO intro_requests (id,relationship,sender,recipient,data) VALUES (?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          v.relationship,
          owner,
          row.owner,
          JSON.stringify({
            name,
            target: entry.company,
            message: v.message,
            status: "pending",
            created: now,
          }),
        )
        .run();
    }
    if (action === "introReply") {
      const v = z
        .object({
          id: idSchema,
          status: z.enum(["accepted", "declined"]),
          reply: text.min(2).max(1500),
        })
        .parse(value);
      const row = await db
        .prepare(
          "SELECT data FROM intro_requests WHERE id = ? AND recipient = ?",
        )
        .bind(v.id, owner)
        .first<{ data: string }>();
      if (!row)
        return result(
          { error: "Diese Anfrage ist nicht an dich gerichtet." },
          403,
        );
      await db
        .prepare(
          "UPDATE intro_requests SET data = ? WHERE id = ? AND recipient = ?",
        )
        .bind(
          JSON.stringify({
            ...JSON.parse(row.data),
            status: v.status,
            reply: v.reply,
          }),
          v.id,
          owner,
        )
        .run();
    }
    return result({ ok: true });
  }
  return null;
}
