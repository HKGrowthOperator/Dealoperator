import { redirect } from "next/navigation";
import { getCurrentUser, isTeam, viewerOf } from "@/server/auth";
import { database, databaseReady } from "@/server/database";
import { closingState } from "@/server/closing";
import { homeState } from "@/server/home";
import { reflectionFeed } from "@/server/reflections";
import { berlinDate, daySchema } from "@/lib/kpis";
import { OperatorHeader, OperatorFooter } from "../features/operator-shell";
import type { ClosingState } from "../features/closing-form";
import type { ReflectionFeedData } from "../features/reflection-feed";
import DayEntry from "../features/day-entry";
import DayView, { type TodayStatus } from "../features/day-view";
import DayProgress from "../features/day-progress";
import "../commitment.css";

export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/** „45 Anwahlen · 1 Setting · 0 Closings“ aus den gemeldeten Zahlen. */
function summaryOf(counts: Record<string, unknown> | null | undefined) {
  if (!counts) return "";
  const n = (k: string) => (typeof counts[k] === "number" ? (counts[k] as number) : null);
  const parts: string[] = [];
  const a = n("attempts");
  const s = n("settingsBooked");
  const c = n("closingsBooked");
  if (a !== null) parts.push(`${a} Anwahlen`);
  if (s !== null) parts.push(`${s} ${s === 1 ? "Setting" : "Settings"}`);
  if (c !== null) parts.push(`${c} ${c === 1 ? "Closing" : "Closings"}`);
  return parts.join(" · ");
}

/**
 * Mein Tag, ein Ort: das Formular für heute ohne Zwischenseite; nach dem
 * Einreichen geht es zu den Ergebnissen. Ist der Tag eingereicht, stehen hier
 * der kurze Stand, Serie und Level und darunter die Reflexionen der anderen
 * (erst der eigene Tag, dann die anderen). Mit ?tag=… derselbe Weg für einen
 * anderen Tag: ansehen, korrigieren, nachtragen. Erinnerungen, Geräte und die
 * Discord-Verknüpfung liegen unter Profil und Einstellungen.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const today = berlinDate();
  const parsed = daySchema.safeParse(one(search.tag));
  const day = parsed.success ? parsed.data : null;
  const actor = await getCurrentUser();
  if (!actor)
    redirect(
      `/anmelden?next=${encodeURIComponent(day ? `/tagesabschluss?tag=${day}` : "/tagesabschluss")}`,
    );
  // Früherer Pfad der Discord-Rückkehr: dorthin, wo die Verknüpfung jetzt liegt.
  if (one(search.discord))
    redirect(`/profil?modus=eigen&discord=${encodeURIComponent(one(search.discord))}`);

  // Vorladen erspart dem Browser einen leeren Zwischenstand. Klappt es nicht,
  // laden Formular und Beiträge selbst und zeigen einen ehrlichen Fehler.
  let initial: ClosingState | null = null;
  let feed: ReflectionFeedData | null = null;
  let name = "";
  let status: TodayStatus | null = null;
  let due = true;
  let summary = "";
  if (databaseReady()) {
    try {
      const db = database();
      const home = await homeState(db, actor, today);
      name = home.participant?.name ?? "";
      status = home.today?.status ?? null;
      due = home.today?.due ?? true;
      const settled = !day && (status === "done" || status === "imported");
      if (settled) {
        // Der eigene Tag steht: die anderen lesen; das Formular braucht es nicht.
        const [row] = await db.query(
          "SELECT counts FROM checkins WHERE participant=$1 AND day=$2",
          [home.participant!.id, today],
        );
        summary = summaryOf(row?.counts as Record<string, unknown> | undefined);
        feed = JSON.parse(JSON.stringify(await reflectionFeed(db, actor, {}))) as ReflectionFeedData;
      } else {
        initial = JSON.parse(
          JSON.stringify(await closingState(db, actor, today.slice(0, 7))),
        ) as ClosingState;
      }
    } catch {
      initial = null;
      feed = null;
    }
  }
  const entering = !!day || (status !== "done" && status !== "imported");

  return (
    <div className="operator-site">
      <OperatorHeader viewer={{ ...viewerOf(actor), hasProfile: !!name, today: status }} />
      <main id="inhalt" className="do-page do-page-narrow md">
        <div className="do-page-head md-page-head">
          <div>
            <h1>Mein Tag</h1>
            <p>
              {name ? (
                <>
                  Du trägst ein als <strong>{name}</strong>.
                </>
              ) : null}
              {entering ? " Zahlen und zwei kurze Antworten, dann zählt dein Tag." : ""}
            </p>
          </div>
        </div>
        {day ? (
          <>
            <DayEntry day={day} today={today} initial={initial} />
            <DayProgress initial={initial} />
          </>
        ) : (
          <DayView
            closing={initial}
            feed={feed}
            today={today}
            due={due}
            status={status}
            summary={summary}
            progress={<DayProgress initial={initial} />}
          />
        )}
      </main>
      <OperatorFooter showAdmin={isTeam(actor)} />
    </div>
  );
}
