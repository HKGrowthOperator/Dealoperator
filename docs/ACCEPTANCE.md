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
| Vollständig einreichen (beim ersten Mal „Wer sieht deinen Tagesabschluss?“ bestätigen, danach nie wieder) | Tag zählt im Ranking (öffentlich nur mit Freigabe), Serie steigt, Karte in `/reflexionen` für berechtigte Mitglieder; nichts geht in den Discord |
| Korrektur beginnen, nicht einreichen | Weiter gilt die zuletzt eingereichte Fassung |
| Abschluss mit 0 Anwahlen (rechtzeitig, mit Reflexion) | Die Serie läuft weiter, auch über viele Tage ohne Anwahlen. Es gibt nur diese eine Serie (Übersicht, Dranbleiben-Rangliste, „laufende Serien“, Discord `/serie`) |
| Tag mit übernommenem Stand aus den Gruppenmeldungen (Wins-Import) | Eigener Abschluss ersetzt ihn; kuratierte Stände (CSV, Akquise Day, Duo-Aufteilung) bleiben gesperrt |
| 5 Calling-Tage am Stück mit mindestens 50 Anwahlen | Rang „Aktiver Caller“ in Dein Bereich, Tagesabschluss und Dranbleiben-Rangliste; Sessions und Roleplay freigeschaltet; mit verknüpftem Discord-Konto die Rolle im Discord |
| Danach 3 Calling-Tage in Folge ohne Anwahlen | Rang weg; Zusagen und Anlegen von Sessions gesperrt (Absagen geht), Discord-Rolle wird entzogen |
| Session anlegen für heute oder mit weniger als 12 Stunden Vorlauf | Klare Meldung, nichts angelegt |
| Session anlegen für morgen, 8 Plätze | Sichtbar für alle; nach dem Discord-Abgleich „Discord-Raum bereit“ und nach der Zusage der Weg „Server beitreten → Zum Session-Raum“ |
| Wochenende | Keine Erinnerung, kein Fehltag; freiwilliger Abschluss als Bonus |
| Push auf einem echten Gerät einrichten, Testnachricht | Nachricht kommt bei geschlossener Seite an; iPhone nur als Home-Bildschirm-App |
| 20:30 ohne Abschluss (Calling-Tag, Push aktiv) | Genau eine Erinnerung; nach eingereichtem Abschluss keine |
| Neue Registrierung über `/starten`, E-Mail bestätigt | Genau ein Inbox-Eintrag und ein Push je Admin und Moderator plus kurze E-Mail (sofern `RESEND_API_KEY`/`NOTIFY_FROM` gesetzt); späteres Anmelden löst nichts aus |
| „Anmelden“ mit einer neuen Adresse | Link kommt an; nach Bestätigung Profileinrichtung unter `/start`, Team bekommt einen Hinweis |
| Übernahme freigeben, Rückfrage stellen oder ablehnen | Die anfragende Person bekommt je Entscheidung genau einen Push (an ihre Geräte) und eine E-Mail (nur an die bestätigte Anmeldeadresse, sofern `RESEND_API_KEY`/`NOTIFY_FROM` gesetzt), ohne den Text des Teams; wer dasselbe Profil angefragt hatte, erfährt, dass es vergeben ist. Doppelklick oder nachgeschärfte Rückfrage: kein zweiter Hinweis |
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

## Nutzerwege nach der UX-Überarbeitung (24.09.2026)

Mobil (360/390/430) und Desktop (1280) prüfen:

