"use client";
import ClosingForm from "./closing-form";

/**
 * Früher „Check-in speichern“ über /api/operator. Der Check-in ist jetzt der
 * Tagesabschluss: Zahlen und Reflexion gemeinsam, eingereicht über
 * /api/closing. Dieser Baustein reicht nur noch an das neue Formular weiter,
 * damit bestehende Stellen ihn weiter einbinden können.
 */
export default function CheckinEditor({
  initialDate,
  onSubmitted,
}: {
  /** Leistungstag (YYYY-MM-DD). Standard: heute. */
  initialDate?: string;
  onSubmitted?: (day: string) => void | Promise<void>;
}) {
  return (
    <ClosingForm
      day={initialDate}
      onSubmitted={(day) => {
        void onSubmitted?.(day);
      }}
    />
  );
}
