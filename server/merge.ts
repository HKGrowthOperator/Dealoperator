import { z } from "zod";
import type { Database } from "./database";
import type { Actor } from "./auth";
import { AppError, outbox } from "./operator";
import { teamEvent } from "./notify";

/**
 * Zwei Personenprofile zusammenführen. Typischer Fall: jemand legt sich ein
 * neues Profil an, obwohl ein vorbereitetes Profil mit Historie (Import) da
 * ist. „Behalten“ ist das Profil mit der Historie, „Auflösen“ das doppelte.
 * Tage, Fassungen, Entwürfe, Pausen, Discord-Beiträge, Aliasse und Anfragen
 * wandern zum behaltenen Profil, ebenso das Konto; danach ist das aufgelöste
 * Profil weg. Nur für Admins, nur über die Verwaltung, in einer Transaktion.
 */

const schema = z
  .object({ keep: z.string().min(1).max(100), absorb: z.string().min(1).max(100) })
  .strict();

type DayRow = {
  day: string;
  origin: "import" | "closing";
  source: string;
  attempts: number | null;
};
type Side = {
  id: string;
  name: string;
  company: string;
  role: string;
  kind: string;
  importKey: string | null;
  owner: string | null;
  email: string | null;
  claimedAt: string | null;
  eligibleSince: string | null;
  days: DayRow[];
  aliases: number;
  pauses: number;
  drafts: number;
};
/** Was mit einem Tag des aufgelösten Profils passiert. */
export type DayPlan = {
  day: string;
  /** move: übernehmen · replace: ersetzt den übernommenen Stand · drop: entfällt, der eigene Abschluss bleibt */
  action: "move" | "replace" | "drop";
  absorb: { origin: DayRow["origin"]; attempts: number | null };
  keep: { origin: DayRow["origin"]; attempts: number | null } | null;
};

function requireAdmin(actor: Actor) {
  if (!actor.admin) throw new AppError("Profile zusammenführen kann nur ein Admin.", 403);
}

async function load(db: Database, id: string): Promise<Side | null> {
  const [p] = await db.query(
    `SELECT id,name,company,role,kind,import_key,owner,email,claimed_at,eligible_since,
       (SELECT count(*) FROM participant_aliases a WHERE a.participant=p.id)::int AS aliases,
       (SELECT count(*) FROM pauses x WHERE x.participant=p.id)::int AS pauses,
       (SELECT count(*) FROM checkin_drafts x WHERE x.participant=p.id)::int AS drafts
     FROM participants p WHERE id=$1`,
    [id],
  );
  if (!p) return null;
  const days = await db.query(
    "SELECT day,origin,source,counts->>'attempts' AS attempts FROM checkins WHERE participant=$1 ORDER BY day",
    [id],
  );
  return {
    id: p.id as string,
    name: p.name as string,
    company: p.company as string,
    role: p.role as string,
    kind: p.kind as string,
    importKey: (p.import_key as string | null) ?? null,
    owner: (p.owner as string | null) ?? null,
    email: (p.email as string | null) ?? null,
    claimedAt: p.claimed_at ? new Date(p.claimed_at).toISOString() : null,
    eligibleSince: p.eligible_since ? new Date(p.eligible_since).toISOString() : null,
    days: days.map((d) => ({
      day: d.day as string,
      origin: d.origin as DayRow["origin"],
      source: d.source as string,
      attempts: d.attempts === null || d.attempts === undefined ? null : Number(d.attempts),
    })),
    aliases: p.aliases as number,
    pauses: p.pauses as number,
    drafts: p.drafts as number,
  };
}

