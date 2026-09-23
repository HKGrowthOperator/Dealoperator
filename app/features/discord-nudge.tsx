import { MessageCircle } from "lucide-react";
export default function DiscordNudge({
  url,
  context,
}: {
  url: string;
  context: "buddy" | "reflection" | "community";
}) {
  const copy = {
    buddy: {
      title: "Aus einem Kontakt wird ein Call-Buddy.",
      text: "Stimmt euch auf Discord ab und macht euren nächsten gemeinsamen Call-Block fest.",
      link: "Auf Discord verabreden",
    },
    reflection: {
      title: "Ein Learning, das anderen helfen könnte?",
      text: "Nimm es mit in den Austausch auf Discord. Du entscheidest, was du dort teilst.",
      link: "Im Discord austauschen",
    },
    community: {
      title: "Die Gespräche gehen auf Discord weiter.",
      text: "Finde einen Call-Buddy, hol dir Feedback zu einem Einwand oder verabrede den nächsten Fokusblock.",
      link: "Discord öffnen",
    },
  }[context];
  return (
    <aside className="discord-nudge">
      <MessageCircle size={21} />
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.text}</p>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer">
        {copy.link}
      </a>
    </aside>
  );
}
