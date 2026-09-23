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
      title: "Call-Partner auch auf Discord finden.",
      text: "Zusätzlich kannst du auf Discord nach einem Call-Partner fragen und dich dort abstimmen.",
      link: "Discord öffnen",
    },
    reflection: {
      title: "Ein Learning, das anderen helfen könnte?",
      text: "Zusätzlich kannst du es auf Discord teilen oder dort auf Reflexionen antworten. Du entscheidest, was du teilst.",
      link: "Discord öffnen",
    },
    community: {
      title: "Zusätzlich kannst du auf Discord Feedback holen.",
      text: "Frag nach Feedback zu einem Einwand, antworte auf Reflexionen oder such einen Call-Partner.",
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
