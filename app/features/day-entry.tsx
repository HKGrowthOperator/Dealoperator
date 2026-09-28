"use client";
import { useRouter } from "next/navigation";
import ClosingForm, { confirmationEffect, type ClosingState } from "./closing-form";
import { rememberSubmitted } from "./submitted-note";

/**
 * Das Formular unter Mein Tag. Nach dem Einreichen geht es ohne Umweg zu den
 * Ergebnissen des Tages, mit der eigenen Zeile markiert; die Bestätigung
 * steht dort. Korrekturen und Nachträge laufen über dasselbe Formular.
 */
export default function DayEntry({
  day,
  today,
  initial,
}: {
  day: string;
  today: string;
  initial: ClosingState | null;
}) {
  const router = useRouter();
  return (
    <ClosingForm
      key={day}
      day={day}
      initial={initial}
      syncUrl
      onSubmitted={(submittedDay, confirmation, settings) => {
        rememberSubmitted({
          day: submittedDay,
          unchanged: confirmation.unchanged,
          effect: confirmationEffect(confirmation),
          levelUps: confirmation.levelUps,
          settings,
        });
        router.push(
          submittedDay === today
            ? "/?eingereicht=1"
            : `/?day=${encodeURIComponent(submittedDay)}&eingereicht=1`,
        );
      }}
    />
  );
}