1. Neuer Besuch: gemeinsame Ergebnisse stehen vor den Erklärungen; „Kostenfrei starten“ und „Meine Zahlen sind schon hier“ sind getrennt.
2. Eigenen Namen in der Rangliste suchen, Zeile aufklappen, „Das sind meine Zahlen“: Übernahme genau dieses Profils.
3. Anmeldung ohne Ziel landet an einem Calling-Tag mit offenem Abschluss direkt im Formular unter Mein Tag („Du trägst ein als …“); sonst auf der Startseite mit dem Abschnitt „Mein Tag“.
3a. Konto ohne Profil: zuerst „Bist du schon in der Rangliste?“ mit den Profilen, die zum Namen passen; „Das bin ich“ führt in die Übernahme (Teamfreigabe bleibt), „Keins davon“ zum Anlegen. Ohne Treffer steht „Meine Zahlen sind schon hier“ als Karte über dem Formular.
4. Anmeldung mit Ziel (Tagesabschluss, Reflexionen, Verwaltung) landet genau dort.
5. Zahlen und Reflexion unter Mein Tag einreichen: Es geht direkt zu den Ergebnissen des Tages; die Karte „Mein Tag“ nennt Tag, tatsächliche Folgen und den eigenen Platz mit Zahlen, die eigene Zeile wird angesteuert und leuchtet kurz auf; Erinnerungen werden dort einmal angeboten. Nichts davon steht in der Adresse.
6. Fehlende Telefonnummer: früher Hinweis, Nummer im Profil ergänzen, zurück zum Tagesabschluss, Entwurf ist noch da.
7. Nach dem Einreichen zeigt die Startseite „Dein Tag ist drin.“ mit „Reflexionen lesen“ und „Eintrag ansehen oder korrigieren“.
8. Tag und Monat getrennt; historische Links behalten den Tag (eine Kennzahl im Link führt zur einen Rangliste, `dranbleiben` zur Serie); Verlauf zeigt Anwahlen je Tag und Platz 1 nach Wertung.
9. Gleichstand: alle gleichplatzierten Personen stehen mit derselben Platzzahl und Gestaltung in der Liste. Die Reihenfolge folgt der verdeckten Wertung (Deal 10, Closing vereinbart 5, Setting vereinbart 3, Anwahl 1, +15 je Tag ab 100 Anwahlen), nicht der Reihenfolge der Eingabe; Punkte stehen nirgends, jede Zeile zeigt Anwahlen, Settings und Closings.
9a. Mein Tag ohne `?tag`: direkt das Formular für heute, keine Zwischenseite; mit `?tag=` das Formular für genau diesen Tag. Darunter Serie und Level.
10. Reflexionen gehören zu Mein Tag: Mit offenem Tag steht dort nur das eigene Formular (kein Kopfknopf „Zahlen eintragen“), nach dem Einreichen geht es zu den Ergebnissen. Mit eingereichtem oder übernommenem Tag steht unter Mein Tag oben der kurze Stand mit Zahlen und „Eintrag ansehen oder korrigieren“, darunter Serie und Level, dann „Was bei den anderen heute lief“ mit den Beiträgen, der eigene dabei. `/reflexionen` führt dorthin. Ohne Zugang zu den Beiträgen nennt die Liste, was fehlt, ohne Inhalte.
11. Discord-Knöpfe sagen vor dem Klick, dass Discord geöffnet wird.
12. Lange Namen umbrechen, Tastatur funktioniert (Tableiste weicht der Bildschirmtastatur), größere Schrift ohne seitliches Scrollen.
13. Kommende Sessions stehen auf der Startseite für alle (Termin, Art, Host, belegte Plätze, keine Teilnehmernamen); abgemeldet führt „Anmelden und zusagen“ zu Sessions.
14. Team im Session-Dialog: Person aus der Rangliste vormerken (auch ohne Konto) oder für einen neuen Namen ein Profil anlegen; Vorgemerkte zählen als Plätze und stehen unter „Dabei sind“. Wer vorgemerkt ist und später mit eigenem Konto zusagt, behält den Platz. Host oder Team können einen Discord-Link zum Raum eintragen (nur discord.gg/discord.com über https).
15. Call-Partner: Karte zeigt „Sucht“, Zeit, Tage, Zielgruppe und die kommenden Sessions der Person; ein Tipp öffnet die Session zum Zusagen.
16. Verwaltung › Prüffälle: bei unbekanntem Namen „Neues Profil anlegen“ mit vorgeschlagenem Namen; Werte werden übernommen, spätere Meldungen landen automatisch dort.
17. Nach Migration 0005: unter Mein Tag „Gesprächszeit und CRM-Screenshot (freiwillig)“, sofort gespeichert; Bild nur für Person und Team; Fortschritt zeigt den Monatsstand, Verwaltung › Monatsstand die Liste mit Screenshots. Ohne Migration ist davon nichts zu sehen.

## Zugang durch das Team und Roleplay-Raum (29.09.2026)

Vor Migration 0006:

1. Verwaltung als Admin: Reiter Heute › „Zugang anlegen“ zeigt nur den Hinweis auf Migration 0006; unter Team-Inbox › Unbestätigt gibt es kein „Freischalten“. Alles andere funktioniert wie bisher. Moderatoren sehen den Reiter nicht.

Nach Migration 0006 (nur mit Testkonten, fiktive Namen):

