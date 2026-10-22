import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import type { Actor } from "./auth";
import { AppError } from "./operator";
import { requireMember } from "./member-access";
import {
  emptyMemberProfile,
  memberProfileSchema,
  type DirectoryMember,
  profileMissing,
  memberOfferSchema,
  type MemberOffer,
} from "../lib/members";
import { normalisePhone } from "../lib/phone";
import { aggregate, progress } from "../lib/kpis";

function stored(data: unknown): Record<string, unknown> {
  try {
    const p = typeof data === "string" ? JSON.parse(data) : data;
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}
/** Do not fall back to signup/import contacts: these are separate fields set by the member. */
export async function directory(db: Database, actor: Actor) {
  await requireNetworkProfile(db, actor);
  const rows =
    await db.query(`SELECT p.id,p.owner,p.name,p.role,p.company,(pr.data::jsonb - 'memberAvatar') AS data,
    coalesce(pr.data::jsonb->>'memberAvatar','')<>'' AS has_avatar
    FROM participants p JOIN profiles pr ON pr.id=p.owner WHERE p.kind='person' AND p.owner IS NOT NULL
    ORDER BY lower(p.name),p.id`);
  const visible = rows.flatMap((row) => {
    const raw = stored(row.data),
      parsed = memberProfileSchema.safeParse(raw.network);
    return parsed.success && (parsed.data.listed || row.owner === actor.userId)
      ? [{ row, raw, profile: parsed.data }]
      : [];
  });
  const owners = visible.map((v) => String(v.row.owner));
  const counts = owners.length
    ? await db.query(
        `SELECT p.owner,c.counts FROM participants p JOIN checkins c ON c.participant=p.id WHERE p.owner=ANY($1::text[]) AND p.kind='person'`,
        [owners],
      )
    : [];
  const [packages] = await db.query(
    "SELECT value FROM app_settings WHERE key='dealuno_profiles'",
  );
  const byOwner = new Map<string, Parameters<typeof aggregate>[0]>();
  for (const item of counts) {
    const key = String(item.owner);
    const entries = byOwner.get(key) || [];
    entries.push(item.counts);
    byOwner.set(key, entries);
  }
  return visible.map(({ row, profile }): DirectoryMember => {
    const pkg = packages?.value?.[row.owner];
    return {
      ...profile,
      id: String(row.id),
      name: String(row.name),
      role: String(row.role || ""),
      mine: row.owner === actor.userId,
      avatarUrl: row.has_avatar
        ? `/api/members/avatar?id=${encodeURIComponent(row.id)}`
        : "",
      levels: progress(aggregate(byOwner.get(String(row.owner)) || []))
        .filter((v) => v.level > 0)
        .map((v) => ({ label: v.label, level: v.level })),
      packageName:
        pkg?.active === true && typeof pkg.packageName === "string"
          ? pkg.packageName.slice(0, 60)
          : "",
    };
  });
}
export async function ownMemberProfile(db: Database, actor: Actor) {
  const access = await requireMember(db, actor);
  const [row] = await db.query("SELECT data FROM profiles WHERE id=$1", [
    actor.userId,
  ]);
  const raw = stored(row?.data),
    published = memberProfileSchema.safeParse(raw.network),
    draft = networkDraftSchema.safeParse(raw.memberNetworkDraft),
    parsed = draft.success
      ? { success: true as const, data: draft.data.profile }
      : published;
  const [contact] = !parsed.success
    ? await db.query("SELECT phone FROM account_private WHERE owner=$1", [
        actor.userId,
      ])
    : [];
  return {
    setupStep: draft.success ? draft.data.step : 0,
    hasCompleteProfile:
      published.success && profileMissing(published.data).length === 0,
    profile: parsed.success
      ? parsed.data
      : {
          ...emptyMemberProfile,
          company: String(access.participant?.company || ""),
          contactEmail: actor.email,
          contactPhone: String(contact?.phone || ""),
        },
    name: String(access.participant?.name || ""),
    avatarUrl:
      raw.memberAvatar && access.participant
        ? `/api/members/avatar?id=${encodeURIComponent(access.participant.id)}`
        : "",
  };
}
export async function saveMemberProfile(
  db: Database,
  actor: Actor,
  input: unknown,
) {
  const value = memberProfileSchema.parse(input);
  if (value.contactPhone) {
    const phone = normalisePhone(value.contactPhone, "DE");
    if (!phone.ok)
      throw new AppError(phone.reason, 400, undefined, "contactPhone");
    value.contactPhone = phone.value;
  }
  if (value.listed && profileMissing(value).length)
    throw new AppError(`Bitte ergänze: ${profileMissing(value).join(", ")}.`);
  await db.transaction(async (tx) => {
    await requireMember(tx, actor);
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `member-profile:${actor.userId}`,
    ]);
    const [p] = await tx.query(
      "SELECT name,role FROM participants WHERE owner=$1 AND kind='person' FOR UPDATE",
      [actor.userId],
    );
    if (!p)
      throw new AppError(
        "Bitte lass zuerst dein persönliches Profil zuordnen.",
        409,
      );
    const [row] = await tx.query(
      "SELECT data FROM profiles WHERE id=$1 FOR UPDATE",
      [actor.userId],
    );
    const old = stored(row?.data);
    delete old.memberNetworkDraft;
    const next = {
      niche: "",
      time: "Flexibel",
      bio: "",
      goal: 100,
      days: [1, 2, 3, 4, 5],
      listed: false,
      ...old,
      name: p.name,
      role: p.role || "",
      network: value,
    };
    await tx.query(
      "INSERT INTO profiles(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      [actor.userId, JSON.stringify(next)],
    );
    await tx.query("UPDATE participants SET company=$2 WHERE owner=$1", [
      actor.userId,
      value.company,
    ]);
  });
  return { ok: true };
}
const avatarSchema = z.object({ data: z.string().max(165000) }).strict();
export function validateAvatar(data: string) {
  if (!data) return;
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new AppError("Bitte ein JPG-Foto auswählen.");
  const bytes = Buffer.from(data.split(",")[1], "base64");
  if (
    bytes.length > 120000 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[2] !== 255 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    throw new AppError("Das Foto konnte nicht verarbeitet werden.");
  let offset = 2,
    dimensions = false;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 255) break;
    const marker = bytes[offset + 1];
    if (marker === 218) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) break;
    if ([192, 193, 194].includes(marker)) {
      if (length < 8) break;
      const h = bytes.readUInt16BE(offset + 5),
        w = bytes.readUInt16BE(offset + 7);
      dimensions = w > 0 && h > 0 && w <= 1024 && h <= 1024;
      break;
    }
    offset += length + 2;
  }
  if (!dimensions)
    throw new AppError(
      "Bitte ein Foto mit höchstens 1024 × 1024 Pixeln verwenden.",
    );
}
export async function saveAvatar(db: Database, actor: Actor, input: unknown) {
  const { data } = avatarSchema.parse(input);
  validateAvatar(data);
  await db.transaction(async (tx) => {
    const access = await requireMember(tx, actor);
    if (!access.participant)
      throw new AppError("Bitte zuerst dein Profil zuordnen.", 409);
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `member-profile:${actor.userId}`,
    ]);
    const [row] = await tx.query(
      "SELECT data FROM profiles WHERE id=$1 FOR UPDATE",
      [actor.userId],
    );
    const old = stored(row?.data);
    await tx.query(
      "INSERT INTO profiles(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      [
        actor.userId,
        JSON.stringify({
          niche: "",
          time: "Flexibel",
          bio: "",
          goal: 100,
          days: [1, 2, 3, 4, 5],
          listed: false,
          ...old,
          name: access.participant.name,
          role: access.participant.role || "",
          memberAvatar: data,
        }),
      ],
    );
  });
  return { ok: true };
}
export async function memberAvatar(db: Database, actor: Actor, id: string) {
  await requireMember(db, actor);
  const [row] = await db.query(
    "SELECT p.owner,pr.data FROM participants p JOIN profiles pr ON pr.id=p.owner WHERE p.id=$1 AND p.kind='person'",
    [id],
  );
  const raw = stored(row?.data),
    p = memberProfileSchema.safeParse(raw.network);
  if (row && row.owner !== actor.userId) await requireNetworkProfile(db, actor);
  if (!row || ((!p.success || !p.data.listed) && row.owner !== actor.userId))
    throw new AppError("Dieses Foto gibt es nicht.", 404);
  if (typeof raw.memberAvatar !== "string" || !raw.memberAvatar)
    throw new AppError("Kein Foto hinterlegt.", 404);
  validateAvatar(raw.memberAvatar);
  return Buffer.from(raw.memberAvatar.split(",")[1], "base64");
}

