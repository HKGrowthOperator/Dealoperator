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
- KPI-Ränge heißen Level (Level 1 ab 100 Anwahlen, 5 Settings, 3 Closings, erstem Deal) mit XP-Leiste. Weitere Ideen stehen in `docs/IDEEN.md`.

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
