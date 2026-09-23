# Discord: geprüfter Stand und konkrete Lücke

Stand: 23. September 2026.

## Was im Code vorbereitet ist

Website und Discord haben **eine** Datenquelle: die Tagesabschlüsse in der
Datenbank. Discord bekommt keine eigene Zählung und kann keine Zahlen ohne
vollständige Reflexion einreichen.

| Teil | Datei | Braucht |
| --- | --- | --- |
| Kontoverknüpfung (OAuth2 „identify“), je Discord-Konto genau ein Website-Konto | `server/discord-admin.ts`, `app/api/discord/connect`, `app/api/discord/callback` | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, Redirect `APP_URL/api/discord/callback` in der Discord-Anwendung |
| Beiträge freigegebener Tagesabschlüsse im Reflexions-Channel, Korrektur bearbeitet den vorhandenen Beitrag, zurückgenommene Freigabe löscht ihn | `server/discord-sync.ts` (läuft im Minutentakt) | `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_REFLECTION_CHANNEL_ID` |
| „Antworten auf Discord“ auf `/reflexionen` führt zum gespeicherten Beitrag | `server/reflections.ts` | gespeicherte Zuordnung in `discord_posts` |
| Befehle `/tagesabschluss` (Link zur Website) und `/serie` (eigene Serien, nur für die fragende Person sichtbar) | `app/api/discord/interactions` | `DISCORD_PUBLIC_KEY`, Befehlsregistrierung in der Discord-Anwendung, Interactions-URL `APP_URL/api/discord/interactions` |
| Rollen und Channels lesen (nur lesend, zur Zuordnung) | Verwaltung → Discord → Inventar | `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` |

Übertragen wird nur, was ein Mitglied beim Einreichen ausdrücklich zum Teilen
auf Discord angekreuzt hat, nur aus den letzten sieben Tagen und nie Entwürfe,
Importe, Kontaktdaten, Unterstützungswünsche oder alte private Reflexionen.
Zahlen stehen im Beitrag nur mit Zustimmung zur öffentlichen Anzeige.

## Was davon läuft

**Nichts davon ist aktiv.** Keine der oben genannten Umgebungsvariablen ist
gesetzt. Ohne sie bleibt die Outbox unverändert (nichts wird als übertragen
markiert), die Verwaltung zeigt die fehlenden Werte, `/reflexionen` bietet
statt eines Beitrags ehrlich den Einladungslink an, und
`/api/discord/interactions` antwortet mit 404. Es wurden keine Nachrichten in
den Server gesendet.

## Was von außen noch nötig ist

- Discord-Anwendung mit Bot: Client-ID, Client-Secret, Bot-Token, Public Key.
- Server-(Guild-)ID und die ID des Reflexions-Channels. Empfehlung: ein
  Channel, der nur für verknüpfte, berechtigte Mitglieder sichtbar ist.
- Das bestehende Rollen- und Channelkonzept (welche Rollen gibt es, wer darf
  was sehen). Vorhandene Rollen werden nicht überschrieben; das Inventar in der
  Verwaltung liest sie nur.
- Registrierung der beiden Befehle in der Discord-Anwendung.

## Slack und Zoom

Die Übernahme der Meldungen aus Slack, Zoom und Chat-Exporten läuft über den
Wins-Import in der Verwaltung (Text einfügen, Vorschau mit Vergleich,
übernehmen). Eine automatische Anbindung an diese Dienste gibt es nicht.
