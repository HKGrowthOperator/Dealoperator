import type { HomeState } from "@/server/home";

/*
 * Der eigene Stand für heute als Karte: was offen ist und wohin es geht.
 * Ein Ort für die Wortwahl, damit Startseite und Bestätigung dasselbe sagen.
 * Eintragen, ansehen und korrigieren laufen über das Formular unter Mein Tag;
 * nach dem Einreichen führt der nächste Schritt zu den Reflexionen.
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

/** Der Stand für heute mit dem einen nächsten Schritt. */
export function dayState(home: HomeState): DayState {
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
      text: "Übernimm dein Profil, wenn du schon in der Rangliste stehst, oder leg eins an.",
      href: "/start",
      action: "Profil einrichten",
    };
  }
  const t = home.today!;
  if (t.status === "done")
    return {
      icon: "circle-check",
      tone: "done",
      title: "Dein Tag ist drin.",
      text: "Zahlen und Reflexion sind eingereicht und zählen.",
      href: "/reflexionen",
      action: "Reflexionen lesen",
    };
  if (t.status === "imported")
    return {
      icon: "check",
      tone: "done",
      title: "Deine Zahlen für heute sind eingetragen.",
      text: "Das Team hat sie übernommen.",
      href: "/reflexionen",
      action: "Reflexionen lesen",
    };
  if (t.status === "draft")
    return {
      icon: "draft",
      tone: "draft",
      title: "Dein Entwurf für heute ist gespeichert.",
      text: "Er zählt, sobald du ihn einreichst.",
      href: "/tagesabschluss",
      action: "Fortsetzen",
    };
  return {
    icon: "dashed",
    tone: "open",
    title: t.due ? "Dein Tag für heute ist noch offen." : "Heute ist kein Calling-Tag.",
    text: t.due
      ? "Zahlen und zwei kurze Antworten, dann zählt dein Tag."
      : "Ein Eintrag ist freiwillig und zählt als Bonus.",
    href: "/tagesabschluss",
    action: "Zahlen eintragen",
  };
}
