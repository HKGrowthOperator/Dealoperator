# Discord: aktueller Stand und Integrationsvertrag

## Heute nutzbar

Die Website verlinkt kontextbezogen auf `https://discord.gg/NjkFJtBkZm`: unter anderem bei der Crew, beim Tagesabschluss und im Community-Bereich. Der öffentliche Auftritt heißt Deal Operator. KPI-Tracking, Buddy-Suche, Sessions, Reflexion und Austausch bleiben kostenfrei. Das Partnerregister wird auf der Website nicht angeboten.

Die Website besitzt ihre eigenen persistenten Community-Funktionen. Ein Website-Konto ist noch nicht automatisch ein Discord-Konto oder eine Servermitgliedschaft. Es gibt in diesem Repository **keinen fertigen Discord-Bot, keine Discord-OAuth-Verknüpfung und noch keine bidirektionale Synchronisation**. Channel- und Rollenberechtigungen gelten bislang nur im Discord-Server.

## Gemeinsame Datenquelle

Die nächste Ausbaustufe verwendet dieselbe PostgreSQL-Datenbank als maßgeblichen Zahlenstand. Website und Bot greifen durch geprüfte Serverfunktionen darauf zu. Ein MCP-Zugang ist für den späteren Dauerbetrieb nicht nötig. Ein Bot/Worker kann als eigener Dienst auf Coolify laufen; seine Zugangsdaten bleiben ausschließlich serverseitig.

Die Geschäftslogik liegt in `server/operator.ts`, die Kennzahlen und Ränge in `lib/kpis.ts`. Für die Bot-Anbindung diese Logik bewusst erweitern, nicht eine zweite Rangberechnung in Discord erfinden. Nach einer Zahlenänderung legt die Anwendung in derselben Transaktion einen Eintrag in `operator.sync_outbox` an bzw. aktualisiert ihn.

## Zahlenformat

Ein Mitglied hat eine stabile Teilnehmer-ID und genau einen vollständigen Zahlenstand je Kalendertag in `Europe/Berlin`.

| Feld                         | Bedeutung                                                          |
| ---------------------------- | ------------------------------------------------------------------ |
| `attempts`                   | Anwahlversuche                                                     |
| `decisionMakerConversations` | Gespräche mit Entscheidern                                         |
| `settingsBooked`             | Settings vereinbart                                                |
| `settingsHeld`               | Settings durchgeführt                                              |
| `closingsBooked`             | Closings vereinbart                                                |
| `closingsHeld`               | Closings durchgeführt                                              |
| `dealsWon`                   | Gewonnene Deals                                                    |
| `legacyMeetings`             | Historische Termine ohne verlässliche Zuordnung; getrennt erhalten |

Werte sind nichtnegative ganze Zahlen oder `null` für nicht gemeldet. Ein fehlender Wert ist nicht null Anrufe. Keine automatische Umdeutung alter Termine in Settings oder Closings.

`saveCheckin` nimmt einen vollständigen Stand, `expectedRevision` und eine eindeutige `requestId` entgegen. Wiederholungen derselben Anfrage sind idempotent; veraltete Revisionen erzeugen einen Konflikt. Diese Semantik auch bei Discord-Modals erhalten. Eine Discord-Meldung darf keine neueren Website-Zahlen überschreiben. Vor dem Speichern den erwarteten Tagesstand laden und bei Konflikt erneut bestätigen lassen.

## Ränge der Website

Die Stufen heißen Bronze, Silber, Gold, Platin, Diamant. Grundlage ist die jeweilige aufsummierte Kennzahl, kein vermischter Punktescore.

| Track      | Kennzahl            | Bronze | Silber |  Gold | Platin | Diamant |
| ---------- | ------------------- | -----: | -----: | ----: | -----: | ------: |
| Dialer     | Anwahlversuche      |    100 |    500 | 1.500 |  5.000 |  15.000 |
| Setter     | Settings vereinbart |      5 |     20 |    50 |    150 |     400 |
| Closer     | Closings vereinbart |      3 |     10 |    30 |    100 |     250 |
| Deal Maker | Deals gewonnen      |      1 |      5 |    15 |     50 |     150 |

Das Ranking selbst kann nach Kennzahl und Zeitraum gefiltert werden; gleiche Werte erhalten denselben Rang. Discord-Rollen nicht allein aus dem Rang eines zeitlich gefilterten öffentlichen Rankings ableiten. Vor dem Rollenabgleich mit dem vorhandenen Discord-Konzept abgleichen: Welche Rollen-IDs, Schwellen, Zeiträume und Aktivitätsregeln verwendet es bereits? Ohne diese Informationen keine vorhandenen Rollen überschreiben.

## Noch zu implementieren

1. **Konten verbinden:** Discord OAuth mit kurzlebigem State und sicherem Rücksprung, eindeutige Zuordnung einer Discord-User-ID zum bestätigten Website-Konto. Anzeigenamen sind keine Identitätsprüfung. Disconnect und erneute Verifizierung vorsehen.
2. **Zahlen in Discord:** Slash-Command mit privatem Modal und persönlicher Bestätigung. Bot-Interaktionen authentifizieren; Teilnehmer aus der verifizierten Zuordnung ermitteln, nie aus frei übergebener Nutzer-ID. Die bestehende Validierung und Konfliktlogik wiederverwenden.
3. **Website nach Discord:** Worker liest `sync_outbox`, berechnet den aktuellen bestätigten Stand und aktualisiert gezielt die zugeordnete Nachricht bzw. Rolle. Kein dauerhaft laufender MCP-Chat als Ersatzdienst.
4. **Sicher quittieren:** Die Outbox fasst Änderungen je Teilnehmer zusammen und erhöht ihre `revision`. Worker merkt sich die gelesene Revision und bestätigt nur genau diese Revision. Eine zwischenzeitlich neuere Änderung muss `pending` bleiben. Mehrere Worker über Sperren koordinieren, Wiederholungen verzögert erneut versuchen, Fehler sichtbar protokollieren.
5. **Discord nach Website:** Derselbe Datensatz wird serverseitig gespeichert. Website muss anschließend neu abrufen oder erhält später ein gezieltes Realtime-Signal; das heutige Ranking kann manuell aktualisiert werden. Eine Live-Push-Verbindung ist noch nicht vorhanden.
6. **Sichtbarkeit:** Private Reflexionen, E-Mail und Telefon nicht automatisch in Channels schreiben. Öffentliche Website-Freigabe ist keine pauschale Discord-Freigabe. Empfänger und Kanal müssen zur ausdrücklich gewählten Sichtbarkeit passen. Rollenberechtigungen und Community-Zugang separat prüfen.
7. **Abnahme:** Änderungen nacheinander und gleichzeitig von Website und Discord, Bot-Ausfall, Wiederholung, Rollenänderung, entzogene Zustimmung, getrennter Account, gelöschte Discord-Nachricht und fehlende Serverrechte testen.

Bestehende API-Routen verwenden Website-Sessions und Origin-Prüfung. Sie sind kein bereits eingerichteter Bot-Endpunkt. Für den Dienst eine eng begrenzte, authentifizierte Schnittstelle entwerfen, die die Serverlogik nutzt; keinen Secret-Key in Browsercode oder Slash-Command-Parameter einbauen.
