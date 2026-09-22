import type { Database } from "./database";
export async function loadOwnRecords(db: Database, owner: string) {
  const legacy = await db.query("SELECT data FROM records WHERE owner=$1", [
    owner,
  ]);
  const current = await db.query(
    "SELECT c.day,c.counts,c.reflection,c.revision FROM checkins c JOIN participants p ON p.id=c.participant WHERE p.owner=$1 ORDER BY c.day DESC",
    [owner],
  );
  const rows = new Map(
    legacy.map((r) => {
      const v = JSON.parse(r.data);
      return [v.date, v];
    }),
  );
  for (const r of current)
    rows.set(r.day, {
      date: r.day,
      attempts: r.counts.attempts,
      conversations: r.counts.decisionMakerConversations,
      meetings: r.counts.legacyMeetings,
      counts: r.counts,
      revision: r.revision,
      win: "",
      next: "",
      help: "",
      energy: 7,
      ...r.reflection,
      shared: false,
    });
  return {
    results: [...rows.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((data) => ({ data: JSON.stringify(data) })),
  };
}
