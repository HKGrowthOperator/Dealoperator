# Abnahme vor Öffnung der Community

Diese Liste trennt bereits lokal geprüften Code von der Abnahme nach echter Einrichtung. Keine Zugangsdaten oder Kontaktdaten als Testprotokoll ins öffentliche Repository schreiben.

## Bereits automatisiert prüfbar

```sh
npm ci
npm run lint
npm test
npm run build
npm run smoke
```

Die fachlichen Tests laufen gegen eine isolierte PostgreSQL-kompatible PGlite-Testdatenbank. Sie ändern kein Supabase-Projekt. Sie prüfen unter anderem konkurrierende Tagesmeldungen, wiederholte Anfragen, Importvorschau, Profilübernahmen, neue Mitglieder, öffentliche Sichtbarkeit, private Kontaktdaten, eingeschränkte Datenbankrechte und die Synchronisationswarteschlange. Der Smoke-Test startet das tatsächlich gebaute Standalone-Paket ohne externe Konfiguration und prüft Seiten, Assets, Zugangsschutz und den ehrlichen Nicht-bereit-Status.

GitHub Actions führt dieselben Prüfungen und zusätzlich einen Docker-Build mit Container-Start aus. Ein bestandener lokaler Build ersetzt weder diesen Container-Test noch eine echte E-Mail-Abnahme.

## Nach Supabase-, SMTP- und Coolify-Einrichtung

Zwei ausdrücklich dafür angelegte Testkonten A und B verwenden. Soweit möglich das neue Testprojekt vor der öffentlichen Freischaltung nutzen. Änderungen und späteres Aufräumen vorher mit dem Betreiber abstimmen.

| Prüfung                                      | Erwartetes Ergebnis                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/health`                            | 200, Prozess läuft                                                                           |
| `GET /api/ready`                             | 200, `ready: true`; prüft Konfiguration und Datenbankzugriff, nicht die Mailzustellung       |
| Startseite / Ranking ohne Login              | Öffentliche, freigegebene Zahlen; keine E-Mails, Telefonnummern oder Reflexionen             |
| Eigener Bereich ohne Login                   | Weiterleitung zur Anmeldung, gewünschtes internes Ziel bleibt erhalten                       |
| E-Mail-Link für Konto A anfordern            | Eine echte Auth-Mail kommt an; kein Newsletter und keine zusätzliche Werbeeinwilligung       |
| Link im selben Browser öffnen                | Bestätigte Sitzung, anschließend einmalige Profileinrichtung                                 |
| Neues Profil ohne Ranking-Freigabe           | Eigene Zahlen nutzbar; Person erscheint nicht öffentlich                                     |
| Zwei Tagesmeldungen auf verschiedenen Tagen  | Verlauf und Summen stimmen; Neuladen, Abmelden und erneutes Anmelden erhalten die Daten      |
| Bestehende Tagesmeldung korrigieren          | Neuer vollständiger Tagesstand ersetzt den alten; keine Addition doppelter Werte             |
| Zwei Tabs mit derselben alten Revision       | Zweite widersprüchliche Speicherung wird abgefangen; neu laden und bewusst erneut bearbeiten |
| Öffentliche Freigabe aktivieren / widerrufen | Darstellung nach Aktualisierung entsprechend sichtbar / verborgen                            |
| Konto B öffnen                               | B sieht keine privaten Zahlen, Reflexionen oder Kontakte von A und kann A nicht bearbeiten   |
| Konto A und B als Buddy verbinden            | Anfragen, Annahme und Nachrichten bleiben den Beteiligten zugänglich                         |
| Session anlegen und anmelden                 | Teilnahme nach Neuladen erhalten; unberechtigte Änderungen abgewiesen                        |
| Wissensbeitrag und Antwort                   | Inhalt wird gespeichert und nach Neuladen angezeigt                                          |
| Fehlende / abgelaufene Auth-Mail             | Verständliche Rückkehr zur Anmeldung; neuer Link anforderbar                                 |
| Abmelden                                     | Private Bereiche sind wieder geschützt                                                       |
| Discord öffnen                               | Offizieller Server `https://discord.gg/NjkFJtBkZm`; Beitritt und Kanalrechte durch Discord   |

## Import und sichere Übernahme

1. Betreiber-UUID in `OPERATOR_ADMIN_IDS` hinterlegen, Anwendung neu starten.
2. `/verwaltung` mit dem Betreiberkonto öffnen. Ein gewöhnliches Mitglied erhält keinen Adminzugang.
3. Vorbereitete Tageszahlen mit stabiler `participantKey` und nachvollziehbarer Zustimmung importieren. Leere Kennzahlen bleiben unbekannt; `0` bedeutet ausdrücklich null. Nicht aus anderen Kennzahlen schätzen.
4. Vorschau und Änderungen kontrollieren, dann speichern. Wiederholtes Senden darf die Werte nicht verdoppeln.
5. Mitglied mit passender bestätigter E-Mail übernimmt sein vorbereitetes Profil. Ohne E-Mail-Match einen persönlichen, einmaligen Übernahmecode verwenden. Den Code nur der richtigen Person zukommen lassen; nicht öffentlich teilen.
6. Bisherige Tageszahlen bleiben erhalten. Andere Konten können weder das bereits zugeordnete Profil noch einen verbrauchten Code übernehmen.
7. Beim bewussten Neustart trotz passender Importdaten bleibt der Import erhalten und wird nicht stillschweigend gelöscht.
8. Admin-Kontaktansicht prüfen: E-Mail aus bestätigter Sitzung; Telefonnummer freiwillig und nicht SMS-verifiziert. Veröffentlichung im Ranking ist keine Werbeeinwilligung.

## Darstellung und Bedienung

- Breiten 320, 390, 812 und 1280 px prüfen: Navigation, Rankingfilter, Profilansicht, Formulare, Dialoge, Discord-Hinweise.
- Lange Namen, leere Rankings und noch unbekannte Zahlen prüfen. Bei breiten Tabellen darf nur der dafür vorgesehene Tabellenbereich horizontal scrollen.
- Tastaturnavigation: Links und Formulare erreichbar, sichtbarer Fokus, Dialog mit Escape schließbar.
- Systemoption „Bewegung reduzieren“: Animationen und glatte Scrollbewegungen entfallen.
- CTA-Pfeile sind entfernt. Funktionale Steuerungen wie Dropdowns oder Kalender dürfen Richtungssymbole behalten.
- Ausschließlich „kostenfrei“ verwenden. Website-Marke: Deal Operator. Partnerregister bleibt außerhalb der Website.

## Betrieb vor dem öffentlichen Start

Betreiber- und Datenschutzangaben, endgültige Domain, Versanddomain und Zustellbarkeit ergänzen. Sicherungen, Wiederherstellungsweg und tatsächliche Tariflimits festlegen. Fehlerlogs ohne Zugangsdaten und private Formulardaten halten. Der Discord-Bot ist eine eigene noch offene Integration, beschrieben in [DISCORD.md](DISCORD.md).

Eine Freigabe „live nutzbar“ erst geben, wenn die echten Konto-, Mail- und Datenpersistenzprüfungen oben bestanden sind. Die lokale Vorschau allein belegt das nicht.
