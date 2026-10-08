import Link from "next/link";
import { CalendarDays, Users } from "lucide-react";
import type { PublicSession } from "@/server/sessions";

const KIND: Record<string, string> = {
  "Call-Block": "Call-Block",
  Roleplay: "Roleplay",
  Reflexion: "Rückblick",
};

const dayText = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));

const timeText = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));

/**
 * Kommende Sessions auf der Startseite, für alle sichtbar: Termin, Art,
 * belegte Plätze und Host. Zusagen und Teilnehmernamen gibt es angemeldet
 * unter Sessions. Ohne kommende Session erscheint nichts.
 */
export default function UpcomingSessions({
  sessions,
  signedIn,
}: {
  sessions: PublicSession[];
  signedIn: boolean;
}) {
  if (!sessions.length) return null;
  const target = "/sessions?modus=eigen";
  return (
    <section className="rb-sessions" aria-labelledby="rb-sessions-title">
      <div className="rb-sessions-head">
        <h2 id="rb-sessions-title">Nächste Calls</h2>
        <Link className="do-link" href={signedIn ? target : `/anmelden?next=${encodeURIComponent(target)}`}>
          {signedIn ? "Alle Calls" : "Anmelden und zusagen"}
        </Link>
      </div>
      <ul>
        {sessions.map((s) => (
          <li key={`${s.startsAt}-${s.title}`}>
            <span className="rb-sessions-when">
              <CalendarDays size={16} aria-hidden="true" />
              <strong>{dayText(s.startsAt)}</strong>
              <span>{timeText(s.startsAt)} Uhr</span>
            </span>
            <span className="rb-sessions-what">
              <strong>{s.title}</strong>
              <small>
                {KIND[s.kind] ?? s.kind} · {s.minutes} Min.{s.host ? ` · mit ${s.host}` : ""}
              </small>
            </span>
            <span className="rb-sessions-seats">
              <Users size={16} aria-hidden="true" />
              {s.attendees} von {s.capacity}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