export async function networkReady(db: Database, actor: Actor) {
  const access = await requireMember(db, actor);
  if (!access.participant && (actor.admin || actor.moderator)) return true;
  const own = await ownMemberProfile(db, actor);
  return own.hasCompleteProfile;
}
export async function requireNetworkProfile(db: Database, actor: Actor) {
  if (!(await networkReady(db, actor)))
    throw new AppError("Vervollständige zuerst dein Mitgliederprofil.", 403);
}
const savedOffer = memberOfferSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  closed: z.boolean(),
});
function offerRows(raw: unknown) {
  const list = stored(raw).memberOffers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const parsed = savedOffer.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
export async function listMemberOffers(
  db: Database,
  actor: Actor,
): Promise<MemberOffer[]> {
  const people = await directory(db, actor);
  const rows = await db.query(
    "SELECT p.id, (pr.data::jsonb - 'memberAvatar' - 'network') AS data FROM participants p JOIN profiles pr ON pr.id=p.owner WHERE p.kind='person' AND p.owner IS NOT NULL",
  );
  const byId = new Map(people.map((m) => [m.id, m]));
  return rows
    .flatMap((r) => {
      const member = byId.get(String(r.id));
      if (!member || !member.listed) return [];
      return offerRows(r.data)
        .filter((o) => !o.closed || member.mine)
        .map((o) => ({ ...o, member }));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/** Lock only the acting owner's JSON row; client IDs never choose the author. */
export async function changeMemberOffer(
  db: Database,
  actor: Actor,
  action: "save" | "close" | "delete",
  input: unknown,
) {
  await requireNetworkProfile(db, actor);
  const value =
    action === "save"
      ? memberOfferSchema.parse(input)
      : z.object({ id: z.string().uuid() }).strict().parse(input);
  return db.transaction(async (tx) => {
    const access = await requireMember(tx, actor);
    if (!access.participant)
      throw new AppError("Bitte zuerst ein persönliches Profil zuordnen.", 409);
    const [row] = await tx.query(
      "SELECT data FROM profiles WHERE id=$1 FOR UPDATE",
      [actor.userId],
    );
    const raw = stored(row?.data),
      profile = memberProfileSchema.safeParse(raw.network);
    if (
      !profile.success ||
      !profile.data.listed ||
      profileMissing(profile.data).length
    )
      throw new AppError(
        "Veröffentliche zuerst dein vollständiges Mitgliederprofil.",
        403,
      );
    let offers = offerRows(raw);
    const index = value.id ? offers.findIndex((o) => o.id === value.id) : -1;
    if (value.id && index < 0)
      throw new AppError(
        "Dieses Angebot gehört nicht zu deinem Profil oder wurde entfernt.",
        404,
      );
    const id = value.id || randomUUID();
    if (action === "save") {
      if (index < 0 && offers.length >= 20)
        throw new AppError(
          "Du kannst bis zu 20 Angebote hinterlegen. Entferne zuerst ein erledigtes Angebot.",
        );
      const fields = memberOfferSchema.parse(value);
      const entry = {
        ...fields,
        id,
        createdAt:
          index < 0 ? new Date().toISOString() : offers[index].createdAt,
        closed: index < 0 ? false : offers[index].closed,
      };
      if (index < 0) offers.push(entry);
      else offers[index] = entry;
    } else if (action === "close")
      offers[index] = { ...offers[index], closed: true };
    else offers = offers.filter((o) => o.id !== id);
    await tx.query("UPDATE profiles SET data=$2 WHERE id=$1", [
      actor.userId,
      JSON.stringify({ ...raw, memberOffers: offers }),
    ]);
    return { ok: true, id };
  });
}

const networkDraftSchema = z
  .object({
    profile: memberProfileSchema,
    step: z.number().int().min(0).max(2),
  })
  .strict();
export async function saveNetworkDraft(
  db: Database,
  actor: Actor,
  input: unknown,
) {
  const draft = networkDraftSchema.parse(input);
  await db.transaction(async (tx) => {
    await requireMember(tx, actor);
    const [row] = await tx.query(
      "SELECT data FROM profiles WHERE id=$1 FOR UPDATE",
      [actor.userId],
    );
    if (!row)
      throw new AppError(
        "Bitte zuerst dein persönliches Profil zuordnen.",
        409,
      );
    await tx.query("UPDATE profiles SET data=$2 WHERE id=$1", [
      actor.userId,
      JSON.stringify({ ...stored(row.data), memberNetworkDraft: draft }),
    ]);
  });
  return { ok: true };
}
