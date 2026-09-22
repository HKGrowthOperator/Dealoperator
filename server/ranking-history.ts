import type { Database } from "./database";
import { countsSchema, participantKind } from "../lib/kpis";
import {
  monthRange,
  summarizeRankingMonth,
  type DatedRankingRow,
} from "../lib/ranking-history";

export async function publicRankingMonth(
  db: Database,
  month: string,
  day?: string,
) {
  const { from, to } = monthRange(month);
  // One bounded query keeps the ranking, group totals and daily history on the
  // same database snapshot. No contacts, reflections or unapproved profiles.
  const rows = await db.query(
    `SELECT p.id,p.name,p.company,p.role,p.kind,p.owner IS NOT NULL AS claimed,
      c.day,c.counts,c.updated_at
     FROM participants p JOIN checkins c ON c.participant=p.id
     WHERE p.public_consent=true AND c.day >= $1 AND c.day <= $2
     ORDER BY c.day,c.updated_at DESC`,
    [from, to],
  );
  const records: DatedRankingRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    company: r.company,
    role: r.role,
    kind: participantKind(r.kind),
    claimed: r.claimed,
    day: r.day,
    counts: {
      ...countsSchema.parse(r.counts),
      decisionMakerConversations: null,
    },
    source: "Selbst gemeldet",
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
  return summarizeRankingMonth(records, month, day);
}