2. Zugang anlegen, neues Profil: Name, E-Mail, Passwort („Vorschlag“ erzeugt z. B. `Anker-Falke-4711`) → „Zugang anlegen“. Danach steht die Nachricht zum Kopieren da („Hi …, dein Zugang zu Deal Operator steht.“, Anmeldeadresse `/anmelden`, E-Mail, Passwort, Hinweis auf Profil) und darunter, dass Supabase zusätzlich eine Bestätigungsmail schickt. Mit E-Mail und Passwort anmelden: das neue Profil gehört dem Konto, Mein Tag öffnet das Formular. In der Team-Inbox steht „Zugang angelegt: …“ unter Erledigt, ohne Push.
3. Zugang anlegen für ein Profil mit Historie: beim Tippen des Namens erscheint das Profil ohne Konto als Vorschlag; auswählen („Vorhandenes Profil: …“). Nach der Anmeldung sind die bisherigen Tage da. Denselben Namen ohne Auswahl anlegen: abgelehnt mit dem Hinweis, genau dieses Profil auszuwählen.
4. Adresse mit bestehendem Zugang: abgelehnt („Für diese Adresse gibt es schon einen Zugang.“). Adresse mit unbestätigtem Konto (hängende Registrierung): abgelehnt mit dem Hinweis auf „Freischalten“, nichts wird bestätigt oder gebunden. Adresse mit bestätigtem Konto ohne Profil: kein neues Konto, über der Nachricht steht, dass das eingegebene Passwort nicht gesetzt wurde, die Nachricht sagt „das, das du bei der Registrierung gewählt hast“, Anmeldung mit dem eigenen Passwort klappt. Hat die Person unter der Adresse ein Profil zur Übernahme angefragt, wird ein anderes (oder neues) Profil abgelehnt mit dem Hinweis, genau dieses auszuwählen.
4a. Nach dem Anlegen ist nur noch die Nachricht zu sehen (Fokus darauf). „Weiteren Zugang anlegen“ fragt vor dem Kopieren nach („Nachricht schon kopiert?“).
5. Freischalten: Registrierung absenden, Mail nicht öffnen. Team-Inbox › Unbestätigt › „Freischalten“ → Rückfrage im Eintrag → „Jetzt freischalten“. Bei „neu“ meldet sich die Person mit E-Mail und Passwort an und legt ihr Profil an; bei einer Übernahme steht danach „Die Übernahme liegt jetzt bei euch zur Prüfung.“ und die Anfrage ist unter Übernahmen prüfbereit, freigegeben ist noch nichts. Dort steht „E-Mail vom Team freigeschaltet (nicht per Mail bestätigt)“, ein Importabgleich zeigt nur „gleiche Adresse, nicht per Mail bestätigt“ statt „stimmt überein“. Im Eintrag unter „Unbestätigt“ steht für Admins die Adresse, die Rückfrage nennt Name und Adresse. Es geht dabei keine Mail raus.
6. Wartebildschirm nach dem Absenden (neu, Übernahme, Zuordnung): unter „Keine Mail da?“ steht, dass das Team freischalten kann. Nicht bei Anmeldelink und Passwort vergessen.
7. Das gewählte Passwort steht in keiner Tabelle des Schemas `operator`, in keinem Log und in keiner Antwort der Schnittstelle.

Roleplay:

8. Jede Roleplay-Session zeigt als Raum `https://discord.gg/sp75ZrWahH`, auch wenn früher ein Hand-Link eingetragen war; das Feld für einen eigenen Link erscheint bei Roleplay nicht. Der Kalendereintrag enthält denselben Link. Call-Block und Reflexion behalten Abgleich-Raum oder Hand-Link.
9. Mit eingerichtetem Discord-Abgleich: Roleplay bekommt keinen Sprachkanal, nur ein Discord-Event mit dem festen Link als Ort; ein früher angelegter Kanal wird abgeräumt.

## Betrieb vor dem öffentlichen Start

Betreiber- und Datenschutzangaben, endgültige Domain, Versanddomain und Zustellbarkeit ergänzen. Sicherungen, Wiederherstellungsweg und tatsächliche Tariflimits festlegen. Fehlerlogs ohne Zugangsdaten und private Formulardaten halten. Der Discord-Bot ist eine eigene noch offene Integration, beschrieben in [DISCORD.md](DISCORD.md).

Eine Freigabe „live nutzbar“ erst geben, wenn die echten Konto-, Mail- und Datenpersistenzprüfungen oben bestanden sind. Die lokale Vorschau allein belegt das nicht.
