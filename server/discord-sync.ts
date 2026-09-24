import { createHash } from "node:crypto";
import type { Database } from "./database";
import { visibleMetrics, metricLabels, type Counts } from "../lib/kpis";
import {
  createReflectionPost,
  deleteReflectionPost,
  discordConfig,
  discordMissing,
  reflectionMessage,
  updateReflectionPost,
  type ReflectionPost,
} from "./discord-bridge";

/**
 * Stillgelegt (23.09.2026): Tagesabschlüsse werden nicht mehr im Discord
 * geteilt; Discord ist für Sessions, Roleplay und die Ränge da
 * (server/discord-sessions.ts). Die Funktion wird nicht mehr aufgerufen und
 * bleibt nur, damit bestehende Beiträge bei Bedarf gezielt abgeräumt werden
 * können.
 *
 * Website → Discord. Liest die bestehende Outbox (eine Zeile je Profil mit
 * Revisionszähler) und bringt freigegebene Tagesabschlüsse als Beitrag in den
 * Reflexions-Channel. Korrekturen bearbeiten den vorhandenen Beitrag.
 *
 * Übertragen wird ausschließlich origin='closing' AND shared AND
 * discord_share (eigene Zustimmung je Abschluss) — nie Entwürfe, Importe,
 * Kontaktdaten oder alte private Reflexionen.
 *
 * Ohne Bot-Token, Guild-ID und Channel bleibt die Outbox unberührt: nichts
 * wird als erledigt markiert, was nicht wirklich übertragen wurde.
 */
