"use client";
import { useState } from "react";
import Link from "next/link";
import { CircleCheck, Lock } from "lucide-react";
import ClosingForm, { type ClosingState } from "./closing-form";
import ReflectionFeed, { type ReflectionFeedData } from "./reflection-feed";
import { PushPrompt } from "./push-setup";

export type TodayStatus = "open" | "draft" | "done" | "imported";

/**
 * Erst der eigene Tag, dann die anderen. Solange der eigene Tagesabschluss
 * für heute nicht eingereicht ist, steht hier nur das eigene Blatt. Mit dem
 * Einreichen erscheint an derselben Stelle die Tagesansicht, ohne Scrollen
 * und ohne Seitenwechsel. An Tagen ohne Calling-Pflicht geht es auch ohne
 * Eintrag weiter.
 */
export default function ReflectionGate({
  closing,
  feed,
  today,
  due,
  status,
}: {
  /** Vorgeladener Stand des Tagesabschlusses (das Formular lädt sonst selbst). */
  closing: ClosingState | null;
  /** Vorgeladene Beiträge, wenn der eigene Tag schon steht. */
  feed: ReflectionFeedData | null;
  today: string;
  /** Regulärer Calling-Tag: dann gibt es kein Vorbei am eigenen Eintrag. */
  due: boolean;
  /** Stand des eigenen Tages; null ohne eigenes Profil. */
  status: TodayStatus | null;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const pending = (status === "open" || status === "draft") && !submitted && !skipped;

  if (pending)
    return (
      <>
        <section className="rf-first" aria-labelledby="rf-first-title">
          <h2 id="rf-first-title">Erst dein Tag, dann die anderen.</h2>
          <p>
            Trag deine Zahlen und zwei Sätze ein. Sobald du eingereicht hast, siehst du hier,
            was bei den anderen heute lief.
          </p>
          {!due && (
            <button type="button" className="do-link" onClick={() => setSkipped(true)}>
              Heute ist kein Calling-Tag: Reflexionen ohne eigenen Eintrag lesen
            </button>
          )}
        </section>
        <ClosingForm
          day={today}
          initial={closing}
          // Das Formular kann auch einen früheren Tag einreichen (Nachtrag,
          // offener Calling-Tag): erst der eigene Tag von heute öffnet die anderen.
          onSubmitted={(day) => {
            if (day !== today) return;
            setSubmitted(true);
            window.scrollTo({ top: 0 });
          }}
        />
      </>
    );

  const done = submitted || status === "done";
  return (
    <>
      {done && (
        <section className="rf-done" role="status" aria-live="polite">
          <CircleCheck size={20} aria-hidden="true" />
          <div>
            <strong>Dein Tag ist eingereicht.</strong>
            <p>
              Hier ist, was bei den anderen heute lief.{" "}
              <Link href={`/tagesabschluss?tag=${today}`}>Eintrag korrigieren</Link>
            </p>
          </div>
        </section>
      )}
      {!done && status === "imported" && (
        <section className="rf-done" data-tone="info">
          <Lock size={20} aria-hidden="true" />
          <div>
            <strong>Deine Zahlen für heute hat das Team übernommen.</strong>
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
      {submitted && <PushPrompt settings={closing?.settings} variant="after-submit" />}
      {/* Nach dem Einreichen frisch laden, damit der eigene Beitrag dabei ist. */}
      <ReflectionFeed initial={submitted ? null : feed} />
    </>
  );
}
