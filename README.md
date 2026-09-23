# Deal Operator

Kostenfreies Werkzeug fürs gemeinsame Callen: Tageszahlen und Learnings festhalten, den eigenen Fortschritt sehen, vorbereitete Profile übernehmen und dranbleiben. Das Callen selbst findet in der bestehenden Runde statt; Deal Operator ergänzt es. Discord ist ein optionaler Zusatz für Antworten auf Reflexionen und die Suche nach Call-Partnern.

**Für die Weiterarbeit:** [START-IN-CLAUDE.md](START-IN-CLAUDE.md). **Deployment:** [Coolify & Supabase](docs/DEPLOYMENT.md). **Discord:** [Integrationsvertrag](docs/DISCORD.md).

## Start

Node.js 22.13 oder neuer (CI und Docker: Node 22), npm:

```sh
npm ci
npm run dev
```

Vorschau: http://localhost:5173. Ohne Konfiguration bleibt die Anmeldung deaktiviert; Demo-Daten sind ausdrücklich fiktiv. Der Build benötigt keine Supabase-Zugangsdaten und verändert keine Datenbank.

## Was implementiert ist

- Öffentliche Rangliste: Zeitraum, Kennzahl, Suche, Profilfenster und gleiche Ränge bei gleichen Werten. Ausschließlich freigegebene Angaben, keine Kontaktfelder oder Reflexionen.
- E-Mail-Anmeldung über Supabase Auth mit PKCE, bestätigter E-Mail und serverseitig erneuerter Sitzung. Abmeldung funktioniert unabhängig von der Datenbankverfügbarkeit.
- Einstieg nach Bestätigung: vorbereitetes Profil übernehmen oder eigenes Profil anlegen. Zur E-Mail passende Importprofile werden angeboten; ein bewusster Neustart überschreibt sie nicht.
- Eigene Zahlen, Reflexionen, persönliche Ziele, sichtbares Profil, Anfragen an Call-Partner und Nachrichten, Sessions und Wissensaustausch benötigen ein bestätigtes Konto.
- Sieben getrennte KPIs, vier unabhängige Rangreihen, Korrekturen mit Revisionsprüfung und wiederholbare Speichervorgänge ohne Doppelzählung.
- CSV-/JSON-Importvorschau, atomarer Betreiberimport und private Kontaktübersicht. Die feste Grundverwaltung kommt aus `OPERATOR_ADMIN_IDS` und lässt sich in der App nicht ändern. Weitere Admins und Moderatoren vergibt ein Admin unter Verwaltung → Team & Rollen (Tabelle `team_roles`, Migration 0004). Moderatoren bearbeiten Team-Inbox, Wins-Import, Prüffälle, Pausen und Übernahmen, aber keine Einstellungen, Rollen oder Kontaktliste. Team-Hinweise zu neuen Anmeldungen gehen als Push und E-Mail an alle Admins und Moderatoren.
- Profilübernahme über bestätigte passende E-Mail oder einen zufälligen, einmal verwendbaren Code. Codes werden gehasht gespeichert, sind sieben Tage gültig und werden bei Neuausstellung widerrufen.
- Kontextbezogene Links zum offiziellen Discord-Server: https://discord.gg/NjkFJtBkZm.
- Blaues Erscheinungsbild, Original-D-Ausschnitt des bereitgestellten Logos, lokale Manrope-Schriften, Glaseffekte und dezente Animationen mit Unterstützung für reduzierte Bewegung. Sichtbarer Name ausschließlich Deal Operator; Wortwahl „kostenfrei“.

Das Partnerregister wird auf der Website nicht angeboten. Alte Register-Links führen zum Discord-Abschnitt. Historische Registertabellen bleiben geschützt im Schema; die aktuelle Oberfläche verwendet sie nicht.

## Was für den echten Betrieb noch eingerichtet werden muss

Das Repository ist vorbereitet; **eine erfolgreiche echte Anmeldung ist erst nach externer Einrichtung möglich**:

