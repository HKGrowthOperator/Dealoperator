// Telefonnummern werden angegeben, nicht verifiziert. Es gibt in diesem Ablauf
// bewusst keine SMS-Prüfung; die Nummer dient dem Team beim Abgleich mit der
// bereits bekannten Person. Normalisiert wird nach E.164.
const DIGITS = /^\d+$/;

export type PhoneCheck =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * Erwartet eine Nummer mit ausdrücklicher Ländervorwahl. Eine nationale
 * Schreibweise wie 0170… wird abgelehnt, weil sie ohne Land mehrdeutig ist.
 */
export function normalisePhone(input: string): PhoneCheck {
  const raw = (input || "").trim();
  if (!raw) return { ok: false, reason: "Bitte gib deine Telefonnummer an." };
  // Klammern, Bindestriche, Schrägstriche und Leerzeichen sind übliche
  // Schreibweisen und werden entfernt, bevor geprüft wird.
  let value = raw.replace(/[\s()/.-]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (!value.startsWith("+"))
    return {
      ok: false,
      reason:
        "Bitte mit Ländervorwahl angeben, zum Beispiel +49 170 1234567. Eine Nummer wie 0170… lässt sich keinem Land zuordnen.",
    };
  const digits = value.slice(1);
  if (!DIGITS.test(digits))
    return {
      ok: false,
      reason: "Die Telefonnummer darf nur Ziffern und eine Ländervorwahl enthalten.",
    };
  if (digits.startsWith("0"))
    return {
      ok: false,
      reason: "Nach dem + steht die Ländervorwahl, keine führende Null.",
    };
  // E.164 erlaubt höchstens 15 Ziffern. Kürzer als 8 ist für eine Mobil- oder
  // Festnetznummer mit Land nicht plausibel.
  if (digits.length < 8 || digits.length > 15)
    return {
      ok: false,
      reason: "Diese Telefonnummer wirkt unvollständig. Bitte prüfe sie noch einmal.",
    };
  return { ok: true, value: `+${digits}` };
}

/** Für die Verwaltungsansicht: +49170… wird als +49 170… lesbarer dargestellt. */
export function formatPhone(value: string) {
  if (!value.startsWith("+")) return value;
  const digits = value.slice(1);
  const country = digits.slice(0, digits.length > 11 ? 2 : 2);
  return `+${country} ${digits.slice(country.length)}`.trim();
}
