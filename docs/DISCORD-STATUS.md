# Discord: geprüfter Stand und konkrete Lücke

Stand: 23. September 2026.

## Grundsatz (seit 23.09.2026)

Discord ist für **Calls** da: Sessions und Roleplay in eigenen Räumen,
Call-Partner finden, sich gegenseitig pushen und sehen, wer durchzieht. Die
Ränge der Website (vor allem „Aktiver Caller“) erscheinen dort als Rollen.
Tagesabschlüsse, Reflexionen, Zahlen und Kontaktdaten werden **nicht** in
Discord geteilt; die frühere Beitragsfunktion (`server/discord-sync.ts`) ist
stillgelegt und wird nicht mehr aufgerufen.

## Was im Code vorbereitet ist

| Teil | Datei | Braucht |
| --- | --- | --- |
| Session-Räume: je Session auf der Website ein Sprachkanal (mit Chat) und ein Discord-Event; Link erscheint in der Session; Titel, Zeit und Plätze werden nachgezogen; nach Absage oder 6 Stunden nach Ende abgeräumt | `server/discord-sessions.ts` (Knopf in Verwaltung → Discord und alle 15 Minuten im Server-Takt) | `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, optional `DISCORD_SESSION_CATEGORY_ID`; Bot-Rechte „Kanäle verwalten“, „Events verwalten“ |
| Rang „Aktiver Caller“ als Rolle: 5 Calling-Tage am Stück mit mindestens 50 Anwahlen, weg nach 3 Calling-Tagen in Folge ohne Anwahlen (`lib/active-caller.ts`); Session-Räume sind dann nur mit dieser Rolle oder als Moderator betretbar, sehen können sie alle | `server/discord-sessions.ts`, `server/active-caller.ts` | zusätzlich `DISCORD_ACTIVE_ROLE_ID`; Bot-Recht „Rollen verwalten“, Bot-Rolle über der Rolle |
| Moderatorrolle für Admins und Moderatoren der Website | `server/discord-sessions.ts` | zusätzlich `DISCORD_MODERATOR_ROLE_ID`; Bot-Rolle über der Rolle |
| Kontoverknüpfung (OAuth2 „identify“), je Discord-Konto genau ein Website-Konto; Voraussetzung für die Rollen | `server/discord-admin.ts`, `app/api/discord/connect`, `app/api/discord/callback` | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, Redirect `APP_URL/api/discord/callback` |
| Befehle `/tagesabschluss` (Link zur Website) und `/serie` (eigene Serie, nur für die fragende Person sichtbar) | `app/api/discord/interactions` | `DISCORD_PUBLIC_KEY`, Befehlsregistrierung, Interactions-URL `APP_URL/api/discord/interactions` |
| Rollen und Channels lesen (nur lesend, um IDs zu finden) | Verwaltung → Discord → Inventar | `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` |

Rollen entzieht der Abgleich nur denen, denen er sie selbst gegeben hat; von
Hand vergebene Rollen im Discord bleiben unberührt.

## Was davon läuft

Sobald die Werte in Coolify gesetzt sind, zeigt Verwaltung → Discord den Stand
und einen Knopf „Jetzt mit Discord abgleichen“. Ohne die Werte passiert
nichts; die Website sagt dann ehrlich, dass der Raum-Link noch folgt.

## Was von außen noch nötig ist

- Discord-Anwendung mit Bot: Client-ID, Client-Secret, Bot-Token, Public Key.
- Server-(Guild-)ID, eine Kategorie für die Session-Räume (optional), die
  Rollen „Aktiver Caller“ und „Moderator“ (IDs über Verwaltung → Discord →
  Rollen und Channels lesen).
- Bot einladen mit „Kanäle verwalten“, „Events verwalten“, „Rollen
  verwalten“; seine Rolle in der Rollenliste über „Aktiver Caller“ und
  „Moderator“ schieben.

## Slack und Zoom

Die Übernahme der Meldungen aus Slack, Zoom und Chat-Exporten läuft über den
Wins-Import in der Verwaltung (Text einfügen, Vorschau mit Vergleich,
übernehmen). Eine automatische Anbindung an diese Dienste gibt es nicht.