1. Das ausdrücklich freigegebene neue Supabase-Projekt auswählen, `database/schema.sql` und anschließend `database/runtime-role.sql` prüfen und einmalig installieren.
2. Verbindungsdaten, TLS-Zertifikat falls erforderlich und `APP_URL` in Coolify hinterlegen; eine eigene Datenbankrolle statt des Projektadministrators verwenden.
3. Supabase Site URL/Redirects und SMTP einrichten, z. B. mit Resend. Zwei getrennte Testkonten tatsächlich anmelden und ihren Zugriff testen.
4. GitHub-Repository in Coolify als Dockerfile-Anwendung verbinden, Domain/HTTPS setzen und starten.
5. Betreiber-/Datenschutzangaben ergänzen und echte Teilnehmerdaten nur mit geklärter Sichtbarkeit importieren.

**Der Discord-Einladungslink funktioniert als Einstieg. Ein Bot, Kontoverknüpfung und automatische KPI-/Rollen-Synchronisation sind noch nicht implementiert.** Der transaktionale Auftragsspeicher und der Vertrag für diese nächste Erweiterung sind vorhanden. Website und Discord dürfen nicht als bereits synchron beworben werden.

## Routen

| Bereich                                 | Adresse                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Einstieg / Ranking                      | `/`, `/ranking`                                                                                       |
| E-Mail-Anmeldung / Callback             | `/starten`, `/auth/callback`                                                                        |
| Profil einrichten / übernehmen          | `/start`, `/profil-uebernehmen`                                                                       |
| Persönlicher Bereich                    | `/heute`, `/zahlen`, `/reflexion`, `/partner`, `/sessions`, `/wissen`, `/profil`, `/so-funktionierts` |
| Verwaltung                              | `/verwaltung`                                                                                         |
| Prozessstatus / Verbindungsbereitschaft | `/api/health`, `/api/ready`                                                                           |

Frühere Adressen des persönlichen Bereichs leiten auf die neuen Pfade weiter. Routen des persönlichen Bereichs führen ohne Anmeldung zur Anmeldung und anschließend in den eigenen Bereich. Kontaktinformationen sind weder im öffentlichen Ranking noch in der Website-Ausgabe der Startseite enthalten. Eine bestätigte E-Mail verifiziert die Kontrolle über diese Adresse, nicht die bürgerliche Identität; Telefonnummern sind freiwillig und nicht SMS-verifiziert.

## Prüfen

```sh
npm run lint
npm test
npm run build
npm run smoke
npm run preflight
```

`npm test` verwendet ausschließlich einen flüchtigen PGlite-PostgreSQL-Speicher. `npm run smoke` startet den eigenständigen Produktionsserver auf Port 5175 ohne externe Konfiguration, prüft Routen, Assets und Anmeldegrenzen und beendet ihn anschließend. `npm run preflight` liest vorhandene Umgebungsvariablen sowie optional `.env.production`/`.env.local`, prüft Verbindung und Tabellenrechte und schreibt keine Daten. Ohne Konfiguration muss dieser Check fehlschlagen.

GitHub Actions prüft zusätzlich den tatsächlichen Docker-Build einschließlich des vollständigen Build-Kontexts. Die Anwendung wird durch CI nicht veröffentlicht. [Abnahmeplan](docs/ACCEPTANCE.md).

## Code-Aufteilung

- `app/`: Next.js-Routen, UI und serverseitige HTTP-Endpunkte.
- `server/operator.ts`: Profilanlage, Claim, Import, Check-ins, Kontaktübersicht und Eigentumsprüfungen.
- `server/database.ts`, `server/config.ts`: PostgreSQL-Verbindung, Transaktionen und geprüfte TLS-Konfiguration.
- `lib/kpis.ts`: gemeinsame Definitionen für Kennzahlen, Import und Ränge.
- `database/`: einmalige, manuell freizugebende Erstinstallation; keine automatischen Startup-Migrationen.
- `docs/`, `deploy/`: unabhängige Übergabe, SMTP-Vorlage und Betriebsabnahme.

Keine Laufzeit-Abhängigkeit von ChatGPT, Codex, Sites, Cloudflare D1 oder einem Agenten. Die Anwendung läuft als eigenständiger Node-Server. Alte Sites-Beispiele werden nicht in das Übergabearchiv oder den Docker-Build aufgenommen.
