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
| Link öffnen (nach Umstellung auch anderer Browser) oder Code eingeben | Bestätigte Sitzung, anschließend einmalige Profileinrichtung               |
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

## Tagesabschluss, Dranbleiben und Hinweise (ab Migration 0003)

| Prüfung | Erwartetes Ergebnis |
| --- | --- |
| Konto ohne Telefonnummer öffnet `/tagesabschluss` | Checkliste nennt die fehlende Nummer; Entwurf speicherbar, Einreichen gesperrt |
| Entwurf mit Zahlen speichern | Nirgends sichtbar: nicht im Ranking, nicht in der Gruppensumme, nicht in `/reflexionen`, keine Serie |
| Einreichen ohne Energie oder ohne Antworten | Klare Meldung, nichts gezählt |
| Vollständig einreichen (Bestätigung gelesen) | Tag zählt im Ranking (öffentlich nur mit Freigabe), Serie steigt, Karte in `/reflexionen` für berechtigte Mitglieder |
| Korrektur beginnen, nicht einreichen | Weiter gilt die zuletzt eingereichte Fassung |
| Abschluss mit 0 Anwahlen (rechtzeitig, mit Reflexion) | Reflexions-Serie läuft weiter, auch über viele Tage ohne Anwahlen; sie ist die Hauptserie (Dranbleiben-Rangliste, „laufende Serien“). Calling-Serie wird nicht verlängert |
| Tag mit übernommenem Stand (z. B. 22.09.) | Kein eigener Abschluss möglich; Korrektur über das Team |
| Wochenende | Keine Erinnerung, kein Fehltag; freiwilliger Abschluss als Bonus |
| Push auf einem echten Gerät einrichten, Testnachricht | Nachricht kommt bei geschlossener Seite an; iPhone nur als Home-Bildschirm-App |
| 20:30 ohne Abschluss (Calling-Tag, Push aktiv) | Genau eine Erinnerung; nach eingereichtem Abschluss keine |
| Neue Registrierung über `/starten`, E-Mail bestätigt | Genau ein Inbox-Eintrag und ein Push je Admin und Moderator plus kurze E-Mail (sofern `RESEND_API_KEY`/`NOTIFY_FROM` gesetzt); späteres Anmelden löst nichts aus |
| „Anmelden“ mit einer neuen Adresse | Link kommt an; nach Bestätigung Profileinrichtung unter `/start`, Team bekommt einen Hinweis |
| Team-Inbox nach einem Hinweis | Je Kanal „übergeben“ nur nach Annahme durch Push-Dienst bzw. Resend; sonst „wartet“ mit Grund, „fehlgeschlagen“ oder „abgelaufen“ |
| Wins-Text zweimal übernehmen | Zweites Mal „unverändert“, keine Doppelzählung |

## Import und sichere Übernahme

