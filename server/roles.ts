import { z } from "zod";
import type { Database } from "./database";
import { ownerIds, type Actor } from "./auth";
import { AppError } from "./operator";

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
async function rolesTable(db: Database) {
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
  const roles = await db.query("SELECT owner,role,granted_at FROM team_roles");
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
      WHERE a.email IS NOT NULL AND a.email<>''
      ORDER BY COALESCE(p.name,a.email) LIMIT 500`,
  );
  return {
    members,
    accounts: accounts
      .filter((a) => !ids.includes(a.owner))
      .map((a) => ({ owner: a.owner as string, email: a.email as string, name: (a.name as string) || null })),
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
  const [account] = await db.query("SELECT owner FROM account_private WHERE owner=$1", [v.owner]);
  if (!account) throw new AppError("Dieses Konto gibt es nicht.", 404);
  if (v.role === null) {
    await db.query("DELETE FROM team_roles WHERE owner=$1", [v.owner]);
    return { ok: true };
  }
  await db.query(
    `INSERT INTO team_roles(owner,role,granted_by) VALUES($1,$2,$3)
     ON CONFLICT(owner) DO UPDATE SET role=excluded.role,granted_by=excluded.granted_by,granted_at=now()`,
    [v.owner, v.role, actor.userId],
  );
  // Neue Team-Mitglieder bekommen die kurze E-Mail-Absicherung standardmäßig
  // an ihre bestätigte Adresse; eine vorhandene eigene Wahl bleibt.
  await db.query(
    `INSERT INTO notification_prefs(owner,reminders,team_alerts,team_email,email)
     SELECT owner,true,true,true,email FROM account_private WHERE owner=$1
     ON CONFLICT(owner) DO NOTHING`,
    [v.owner],
  );
  return { ok: true };
}
