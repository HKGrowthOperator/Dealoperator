import type { Database } from "./database";

/** Private, vom Team importierte Quelle. Keine öffentliche E-Mail-Suche. */
export const MEMBER_DIRECTORY_KEY = "akquise_member_directory";

export type PreparedMember = {
  id: string;
  name: string;
  company: string;
  role: string;
  owner: string | null;
  hasReports: boolean;
};

/** Nur nach bestätigter Anmeldung aufrufen; nie mit einer anonymen Adresse. */
export async function preparedMemberForEmail(
  db: Database,
  email: string,
): Promise<PreparedMember | { ambiguous: true } | null> {
  const rows = await db.query(
    `SELECT DISTINCT p.id,p.name,p.company,p.role,p.owner,
       EXISTS(SELECT 1 FROM checkins c WHERE c.participant=p.id) AS "hasReports"
     FROM app_settings s
     CROSS JOIN LATERAL jsonb_each(
       CASE WHEN jsonb_typeof(s.value)='object' THEN s.value ELSE '{}'::jsonb END
     ) e
     JOIN participants p ON p.id=e.value->>'participantId'
     WHERE s.key=$1 AND lower(trim(e.value->>'email'))=$2 AND p.kind='person'
     LIMIT 2`,
    [MEMBER_DIRECTORY_KEY, email.trim().toLowerCase()],
  );
  // Geteilte oder widersprüchliche Adressen sind keine sichere Zuordnung.
  if (rows.length > 1) return { ambiguous: true };
  if (!rows.length) return null;
  return rows[0] as PreparedMember;
}
