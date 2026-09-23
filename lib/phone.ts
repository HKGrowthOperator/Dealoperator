// Telefonnummern werden angegeben, nicht verifiziert. Es gibt in diesem Ablauf
// bewusst keine SMS-Prüfung; die Nummer dient dem Team beim Abgleich mit der
// bereits bekannten Person. Normalisiert wird nach E.164.
const DIGITS = /^\d+$/;

export type PhoneCheck =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * Auswahl im Formular. trunk: Die nationale Schreibweise beginnt mit einer 0,
 * die international entfällt (0170 … → +49 170 …). Italien behält die 0.
 */
export const PHONE_COUNTRIES = [
  { code: "DE", dial: "49", label: "Deutschland", trunk: true },
  { code: "AT", dial: "43", label: "Österreich", trunk: true },
  { code: "CH", dial: "41", label: "Schweiz", trunk: true },
  { code: "LI", dial: "423", label: "Liechtenstein", trunk: false },
  { code: "LU", dial: "352", label: "Luxemburg", trunk: false },
  { code: "NL", dial: "31", label: "Niederlande", trunk: true },
  { code: "BE", dial: "32", label: "Belgien", trunk: true },
  { code: "FR", dial: "33", label: "Frankreich", trunk: true },
  { code: "IT", dial: "39", label: "Italien", trunk: false },
  { code: "ES", dial: "34", label: "Spanien", trunk: false },
  { code: "PL", dial: "48", label: "Polen", trunk: false },
  { code: "GB", dial: "44", label: "Vereinigtes Königreich", trunk: true },
  { code: "US", dial: "1", label: "USA / Kanada", trunk: false },
] as const;
export type PhoneCountry = (typeof PHONE_COUNTRIES)[number]["code"];
export const DEFAULT_PHONE_COUNTRY: PhoneCountry = "DE";

const byCode = (code?: string) => PHONE_COUNTRIES.find((c) => c.code === code);

/**
 * Nimmt eine internationale Nummer (+49 …, 0049 …) oder, mit gewähltem Land,
 * eine nationale Schreibweise (0170 …). Ohne Land bleibt eine nationale
 * Schreibweise mehrdeutig und wird abgelehnt.
 */
export function normalisePhone(input: string, country?: string): PhoneCheck {
  const raw = (input || "").trim();
  if (!raw) return { ok: false, reason: "Bitte gib deine Telefonnummer an." };
  // Klammern, Bindestriche, Schrägstriche und Leerzeichen sind übliche
  // Schreibweisen und werden entfernt, bevor geprüft wird. „(0)“ in
  // „+49 (0)170 …“ ist die Amtsholung und entfällt.
  let value = raw.replace(/\(0\)/g, "").replace(/[\s()/.-]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (!value.startsWith("+")) {
    const selected = byCode(country);
    if (!selected)
      return {
        ok: false,
        reason:
          "Bitte mit Ländervorwahl angeben, zum Beispiel +49 170 1234567. Eine Nummer wie 0170… lässt sich keinem Land zuordnen.",
      };
    if (!DIGITS.test(value))
      return {
        ok: false,
        reason: "Die Telefonnummer darf nur Ziffern enthalten.",
      };
    // Die nationale 0 entfällt international (Deutschland: 0170 → +49 170).
    if (selected.trunk) value = value.replace(/^0/, "");
    // Eine zweite 0 wäre bei diesen Ländern die internationale Vorwahl.
    if (selected.trunk && value.startsWith("0"))
      return {
        ok: false,
        reason: "Diese Telefonnummer wirkt unvollständig. Bitte prüfe sie noch einmal.",
      };
    value = `+${selected.dial}${value}`;
  }
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

/**
 * Zerlegt eine gespeicherte E.164-Nummer für das Formular in Land und
 * nationale Ziffern (mit führender 0 bei Ländern, die sie national nutzen).
 * Unbekannte Vorwahlen bleiben vollständig im Feld stehen.
 */
export function splitPhone(value: string): { country: PhoneCountry; national: string } {
  if (!value?.startsWith("+")) return { country: DEFAULT_PHONE_COUNTRY, national: value || "" };
  const digits = value.slice(1);
  const match = [...PHONE_COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial));
  if (!match) return { country: DEFAULT_PHONE_COUNTRY, national: value };
  const rest = digits.slice(match.dial.length);
  return { country: match.code, national: match.trunk ? `0${rest}` : rest };
}

/** Für die Verwaltungsansicht: +49170… wird als +49 170… lesbarer dargestellt. */
export function formatPhone(value: string) {
  if (!value.startsWith("+")) return value;
  const digits = value.slice(1);
  const known = [...PHONE_COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial));
  const country = known ? known.dial : digits.slice(0, 2);
  return `+${country} ${digits.slice(country.length)}`.trim();
}
