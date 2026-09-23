import { z } from "zod";
import type { Database } from "./database";
import { ownerIds, type Actor } from "./auth";
import { AppError, refusePersonalUse } from "./operator";

/**
 * Team-Rollen. Die feste Grundverwaltung (OPERATOR_ADMIN_IDS) lässt sich hier
 * weder ändern noch entfernen; so kann sich niemand versehentlich aussperren.
 * Admins vergeben und entziehen Rollen, Moderatoren sehen die Liste nicht.
 */

export type TeamMember = {
  owner: string;
  role: "owner" | "admin" | "moderator";
  email: string | null;
  name: string | null;
  fixed: boolean;
  grantedAt: string | null;
};

function requireAdmin(actor: Actor) {
  if (!actor.admin)
    throw new AppError("Rollen vergeben kann nur ein Admin.", 403);
}

/**
 * Vor Migration 0004 fehlt die Tabelle. Ein fehlschlagender Zugriff würde die
 * umgebende Transaktion (Registrierung, Pause, Übernahme) abbrechen, deshalb
 * wird vorher nachgesehen statt den Fehler abzufangen.
 */
export async function rolesTable(db: Database) {
  const [row] = await db.query("SELECT to_regclass('operator.team_roles') IS NOT NULL AS ok");
  return !!row?.ok;
}

/** Alle, die Team-Hinweise bekommen: Grundverwaltung, Admins, Moderatoren. */
export async function teamRecipients(db: Database): Promise<string[]> {
  const rows = (await rolesTable(db)) ? await db.query("SELECT owner FROM team_roles") : [];
  return [...new Set([...ownerIds(), ...rows.map((r) => r.owner as string)])];
}

export async function isTeamMember(db: Database, owner: string) {
  if (ownerIds().includes(owner)) return true;
  if (!(await rolesTable(db))) return false;
  const [row] = await db.query("SELECT 1 FROM team_roles WHERE owner=$1", [owner]);
  return !!row;
}

export async function teamList(db: Database, actor: Actor) {
  requireAdmin(actor);
  // Ohne Migration 0004 bleibt die übrige Verwaltung nutzbar; die Liste
  // zeigt dann nur die feste Grundverwaltung.
  const roles = (await rolesTable(db))
    ? await db.query("SELECT owner,role,granted_at FROM team_roles")
    : [];
  const owners = ownerIds();
  const ids = [...new Set([...owners, ...roles.map((r) => r.owner as string)])];
  const people = ids.length
    ? await db.query(
        `SELECT a.owner,a.email,p.name FROM account_private a
           LEFT JOIN participants p ON p.owner=a.owner
          WHERE a.owner = ANY($1::text[])`,
        [ids],
      )
    : [];
  const info = new Map(people.map((p) => [p.owner as string, p]));
  const members: TeamMember[] = ids.map((owner) => {
    const role = owners.includes(owner)
      ? "owner"
      : (roles.find((r) => r.owner === owner)!.role as "admin" | "moderator");
    const granted = roles.find((r) => r.owner === owner)?.granted_at;
    return {
      owner,
      role,
      email: (info.get(owner)?.email as string | undefined) ?? null,
      name: (info.get(owner)?.name as string | undefined) ?? null,
      fixed: role === "owner",
      grantedAt: granted ? new Date(granted).toISOString() : null,
    };
  });
  // Auswahl für neue Rollen: bestätigte Konten, die schon einmal hier waren.
  const accounts = await db.query(
    `SELECT a.owner,a.email,p.name FROM account_private a
       LEFT JOIN participants p ON p.owner=a.owner
      WHERE a.email IS NOT NULL AND a.email<>'' AND a.owner <> ALL($1::text[])
      ORDER BY COALESCE(p.name,a.email) LIMIT 1000`,
    [ids],
  );
  return {
    members,
    accounts: accounts.map((a) => ({ owner: a.owner as string, email: a.email as string, name: (a.name as string) || null })),
    designations: await listDesignations(db, actor),
  };
}

const setRoleSchema = z
  .object({
    owner: z.string().min(1).max(100),
    role: z.enum(["admin", "moderator"]).nullable(),
  })
  .strict();

