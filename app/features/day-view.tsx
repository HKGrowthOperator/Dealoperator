"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, Lock, PencilLine } from "lucide-react";
import ClosingForm, { confirmationEffect, type ClosingState } from "./closing-form";
import ReflectionFeed, { type ReflectionFeedData } from "./reflection-feed";
import { rememberSubmitted } from "./submitted-note";

export type TodayStatus = "open" | "draft" | "done" | "imported";

/**
 * Mein Tag für heute, ein Ort: erst der eigene Tag, dann die anderen. Solange
 * der Tag offen ist, steht hier nur das Formular; mit dem Einreichen geht es
 * zu den Ergebnissen. Ist der Tag eingereicht oder übernommen, steht oben der
 * kurze Stand mit dem Weg zur Korrektur und darunter, was bei den anderen
 * lief. An Tagen ohne Calling-Pflicht geht es auch ohne eigenen Eintrag weiter.
 */
export default function DayView({
  closing,
  feed,
  today,
  due,
  status,
  summary,
  progress,
}: {
  /** Vorgeladener Stand des Tagesabschlusses (das Formular lädt sonst selbst). */
  closing: ClosingState | null;
  /** Vorgeladene Beiträge, wenn der eigene Tag schon steht. */
  feed: ReflectionFeedData | null;
  today: string;
  /** Regulärer Calling-Tag: dann gibt es kein Vorbei am eigenen Eintrag. */
  due: boolean;
  /** Stand des eigenen Tages; null ohne eigenes Profil (das Formular nennt dann, was fehlt). */
  status: TodayStatus | null;
  /** Die eingereichten Zahlen in einer Zeile, z. B. „45 Anwahlen · 1 Setting · 0 Closings“. */
  summary: string;
  /** Serie und Level, kompakt: unter dem Formular, bei eingereichtem Tag am Ende. */
  progress?: React.ReactNode;
}) {
  const router = useRouter();
  const [skipped, setSkipped] = useState(false);
  const pending = status !== "done" && status !== "imported" && !skipped;

  if (pending)
    return (
      <>
        <ClosingForm
          day={today}
          initial={closing}
          syncUrl
          onSubmitted={(day, confirmation, settings) => {
            rememberSubmitted({
              day,
              unchanged: confirmation.unchanged,
              effect: confirmationEffect(confirmation),
              levelUps: confirmation.levelUps,
              settings,
            });
            // Direkt dorthin, wo der Tag zählt: die Ergebnisse, eigene Zeile markiert.
            router.push(
              day === today ? "/?eingereicht=1" : `/?day=${encodeURIComponent(day)}&eingereicht=1`,
            );
          }}
        />
        {!due && status !== null && (
          <p className="md-skip">
            <button type="button" className="do-link" onClick={() => setSkipped(true)}>
              Heute ist kein Calling-Tag: ohne eigenen Eintrag lesen, was bei den anderen lief
            </button>
          </p>
        )}
        {progress}
      </>
    );

  return (
    <>
      {status === "done" && (
        <section className="rf-done" role="status">
          <CircleCheck size={20} aria-hidden="true" />
          <div>
            <strong>Dein Tag ist drin{summary ? `: ${summary}.` : "."}</strong>
            <p>
              <Link href={`/tagesabschluss?tag=${today}`}>
                <PencilLine size={14} aria-hidden="true" /> Eintrag ansehen oder korrigieren
              </Link>
            </p>
          </div>
        </section>
      )}
      {status === "imported" && (
        <section className="rf-done" data-tone="info">
          <Lock size={20} aria-hidden="true" />
          <div>
            <strong>Deine Zahlen für heute hat das Team übernommen{summary ? `: ${summary}.` : "."}</strong>
            <p>
              <Link href={`/tagesabschluss?tag=${today}`}>Übernommene Zahlen ansehen</Link>
            </p>
          </div>
        </section>
      )}
      {skipped && (
        <section className="rf-done" data-tone="info">
          <div>
            <strong>Heute ist kein Calling-Tag.</strong>
            <p>
              Ein Eintrag ist freiwillig und zählt als Bonus.{" "}
              <button type="button" className="rf-inline" onClick={() => setSkipped(false)}>
                Trotzdem eintragen
              </button>
            </p>
          </div>
        </section>
      )}
      <h2 className="md-others" id="andere">
        Was bei den anderen heute lief
      </h2>
      <ReflectionFeed initial={feed} />
      {progress}
    </>
  );
}