function check(keep: Side | null, absorb: Side | null, v: z.infer<typeof schema>) {
  if (v.keep === v.absorb) throw new AppError("Bitte zwei verschiedene Profile wählen.");
  if (!keep || !absorb) throw new AppError("Eines der Profile gibt es nicht mehr.", 404);
  if (keep.kind !== "person" || absorb.kind !== "person")
    throw new AppError("Gemeinsame Meldungen lassen sich nicht zusammenführen.");
  if (keep.owner && absorb.owner && keep.owner !== absorb.owner)
    throw new AppError(
      "Beide Profile haben ein eigenes Konto. Erst muss eines der Konten sein Profil abgeben; zwei Konten lassen sich nicht zu einem machen.",
      409,
    );
  return { keep, absorb };
}

/**
 * Je Tag des aufgelösten Profils: ohne Gegenstück übernehmen; der eigene
 * Abschluss schlägt einen übernommenen Stand; bei zwei eigenen Abschlüssen
 * oder zwei Importen bleibt der Stand des behaltenen Profils.
 */
function planDays(keep: Side, absorb: Side): DayPlan[] {
  const own = new Map(keep.days.map((d) => [d.day, d]));
  return absorb.days.map((d) => {
    const other = own.get(d.day);
    const action: DayPlan["action"] = !other
      ? "move"
      : d.origin === "closing" && other.origin === "import"
        ? "replace"
        : "drop";
    return {
      day: d.day,
      action,
      absorb: { origin: d.origin, attempts: d.attempts },
      keep: other ? { origin: other.origin, attempts: other.attempts } : null,
    };
  });
}

function summary(side: Side) {
  return {
    id: side.id,
    name: side.name,
    company: side.company,
    hasOwner: !!side.owner,
    importKey: side.importKey,
    claimedAt: side.claimedAt,
    eligibleSince: side.eligibleSince,
    days: side.days.length,
    firstDay: side.days[0]?.day ?? null,
    lastDay: side.days.at(-1)?.day ?? null,
    aliases: side.aliases,
    pauses: side.pauses,
    drafts: side.drafts,
  };
}

export async function mergePreview(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = schema.parse(raw);
  const { keep, absorb } = check(await load(db, v.keep), await load(db, v.absorb), v);
  return {
    keep: summary(keep),
    absorb: summary(absorb),
    days: planDays(keep, absorb),
    /** Woher das Konto nach dem Zusammenführen kommt. */
    owner: keep.owner ? "keep" : absorb.owner ? "absorb" : "none",
  };
}