export async function setTeamRole(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = setRoleSchema.parse(raw);
  if (ownerIds().includes(v.owner))
    throw new AppError(
      "Dieses Konto ist fest als Verwaltung hinterlegt und lässt sich hier nicht ändern.",
      409,
    );
  if (!(await rolesTable(db)))
    throw new AppError("Rollen gehen erst nach der Datenbankänderung 0004.", 503);
  const [account] = await db.query("SELECT owner FROM account_private WHERE owner=$1", [v.owner]);
  if (!account) throw new AppError("Dieses Konto gibt es nicht.", 404);
  if (v.role === null) {
    await db.query("DELETE FROM team_roles WHERE owner=$1", [v.owner]);
    return { ok: true };
  }
  await grantTeamRole(db, v.owner, v.role, actor.userId);
  return { ok: true };
}

/**
 * Rolle eintragen. Gemeinsamer Weg für die direkte Vergabe (setTeamRole) und
 * die freigegebene Übernahme eines vorgemerkten Profils (activateDesignation).
 */
export async function grantTeamRole(
  db: Database,
  owner: string,
  role: "admin" | "moderator",
  grantedBy: string,
) {
  await db.query(
    `INSERT INTO team_roles(owner,role,granted_by) VALUES($1,$2,$3)
     ON CONFLICT(owner) DO UPDATE SET role=excluded.role,granted_by=excluded.granted_by,granted_at=now()`,
    [owner, role, grantedBy],
  );
  // Neue Team-Mitglieder bekommen die kurze E-Mail-Absicherung standardmäßig
  // an ihre bestätigte Adresse; eine vorhandene eigene Wahl bleibt.
  await db.query(
    `INSERT INTO notification_prefs(owner,reminders,team_alerts,team_email,email)
     SELECT owner,true,true,true,email FROM account_private WHERE owner=$1
     ON CONFLICT(owner) DO NOTHING`,
    [owner],
  );
}

// ---------------------------------------------------------------------------
// Vorgemerkte Rollen für Profile ohne Konto
//
// Wer schon ein Profil aus dem Import hat, aber noch kein Konto, lässt sich in
// „Team & Rollen“ nicht auswählen. Ein Admin merkt die Rolle deshalb am Profil
// vor. Sie entsteht erst, wenn das Team die Übernahme genau dieses Profils
// freigibt (decideRequest), in derselben Transaktion; danach ist die
// Vormerkung verbraucht. Gespeichert in app_settings, ohne Schemaänderung:
// { "<Profil-ID>": { role, by, at } }.

export const DESIGNATIONS_KEY = "role-designations";

const storedDesignation = z.object({
  role: z.enum(["admin", "moderator"]),
  by: z.string().min(1),
  at: z.string(),
});
type StoredDesignation = z.infer<typeof storedDesignation>;

export type RoleDesignation = {
  participantId: string;
  role: "admin" | "moderator";
  /** Profilname; null, wenn es das Profil nicht mehr gibt. */
  name: string | null;
  company: string;
  /** Profil ist noch frei und persönlich, eine Übernahme ist also möglich. */
  available: boolean;
  designatedAt: string;
  designatedBy: string;
};

/** Gespeicherte Vormerkungen; ungültige Einträge werden übergangen. */
function parseDesignations(value: unknown) {
  const out = new Map<string, StoredDesignation>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    const parsed = storedDesignation.safeParse(entry);
    if (parsed.success) out.set(id, parsed.data);
  }
  return out;
}

export async function listDesignations(db: Database, actor: Actor): Promise<RoleDesignation[]> {
  requireAdmin(actor);
  const [row] = await db.query("SELECT value FROM app_settings WHERE key=$1", [DESIGNATIONS_KEY]);
  const stored = parseDesignations(row?.value);
  if (!stored.size) return [];
  const ids = [...stored.keys()];
  const by = [...new Set([...stored.values()].map((d) => d.by))];
  const [profiles, admins] = await Promise.all([
    db.query("SELECT id,name,company,kind,owner FROM participants WHERE id = ANY($1::text[])", [ids]),
    db.query(
      `SELECT a.owner,a.email,p.name FROM account_private a
         LEFT JOIN participants p ON p.owner=a.owner
        WHERE a.owner = ANY($1::text[])`,
      [by],
    ),
  ]);
  const profile = new Map(profiles.map((p) => [p.id as string, p]));
  const admin = new Map(admins.map((a) => [a.owner as string, a]));
  return ids
    .map((id) => {
      const d = stored.get(id)!;
      const p = profile.get(id);
      const who = admin.get(d.by);
      return {
        participantId: id,
        role: d.role,
        name: (p?.name as string | undefined) ?? null,
        company: (p?.company as string | undefined) ?? "",
        available: !!p && p.kind === "person" && !p.owner,
        designatedAt: d.at,
        designatedBy: (who?.name as string) || (who?.email as string) || "Admin",
      };
    })
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "de"));
}

