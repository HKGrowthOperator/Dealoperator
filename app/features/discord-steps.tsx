/**
 * Der Weg in den Discord in drei Schritten, aufklappbar, für alle, die
 * Discord noch nicht kennen. Ohne Zustand, deshalb auf Server- und
 * Client-Seiten gleich einsetzbar. Kanalnamen stehen bewusst nicht hier:
 * sie ändern sich im Server, der Text soll nicht veralten.
 */
export default function DiscordSteps({ summary = "Discord ist neu für dich? So kommst du rein." }: { summary?: string }) {
  return (
    <details className="rb-discord-steps">
      <summary>{summary}</summary>
      <ol>
        <li>
          <strong>Öffnen:</strong> „Discord öffnen“ antippen. Am Handy die Discord-App
          installieren, am Rechner geht es auch im Browser.
        </li>
        <li>
          <strong>Einladung annehmen:</strong> Konto anlegen oder anmelden, dann „Einladung
          annehmen“. Damit bist du auf dem Deal-Operator-Server.
        </li>
        <li>
          <strong>Loslegen:</strong> Schreib in den Kanal, wann du Zeit für ein Roleplay hast,
          oder geh direkt in einen Sprachkanal. Wer da ist, hört dich.
        </li>
      </ol>
    </details>
  );
}