export async function mergeParticipants(db: Database, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const v = schema.parse(raw);
  return db.transaction(async (tx) => {
    // Beide Zeilen sperren, in fester Reihenfolge, damit sich zwei Admins
    // nicht gegenseitig blockieren.
    await tx.query("SELECT id FROM participants WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE", [
      [v.keep, v.absorb],
    ]);
    const { keep, absorb } = check(await load(tx, v.keep), await load(tx, v.absorb), v);
    const plan = planDays(keep, absorb);
    const counts = { move: 0, replace: 0, drop: 0 };
    for (const d of plan) {
      counts[d.action]++;
      if (d.action === "drop") {
        await tx.query("DELETE FROM checkins WHERE participant=$1 AND day=$2", [absorb.id, d.day]);
        await tx.query("DELETE FROM discord_posts WHERE participant=$1 AND day=$2", [absorb.id, d.day]);
        continue;
      }
      if (d.action === "replace")
        await tx.query("DELETE FROM checkins WHERE participant=$1 AND day=$2", [keep.id, d.day]);
      // Ein Discord-Beitrag des behaltenen Profils an diesem Tag würde die
      // Übernahme blockieren; der Beitrag zum übernommenen Tag zählt.
      await tx.query("DELETE FROM discord_posts WHERE participant=$1 AND day=$2", [keep.id, d.day]);
      await tx.query("UPDATE checkins SET participant=$1 WHERE participant=$2 AND day=$3", [
        keep.id,
        absorb.id,
        d.day,
      ]);
      await tx.query("UPDATE discord_posts SET participant=$1 WHERE participant=$2 AND day=$3", [
        keep.id,
        absorb.id,
        d.day,
      ]);
    }
    // Alle Fassungen bleiben nachvollziehbar, auch die entfallener Tage.
    await tx.query("UPDATE checkin_revisions SET participant=$1 WHERE participant=$2", [keep.id, absorb.id]);
    // Entwürfe: der des behaltenen Profils hat Vorrang.
    await tx.query(
      `DELETE FROM checkin_drafts d WHERE d.participant=$2
         AND EXISTS (SELECT 1 FROM checkin_drafts k WHERE k.participant=$1 AND k.day=d.day)`,
      [keep.id, absorb.id],
    );
    await tx.query("UPDATE checkin_drafts SET participant=$1 WHERE participant=$2", [keep.id, absorb.id]);
    await tx.query("UPDATE pauses SET participant=$1 WHERE participant=$2", [keep.id, absorb.id]);
    await tx.query("UPDATE claim_tokens SET participant=$1 WHERE participant=$2", [keep.id, absorb.id]);
    try {
      await tx.query("UPDATE onboarding_requests SET participant=$1 WHERE participant=$2", [
        keep.id,
        absorb.id,
      ]);
    } catch {
      throw new AppError(
        "Für beide Profile laufen noch offene Übernahmeanfragen. Bitte zuerst entscheiden, dann zusammenführen.",
        409,
      );
    }
    await tx.query("UPDATE participant_aliases SET participant=$1 WHERE participant=$2", [keep.id, absorb.id]);
    // Der aufgelöste Name bleibt als Alias, damit spätere Importe richtig landen.
    if (absorb.name.trim() && absorb.name.trim() !== keep.name.trim())
      await tx.query(
        "INSERT INTO participant_aliases(alias,participant,created_by) VALUES($1,$2,$3) ON CONFLICT(alias) DO NOTHING",
        [absorb.name.trim(), keep.id, actor.userId],
      );
    await tx.query("DELETE FROM sync_outbox WHERE participant=$1", [absorb.id]);
    // Konto und Import-Schlüssel sind eindeutig: erst das aufgelöste Profil
    // löschen, dann das behaltene ergänzen. Konto, Kontakt und Beginn der
    // Erfassung wandern mit; Firma und Rolle nur in Lücken. LEAST übergeht
    // NULL, der frühere Beginn gilt.
    await tx.query("DELETE FROM participants WHERE id=$1", [absorb.id]);
    await tx.query(
      `UPDATE participants SET
         owner=COALESCE(owner,$2), email=COALESCE(email,$3),
         claimed_at=COALESCE(claimed_at,$4::timestamptz),
         eligible_since=LEAST(eligible_since,$5::timestamptz),
         company=CASE WHEN company='' THEN $6 ELSE company END,
         role=CASE WHEN role='' THEN $7 ELSE role END,
         import_key=COALESCE(import_key,$8),
         public_consent=true, searchable=true
       WHERE id=$1`,
      [
        keep.id,
        absorb.owner,
        absorb.email,
        absorb.claimedAt,
        absorb.eligibleSince,
        absorb.company,
        absorb.role,
        absorb.importKey,
      ],
    );
    await outbox(tx, keep.id);
    await teamEvent(tx, {
      dedupeKey: `merge:${absorb.id}`,
      kind: "merge",
      ref: keep.id,
      state: "done",
      title: `Profile zusammengeführt: ${keep.name}`,
      body: `„${absorb.name}“ ist in „${keep.name}“ aufgegangen: ${counts.move} Tag(e) übernommen, ${counts.replace} übernommene(r) Stand/Stände durch eigene Abschlüsse ersetzt, ${counts.drop} Tag(e) entfallen.${absorb.owner && !keep.owner ? " Das Konto hängt jetzt am behaltenen Profil." : ""}`,
      alert: false,
      done: true,
    });
    return { ok: true, keep: keep.id, ...counts };
  });
}