const designateSchema = z
  .object({
    participantId: z.string().trim().min(1).max(100),
    role: z.enum(["admin", "moderator"]).nullable(),
  })
  .strict();

/**
 * Rolle für ein Profil ohne Konto vormerken (role) oder die Vormerkung
 * entfernen (null). Nur Admins, wie bei setTeamRole.
 */
export async function designateRole(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = designateSchema.parse(raw);
  if (v.role === null) {
    // Entfernen geht immer, auch wenn das Profil inzwischen fehlt.
    await db.query(
      `UPDATE app_settings SET value=value-($1::text),updated_by=$2,updated_at=now()
        WHERE key=$3 AND jsonb_typeof(value)='object'`,
      [v.participantId, actor.userId, DESIGNATIONS_KEY],
    );
    return { ok: true };
  }
  if (!(await rolesTable(db)))
    throw new AppError("Rollen gehen erst nach der Datenbankänderung 0004.", 503);
  const role = v.role;
  return db.transaction(async (tx) => {
    // Dieselbe Zeilensperre wie bei der Freigabe einer Übernahme: eine
    // gleichzeitige Freigabe läuft entweder vorher (dann hat das Profil einen
    // Eigentümer) oder danach (dann findet sie die Vormerkung).
    const [p] = await tx.query(
      "SELECT id,name,kind,owner FROM participants WHERE id=$1 FOR UPDATE",
      [v.participantId],
    );
    if (!p) throw new AppError("Dieses Profil gibt es nicht.", 404);
    refusePersonalUse(
      p,
      "Das ist eine gemeinsam gemeldete Leistung und kein persönliches Profil. Eine Rolle lässt sich nur für das Profil einer einzelnen Person vormerken.",
    );
    if (p.owner)
      throw new AppError(
        "Dieses Profil gehört bereits zu einem Konto. Vergib die Rolle bitte direkt an das Konto unter „Rolle vergeben“.",
        409,
      );
    const entry: StoredDesignation = { role, by: actor.userId, at: new Date().toISOString() };
    await tx.query(
      `INSERT INTO app_settings(key,value,updated_by) VALUES($1,jsonb_build_object($2::text,$3::jsonb),$4)
       ON CONFLICT(key) DO UPDATE SET
         value=(CASE WHEN jsonb_typeof(app_settings.value)='object' THEN app_settings.value ELSE '{}'::jsonb END)
               || excluded.value,
         updated_by=excluded.updated_by,updated_at=now()`,
      [DESIGNATIONS_KEY, p.id, JSON.stringify(entry), actor.userId],
    );
    return { ok: true, name: p.name as string, role };
  });
}

/**
 * Aufruf ausschließlich aus der Freigabe einer Übernahme durch das Team, in
 * deren Transaktion und nachdem das Profil den neuen Eigentümer bekommen hat.
 * Ist für das Profil eine Rolle vorgemerkt, bekommt der neue Eigentümer sie
 * (vergeben von dem Admin, der sie vorgemerkt hat) und die Vormerkung
 * entfällt. Die feste Grundverwaltung bleibt unberührt, und eine bestehende
 * Admin-Rolle wird nie zur Moderatorrolle herabgestuft.
 */
export async function activateDesignation(tx: Database, participantId: string, owner: string) {
  // Ohne Tabellen (vor Migration 0003/0004) nichts tun, statt die Freigabe
  // abzubrechen.
  const [ready] = await tx.query(
    `SELECT to_regclass('operator.app_settings') IS NOT NULL
        AND to_regclass('operator.team_roles') IS NOT NULL AS ok`,
  );
  if (!ready?.ok) return null;
  const [row] = await tx.query(
    "SELECT value->($2::text) AS entry FROM app_settings WHERE key=$1 FOR UPDATE",
    [DESIGNATIONS_KEY, participantId],
  );
  if (!row?.entry) return null;
  await tx.query(
    "UPDATE app_settings SET value=value-($2::text),updated_at=now() WHERE key=$1",
    [DESIGNATIONS_KEY, participantId],
  );
  const parsed = storedDesignation.safeParse(row.entry);
  if (!parsed.success || ownerIds().includes(owner)) return null;
  const { role, by } = parsed.data;
  const [current] = await tx.query("SELECT role FROM team_roles WHERE owner=$1", [owner]);
  if (current?.role === "admin" && role === "moderator") return null;
  await grantTeamRole(tx, owner, role, by);
  return role;
}
