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
      title: "Im Discord pusht ihr euch gegenseitig.",
      text: "Dort trefft ihr euch zu Sessions und Roleplay und seht, wer durchzieht. Deine Reflexion bleibt hier auf der Website.",
      link: "Discord öffnen",
    },
    community: {
      title: "Im Discord gemeinsam dranbleiben.",
      text: "Hol dir Feedback zu einem Einwand, triff dich zu Sessions und Roleplay oder such einen Call-Partner.",
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
