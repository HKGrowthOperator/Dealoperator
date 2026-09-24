# Deal Operator in Claude weiterführen

Repository: https://github.com/HKGrowthOperator/Dealoperator

## Auftrag

Übernimm diese bestehende Website unverändert als Grundlage. Richte ihren Betrieb auf dem vorhandenen Hetzner-Server über Coolify und die Verbindung zum neuen, ausdrücklich bestätigten Supabase-Projekt ein. Das Design ist bereits umgesetzt; kein Neubau und kein Wechsel des Frameworks.

Lies zuerst `README.md`, `docs/DEPLOYMENT.md`, `docs/ACCEPTANCE.md` und `docs/DISCORD.md`. Bei Programmänderungen gelten außerdem `AGENTS.md` und die mit Next.js ausgelieferten lokalen Versionshinweise.

## Produktentscheidungen

- Name: Deal Operator. Die andere Produktmarke darf auf der Website noch nicht genannt werden.
- Dauerhafte Community für aktive Caller, kein einzelner Akquise-Tag als Positionierung.
- Überall „kostenfrei“, keine generischen Paywall-Sprüche. Tracking, Buddys, Sessions, Reflexion und Austausch sind kostenfrei.
- Partnerregister vorerst ausschließlich auf Discord, keine Registerseite oder Verkaufsfläche auf der Website.
- Originales gefaltetes D, dunkles Blau/Cyan, lokal ausgelieferte Manrope-Schrift, professionelle Glaseffekte, ruhige Animationen. Keine dekorativen Pfeile an jedem Button.
- Offizieller Discord-Einstieg: https://discord.gg/NjkFJtBkZm.
- Echte Zahlen werden nie erfunden. Die vorhandenen Beispiele sind ausdrücklich fiktiv.
- Bereits importierte Personen übernehmen ihr Profil nach Verifizierung; Namen allein sind kein Identitätsnachweis. Bestehende Historie bleibt bei einer Übernahme bestehen.
- Seit 23.09.2026: Discord ist für Calls da (Sessions, Roleplay, Call-Partner, sich gegenseitig pushen, Ränge). Tagesabschlüsse und Reflexionen bleiben auf der Website und werden nicht im Discord geteilt. Kein „bevorzugter Kanal“ im Profil.
- Sessions entstehen auf der Website (mindestens 12 Stunden Vorlauf, spätestens am Vortag); der Abgleich legt je Session einen Discord-Raum samt Event an und trägt den Link ein. Plätze wählt der Host frei (2 bis 25).
- Rang „Aktiver Caller“: 5 Calling-Tage am Stück mit mindestens 50 Anwahlen; weg nach 3 Calling-Tagen in Folge ohne Anwahlen. Schaltet Sessions & Roleplay frei (sichtbar ist die Sektion immer) und ist im Discord eine Rolle. Admins und Moderatoren haben immer Zugang und dürfen alle Sessions bearbeiten und absagen.
- KPI-Ränge heißen Leistungslevel (Level 1 ab 100 Anwahlen, 5 Settings, 3 Closings, erstem Deal). Fortschritt steht immer in echten Einheiten („80 von 100 Anwahlen“, „Noch 2 Settings bis Level 2“), nie als „XP“ oder Punkte. Levels bleiben dezent: kompakt unter Mein Tag, Details unter Mein Fortschritt. Weitere Ideen stehen in `docs/IDEEN.md`.
- Seit 24.09.2026 (UX-Überarbeitung, Gestaltungskontext in `docs/PRODUCT.md`): Die gemeinsame Startseite bleibt auch nach der Anmeldung das Zentrum; ohne ausdrückliches Ziel führt die Anmeldung nach `/`, ausdrückliche Ziele bleiben erhalten. Bereiche: Ergebnisse (`/`, `/ranking` mit denselben Bausteinen), Mein Tag (`/tagesabschluss`, dazu Fortschritt `/heute`, Zahlen `/zahlen`, Profil und Einstellungen `/profil`), Reflexionen (`/reflexionen`, dazu `/partner`, `/sessions`, `/wissen`). Ein Kopf für alle Seiten, auf dem Handy eine Tableiste. Ohne gewählten Zeitraum zeigt die Startseite heute oder den letzten gemeldeten Tag, gekennzeichnet. Rangliste als durchgehende Liste, Gleichstände teilen Platz und Gestaltung. Tagesabschluss nur noch über `/tagesabschluss`; Erinnerungen, Geräte und Discord-Verknüpfung unter Profil und Einstellungen, Kalender und Pausen unter Mein Fortschritt. Erinnerungen werden nach dem Einreichen einmal angeboten. Discord erscheint nur im Zusammenhang (Reflexion, Call-Partner, nach dem Einreichen). „So funktioniert’s“ ist eine öffentliche Seite (`/so-funktionierts`); ihre Regeln und Zeiten kommen aus denselben Einstellungen wie die App. Telefonfelder heißen nur „Nummer“ (mit Ländervorwahl daneben), ohne Zusatztexte. Seit 24.09.2026 (auf Wunsch): Wie man Deal Operator als App hinzufügt (iPhone/iPad Home-Bildschirm, Mac Safari Dock, Android Startbildschirm, sonst „App installieren“), steht nur in den Benachrichtigungs-Einstellungen unter Profil, an Stelle der früheren Ruhezeit. Keine Aufforderung an anderer Stelle, kein Browser-Banner; nach dem Einreichen wird Push weiterhin nur dort angeboten, wo es im Browser geht. Die Ruhezeit gibt es nicht mehr: nicht in der Oberfläche, nicht beim Speichern, nicht beim Versand; die Spalten `quiet_start`/`quiet_end` bleiben ungenutzt stehen (keine Supabase-Änderung).
- Seit 24.09.2026: Kam eine Bestätigungsmail nicht an, fordert das Team sie in der Verwaltung neu an („Mail erneut senden“ unter Team-Inbox › Unbestätigt und unter Übernahmen). Der Versand läuft ohne Sitzung im Team-Browser; der Link bestätigt nur die Adresse. Danach meldet sich die Person mit E-Mail und Passwort an, und die Anfrage wird bis zu 7 Tage nach dem Neuversand auch ohne Cookie gebunden. Übernahmen bleiben in der Teamprüfung. Scheitert beim Registrierungslink nur das Einlösen (anderes Gerät, alter Schlüssel im Browser), zeigt `/starten` „E-Mail bestätigt“ mit Anmeldung statt einer Fehlermeldung.
- Push-Symbol: Jede Meldung trägt das D (`/icon-192.png`, einfarbig als Badge `/badge-96.png` für Android). Safari ignoriert Symbole von Websites (WebKit-Bug 280162); dort steht das Safari-Symbol, außer Deal Operator liegt als Web-App im Dock (macOS) oder auf dem Home-Bildschirm (iOS). Die Anleitung dazu steht in den Benachrichtigungs-Einstellungen.
- Seit 24.09.2026 (Überarbeitung nach UX-Prüfung): Name, Firma und Rolle gibt es nur einmal, im eigenen Profil der Rangliste („Profil und Einstellungen“ › Dein Profil). Das Call-Profil ergänzt nur Zielgruppe, Call-Zeit, Wochenziel und Tage und übernimmt Name und Rolle von dort; es überschreibt `participants` nicht mehr. Ein vergangener Calling-Tag ohne eigenen Abschluss, aber mit Zahlen aus dem gemeinsamen Import heißt „Übernommen“: Die Zahlen zählen (auch gegen Inaktivität), der Tag gilt nicht als fehlend, die Serie wächst an ihm aber nicht. „Mein Fortschritt“ zeigt Serie, Tage mit Anwahlen und eigene Abschlüsse getrennt; die Regeln stehen aufklappbar. Einheitliche Begriffe: „Rangliste“ (nicht „Ranking“), Kennzahl „Anwahlen“. Übernahmen ablehnen geht nur mit einer Nachricht an die Person (vom Server geprüft) und nach einer Rückfrage. Die Verwaltung gliedert ihre Bereiche in Heute, Import und Einstellungen; das Team sieht „Verwaltung“ im Kopf. Gestaltung: `.btn` und `.do-button` sehen gleich aus, Umschalter (Tabs) wie die Bereichsnavigation, keine Großbuchstaben-Überzeilen und keine Symbolkacheln über Überschriften, Tippflächen ab 44 px, Fließtext am Desktop auf etwa 60ch begrenzt. Die Schrift Inter ist entfernt (nur Manrope).

