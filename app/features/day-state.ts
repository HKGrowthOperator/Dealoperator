import type { HomeState } from "@/server/home";

/*
 * Der eigene Stand für heute als Karte: was offen ist und wohin es geht.
 * Ein Ort für die Wortwahl, damit Startseite und „Mein Tag“ dasselbe sagen.
 * Zahlen eintragen läuft über die Reflexionen (erst der eigene Tag, dann die
 * anderen); ansehen und korrigieren über das Formular unter Mein Tag.
 */

export type DayStateIcon = "clock" | "check" | "circle-check" | "dashed" | "draft";
export type DayState = {
  icon: DayStateIcon;
  tone: "open" | "draft" | "done" | "wait";
  title: string;
  text: string;
  href: string;
  action: string;
};

const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" });
export function formatWeekday(day: string) {
  return WEEKDAY.format(new Date(`${day}T12:00:00Z`));
}
export function formatDeadline(iso: string) {
  return `${new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso))} Uhr`;
}

/** Ein Calling-Tag davor, der noch rechtzeitig abgeschlossen werden kann. */
export function earlierState(home: HomeState): DayState | null {
  if (!home.earlier || !home.today) return null;
  const weekday = formatWeekday(home.earlier.day);
  return {
    icon: "clock",
    tone: "open",
    title: `Dein Abschluss für ${weekday} ist noch offen.`,
    text: `Bis ${formatDeadline(home.earlier.deadline)} zählt er noch für deine Serie.`,
    href: `/tagesabschluss?tag=${home.earlier.day}`,
    action: `${weekday} abschließen`,
  };
}

/**
 * Der Stand für heute. Auf der Startseite („board“) geht es bei einem
 * eingereichten Tag zu Mein Tag; unter Mein Tag („hub“) weiter zu den
 * Reflexionen, weil das dort der nächste Schritt ist.
 */
export function dayState(home: HomeState, where: "board" | "hub"): DayState {
  if (!home.participant) {
    if (home.request && ["pending", "info_needed"].includes(home.request.status))
      return {
        icon: "clock",
        tone: "wait",
        title:
          home.request.status === "info_needed"
            ? "Das Team hat eine Rückfrage zu deiner Profilübernahme."
            : "Deine Profilübernahme wird geprüft.",
        text: "Sobald das Team freigibt, trägst du hier deinen Tag ein.",
        href: "/status",
        action: home.request.status === "info_needed" ? "Rückfrage beantworten" : "Stand ansehen",
      };
    return {
      icon: "dashed",
      tone: "open",
      title: "Dein Konto hat noch kein Profil.",
      text: "Leg ein Profil an oder übernimm deine Zahlen, wenn du schon in der Rangliste stehst.",
      href: "/start",
      action: "Profil einrichten",
    };
  }
  const t = home.today!;
  const onward =
    where === "hub"
      ? { href: "/reflexionen", action: "Reflexionen lesen" }
      : { href: "/tagesabschluss", action: "Meinen Tag ansehen" };
  if (t.status === "done")
    return {
      icon: "circle-check",
      tone: "done",
      title: "Heute abgeschlossen.",
      text: "Deine Zahlen und deine Reflexion sind eingereicht.",
      ...onward,
    };
  if (t.status === "imported")
    return {
      icon: "check",
      tone: "done",
      title: "Deine Zahlen für heute sind eingetragen.",
      text: "Das Team hat sie übernommen.",
      ...onward,
    };
  if (t.status === "draft")
    return {
      icon: "draft",
      tone: "draft",
      title: "Dein Entwurf für heute ist gespeichert.",
      text: "Er zählt, sobald du ihn einreichst.",
      href: "/reflexionen",
      action: "Fortsetzen",
    };
  return {
    icon: "dashed",
    tone: "open",
    title: t.due ? "Dein Abschluss für heute ist noch offen." : "Heute ist kein Calling-Tag.",
    text: t.due
      ? "Zahlen und zwei kurze Fragen, dann zählt dein Tag."
      : "Ein Abschluss ist freiwillig und zählt als Bonus.",
    href: "/reflexionen",
    action: "Zahlen eintragen",
  };
}