export async function syncDiscord(db: Database, fetcher?: typeof fetch) {
  const missing = discordMissing("posts");
  if (missing.length) return { configured: false, missing };
  const config = discordConfig() as Required<ReturnType<typeof discordConfig>>;

  // Beanspruchen mit eigener Frist (leased_until): ein zweiter gleichzeitiger
  // Lauf (Cron und Server-Takt) sieht die Zeilen fünf Minuten lang nicht. Eine
  // neue Einreichung (outbox) verkürzt diese Frist nicht.
  const pending = await db.query(
    `UPDATE sync_outbox SET leased_until=now()+interval '5 minutes'
      WHERE participant IN (
        SELECT participant FROM sync_outbox
         WHERE state='pending' AND next_attempt_at<=now()
           AND (leased_until IS NULL OR leased_until<now())
         ORDER BY updated_at LIMIT 20 FOR UPDATE SKIP LOCKED)
      RETURNING participant,revision`,
  );
  let posted = 0,
    updated = 0,
    removed = 0,
    failed = 0;
  for (const job of pending) {
    let jobFailed = false;
    // Discord-Freigabe zurückgenommen (oder Abschluss nicht mehr geteilt):
    // vorhandenen Beitrag entfernen, Zuordnung löschen.
    const withdrawn = await db.query(
      `SELECT dp.day,dp.channel_id,dp.message_id FROM discord_posts dp
         LEFT JOIN checkins c ON c.participant=dp.participant AND c.day=dp.day
        WHERE dp.participant=$1
          AND (c.participant IS NULL OR NOT (c.origin='closing' AND c.shared AND c.discord_share))`,
      [job.participant],
    );
    for (const w of withdrawn) {
      try {
        await deleteReflectionPost(config, { channelId: w.channel_id, messageId: w.message_id }, fetcher);
        await db.query("DELETE FROM discord_posts WHERE participant=$1 AND day=$2", [job.participant, w.day]);
        removed++;
      } catch (error) {
        jobFailed = true;
        console.error("Discord-Sync (entfernen):", (error as Error).message);
      }
    }
    const rows = await db.query(
      `SELECT c.day,c.counts,c.reflection,c.revision,c.submitted_at,p.name,
              dp.channel_id,dp.message_id,dp.posted_hash
         FROM checkins c JOIN participants p ON p.id=c.participant
         LEFT JOIN discord_posts dp ON dp.participant=c.participant AND dp.day=c.day
        WHERE c.participant=$1 AND c.origin='closing' AND c.shared AND c.discord_share
          AND p.kind='person'
        ORDER BY c.day`,
      [job.participant],
    );
    for (const r of rows) {
      const post = toPost(r as Parameters<typeof toPost>[0]);
      const digest = createHash("sha256").update(reflectionMessage(post)).digest("hex");
      // Inhalt unverändert (auch Name und Zustimmung): nichts zu tun.
      if (r.message_id && r.posted_hash === digest) continue;
      // Kein Nachschub alter Abschlüsse: neue Beiträge nur für die letzten
      // sieben Tage. Vorhandene Beiträge werden weiter nachgezogen.
      if (!r.message_id && new Date(r.submitted_at).getTime() < Date.now() - 7 * 86_400_000) continue;
      try {
        if (r.message_id) {
          try {
            await updateReflectionPost(config, { channelId: r.channel_id, messageId: r.message_id }, post, fetcher);
            await db.query(
              "UPDATE discord_posts SET posted_revision=$3,posted_hash=$4,updated_at=now() WHERE participant=$1 AND day=$2",
              [job.participant, r.day, r.revision, digest],
            );
            updated++;
            continue;
          } catch (error) {
            // Beitrag wurde auf Discord gelöscht: Zuordnung entfernen und neu anlegen.
            if ((error as { status?: number }).status !== 404) throw error;
            await db.query("DELETE FROM discord_posts WHERE participant=$1 AND day=$2", [job.participant, r.day]);
          }
        }
        const created = await createReflectionPost(
          config,
          post,
          fetcher,
          createHash("sha256").update(`${job.participant}:${r.day}`).digest("hex"),
        );
        const stored = await db.query(
          `INSERT INTO discord_posts(participant,day,channel_id,message_id,posted_revision,posted_hash)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(participant,day) DO NOTHING RETURNING message_id`,
          [job.participant, r.day, created.channelId, created.messageId, r.revision, digest],
        );
        // Hat ein anderer Lauf inzwischen einen Beitrag gespeichert, den eben
        // angelegten wieder entfernen — es bleibt genau einer.
        if (!stored.length)
          await deleteReflectionPost(config, { channelId: created.channelId, messageId: created.messageId }, fetcher);
        else posted++;
      } catch (error) {
        // Ein Fehler an einem Tag hält die übrigen Tage nicht auf.
        jobFailed = true;
        console.error("Discord-Sync:", (error as Error).message);
      }
    }
    if (jobFailed) {
      failed++;
      await db.query(
        `UPDATE sync_outbox SET attempts=attempts+1,leased_until=NULL,
           next_attempt_at=now()+make_interval(mins => LEAST(60, power(2, attempts)::int)),
           state=CASE WHEN attempts+1>=8 THEN 'failed' ELSE 'pending' END,updated_at=now()
         WHERE participant=$1`,
        [job.participant],
      );
      continue;
    }
    // Nur erledigen, wenn seitdem nichts Neues dazukam. Sonst bleibt die Zeile
    // offen und wird im nächsten Takt mit der neueren Fassung bearbeitet.
    await db.query(
      `UPDATE sync_outbox SET state=CASE WHEN revision=$2 THEN 'done' ELSE 'pending' END,
         attempts=0,leased_until=NULL,updated_at=now() WHERE participant=$1`,
      [job.participant, job.revision],
    );
  }
  return { configured: true, posted, updated, removed, failed };
}

function toPost(r: {
  day: string;
  counts: Counts;
  reflection: { energy: number; win: string; next: string; help?: string };
  name: string;
}): ReflectionPost {
  const numbers = visibleMetrics
    .filter((m) => r.counts[m] !== null)
    .map((m) => `${r.counts[m]} ${metricLabels[m]}`)
    .join(" · ");
  const base = process.env.APP_URL || "https://dealoperator.hk-growthoperator.de";
  return {
    name: r.name,
    day: `${r.day.slice(8, 10)}.${r.day.slice(5, 7)}.${r.day.slice(0, 4)}`,
    numbers: numbers || null,
    energy: r.reflection.energy,
    win: r.reflection.win,
    next: r.reflection.next,
    // Unterstützungswünsche bleiben beim Team.
    help: "",
    url: new URL(`/reflexionen?tag=${r.day}`, base).toString(),
  };
}