## Arbeitsreihenfolge

1. `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm run smoke` ausführen.
2. Das neue Supabase-Zielprojekt in der Organisation Deal Operator bestätigen. Nick hat ausdrücklich verlangt, Änderungen in Supabase vorher abzustimmen. Andere bestehende Projekte nicht verändern, zurücksetzen oder ersetzen.
3. Die beiden SQL-Erstinstallationsdateien prüfen. Nur nach Freigabe in diesem neuen Projekt ausführen; nie bei jedem Build/Start. Bei bereits vorhandenen Tabellen zunächst den tatsächlichen Stand untersuchen, nicht blind erneut installieren.
4. Coolify als Dockerfile-Anwendung konfigurieren, Domain/HTTPS und Laufzeitvariablen aus `.env.example` setzen. Zugangsdaten ausschließlich in geschützten Einstellungen hinterlegen, niemals im Repository oder Chat wiedergeben.
5. Supabase E-Mail-Anmeldung, Redirects und Resend-SMTP wie dokumentiert einrichten. Kein Benutzer soll zur Anmeldung von einem laufenden Agenten abhängig sein.
6. `/api/ready` und `npm run preflight` prüfen. Danach die vollständige Abnahme mit zwei realen Testkonten durchführen: Bestätigung, Profil anlegen/übernehmen, speichern, neu laden, abmelden, wieder anmelden und fremde Datenzugriffe ablehnen.
7. Betreiberangaben und freigegebene Teilnehmerdaten ergänzen. Erst nach dieser Abnahme als live und funktionsfähig bezeichnen.
8. Discord-Bot und bidirektionale Synchronisation anhand `docs/DISCORD.md` umsetzen, sobald Bot-Zugang, Server-/Rollenkennung und die gewünschte Kontoverknüpfung vorliegen. Diese Funktion ist im aktuellen Stand noch offen.

## Technische Leitplanken

Next.js 16, React 19, Node 22, PostgreSQL über `pg`, Supabase Auth über `@supabase/ssr`. Die Anwendungsdaten liegen im privaten Schema `operator`. Nur die serverseitige Datenbankrolle erhält Zugriff; Eigentumsprüfungen liegen in den API-Anwendungsfällen. Kein `service_role` im Browser. Keine lokalen Demo-Daten als Produktionsspeicher verwenden.

`/api/health` ist ein Prozesscheck, `/api/ready` prüft Konfiguration und Datenbank. Keiner dieser Checks bestätigt alleine funktionierenden Mailversand oder einen Discord-Bot. Die 36 lokalen Tests und der Produktions-Smoke-Test ersetzen die echte Abnahme nach dem Anschließen externer Dienste nicht.
