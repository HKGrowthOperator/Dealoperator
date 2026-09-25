"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, Lock } from "lucide-react";
import ClosingForm, {
  confirmationEffect,
  formatFullDay,
  type ClosingState,
  type Confirmation,
} from "./closing-form";
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
  const [submitted, setSubmitted] = useState<Confirmation | null>(null);
  const [skipped, setSkipped] = useState(false);
  const doneRef = useRef<HTMLElement | null>(null);
  const pending = (status === "open" || status === "draft") && !submitted && !skipped;
  // Nach dem Einreichen verschwindet das Formular samt Knopf; der Fokus geht
  // auf die Bestätigung, damit Tastatur und Vorleser mitkommen.
  useEffect(() => {
    if (submitted) doneRef.current?.focus();
  }, [submitted]);

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
          onSubmitted={(day, confirmation) => {
            if (day !== today) return;
            setSubmitted(confirmation);
            window.scrollTo({ top: 0 });
          }}
        />
      </>
    );

  const done = !!submitted || status === "done";
  const effect = submitted ? confirmationEffect(submitted) : null;
  return (
    <>
      {done && (
        <section className="rf-done" ref={doneRef} tabIndex={-1} role="status">
          <CircleCheck size={20} aria-hidden="true" />
          <div>
            <strong>
              {submitted
                ? submitted.unchanged
                  ? "Keine Änderung nötig, dein Tag steht."
                  : `${formatFullDay(submitted.day)} ist eingereicht.`
                : "Dein Tag ist eingereicht."}
            </strong>
            {effect && !submitted?.unchanged && <p>{effect}</p>}
            {submitted && submitted.levelUps.length > 0 && (
              <p>
                Neues Leistungslevel: {submitted.levelUps.join(", ")}.{" "}
                <Link href="/heute?modus=eigen">Mein Fortschritt</Link>
              </p>
            )}
            <p>
              Hier ist, was bei den anderen heute lief.{" "}
              <Link href={`/tagesabschluss?tag=${today}`}>Eintrag korrigieren</Link>
              {" · "}
              <Link href="/">Zu den Ergebnissen</Link>
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