1. Betreiber-UUID in `OPERATOR_ADMIN_IDS` hinterlegen, Anwendung neu starten.
2. `/verwaltung` mit dem Betreiberkonto öffnen. Ein gewöhnliches Mitglied erhält keinen Adminzugang.
3. Vorbereitete Tageszahlen mit stabiler `participantKey` und nachvollziehbarer Zustimmung importieren. Leere Kennzahlen bleiben unbekannt; `0` bedeutet ausdrücklich null. Nicht aus anderen Kennzahlen schätzen.
4. Vorschau und Änderungen kontrollieren, dann speichern. Wiederholtes Senden darf die Werte nicht verdoppeln.
5. Übernahme abgemeldet: Profil im Ranking oder unter `/starten` → „Meine Zahlen sind schon hier“ wählen. Nach der Auswahl stehen Profilkarte, „Anderes Profil wählen“ und das kurze Formular (Name, E-Mail, Telefon mit Ländervorwahl; Hinweis fürs Team optional) auf einer Seite. „Bestätigungsmail senden“ → „Bestätige deine E-Mail“. `/status` zeigt „E-Mail bestätigt. Deine Profilübernahme wird geprüft.“ Nichts ist freigegeben, bis das Team unter Verwaltung → Übernahmen freigibt.
6. Profil nicht gefunden: „Meine Zahlen müssten schon hier sein“ → Anfrage an das Team mit Suchbegriff als Hinweis. Das Team wählt unter Übernahmen das Profil aus („Zuordnen und freigeben“). „Ich habe noch keine Zahlen“ → neues Profil. Ein bereits vergebenes Profil aus einem Direktlink zeigt „Dieses Profil ist schon vergeben“ mit Anmelden oder Anfrage an das Team, nie stillschweigend ein zweites Profil.
7. Übernahme angemeldet ohne Profil: `/profil-uebernehmen` oder persönlicher Einladungslink `/profil-uebernehmen?profil=…&einladung=…`. Name und Telefon ergänzen, „Übernahme anfragen“, keine zweite Mail. Mehrfaches Absenden: eine Anfrage, ein Team-Hinweis.
8. Bestätigung: Link in der Mail oder, nach der Umstellung der Vorlagen und `AUTH_EMAIL_CODE=1`, Code auf der Seite. „Erneut senden“ erst nach der angezeigten Wartezeit; nur die neueste Mail gilt. „E-Mail-Adresse ändern“ behält alle anderen Angaben. Zurück, Neuladen und ein Link-Fehler zeigen den Stand wieder. Rückfrage des Teams (Text ist Pflicht): Person sieht die Frage unter `/status`, antwortet dort; eine offene Statusseite zeigt Rückfrage, Ablehnung und Freigabe ohne Neuladen. Ablehnung: `/status` bietet anderes Profil, Anfrage an das Team oder (klein) ein neues Profil.
9. Bisherige Tageszahlen bleiben nach der Freigabe erhalten. Ein zugeordnetes Profil lässt sich nicht erneut anfragen; niemand im Team (außer der festen Grundverwaltung) entscheidet über die eigene Anfrage.
10. Beim bewussten Neustart trotz passender Importdaten bleibt der Import erhalten und wird nicht stillschweigend gelöscht.
11. Admin-Kontaktansicht prüfen: E-Mail aus bestätigter Sitzung; Telefonnummer freiwillig und nicht SMS-verifiziert. Veröffentlichung im Ranking ist keine Werbeeinwilligung.

## Darstellung und Bedienung

- Breiten 320, 360, 390, 430, 812 und 1280 px prüfen: Navigation, Rankingfilter, Profilansicht, Formulare, Dialoge, Discord-Hinweise.
- Lange Namen, leere Rankings und noch unbekannte Zahlen prüfen. Bei breiten Tabellen darf nur der dafür vorgesehene Tabellenbereich horizontal scrollen.
- Tastaturnavigation: Links und Formulare erreichbar, sichtbarer Fokus, Dialog mit Escape schließbar.
- Systemoption „Bewegung reduzieren“: Animationen und glatte Scrollbewegungen entfallen.
- CTA-Pfeile sind entfernt. Funktionale Steuerungen wie Dropdowns oder Kalender dürfen Richtungssymbole behalten.
- Ausschließlich „kostenfrei“ verwenden. Website-Marke: Deal Operator. Partnerregister bleibt außerhalb der Website.

## Betrieb vor dem öffentlichen Start

Betreiber- und Datenschutzangaben, endgültige Domain, Versanddomain und Zustellbarkeit ergänzen. Sicherungen, Wiederherstellungsweg und tatsächliche Tariflimits festlegen. Fehlerlogs ohne Zugangsdaten und private Formulardaten halten. Der Discord-Bot ist eine eigene noch offene Integration, beschrieben in [DISCORD.md](DISCORD.md).

Eine Freigabe „live nutzbar“ erst geben, wenn die echten Konto-, Mail- und Datenpersistenzprüfungen oben bestanden sind. Die lokale Vorschau allein belegt das nicht.
