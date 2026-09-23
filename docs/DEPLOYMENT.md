# Betrieb auf Coolify und Supabase

## Zuständigkeiten

GitHub enthält den vollständigen Quellcode. Coolify baut das Docker-Image und betreibt den Node-Server auf Hetzner. Supabase übernimmt Auth und PostgreSQL. Resend kann als SMTP-Anbieter direkt an Supabase Auth angeschlossen werden. Der Discord-Einladungslink ist davon unabhängig. Für diese Architektur ist kein laufender Claude-/Codex-/MCP-Prozess nötig.

## 1. Supabase vorbereiten — nach Freigabe

Nur das neue bestätigte Projekt in der Organisation Deal Operator verwenden. Das Projekt wurde zuvor im Dashboard als vorhanden geprüft, ist aber nicht automatisch mit diesem Checkout verbunden.

1. Vorhandenen Tabellen- und Rollenstand lesen. `database/schema.sql` ist für eine **leere Erstinstallation** gedacht; vorhandene Tabellen nicht löschen, um es erneut auszuführen.
2. Die Schema-Datei einmalig als Projektadministrator ausführen. Sie verwendet eine Transaktion und das private Schema `operator`.
3. `database/runtime-role.sql` prüfen und einmalig ausführen. Die Rolle `operator_app` kann Anwendungsdaten bearbeiten, besitzt aber weder Tabellen noch Superuser-, DDL- oder BYPASSRLS-Rechte. Die nur dieser Serverrolle geltenden RLS-Policies passen zum Modell mit Eigentumsprüfung im Node-Backend. `anon` und `authenticated` erhalten keinen Zugriff auf dieses Schema.
4. Für `operator_app` ein starkes eigenes Passwort über eine sichere Administrationssitzung setzen. Das SQL enthält bewusst kein Passwort. Passwort nicht in eine versionierte Datei schreiben.
5. In „Connect“ eine direkte Verbindung oder **Session pooler** kopieren. Für IPv4 ist der Session-Pooler geeignet. Den tatsächlichen Host aus dem Dialog übernehmen, nicht aus der Region ableiten. Bei einer eigenen Rolle ist der Pooler-Benutzer `operator_app.PROJECT_REF`, Port 5432. Port 6543/Transaction mode ist für diese Anwendung nicht vorgesehen, weil sie einen festen Session-Suchpfad nutzt.
6. Schema `operator` nicht als Data-API-Schema freigeben. Kein zusätzliches GRANT an Browserrollen hinzufügen.

Nach späteren Schemaerweiterungen müssen Tabellenrechte und die Serverpolicy bewusst mitgeführt werden. Die Erstinstallationsdateien sind keine automatisch wiederholbaren Migrationen.

### Nachträgliche Migrationen

Für eine bestehende Installation liegen die Nachträge unter `database/migrations/` und werden einmalig in dieser Reihenfolge als Projektadministrator ausgeführt:

1. `0001_onboarding_requests.sql` und danach `0001_onboarding_requests_grants.sql` (neue Tabellen brauchen Rechte und Policy ausdrücklich).
2. `0002_participant_kind.sql` — fügt `participants.kind` hinzu und markiert die beiden bestehenden gemeinsamen Meldungen. Rein additiv, mit Vorgabewert `person`, deshalb ohne Rechte-Nachtrag: die tabellenweiten Rechte aus `runtime-role.sql` decken neue Spalten ab.

3. `0003_daily_closing.sql` — Tagesabschluss (Zahlen + Reflexion), private Entwürfe, Pausen, Dranbleiben-Regeln, Events (22.09.2026 „Akquise Day“ von akquise.de), Push-Abonnements, Versandprotokoll mit Zustellung je Gerät, Team-Inbox, Discord-Zuordnung, Wins-Import-Prüffälle. Rein additiv; bestehende Tagesstände bekommen `origin='import'`, es werden keine Reflexionen erfunden. Enthält Rechte und Serverpolicy für die neuen Tabellen und Zähler.

`0002` ist am 22.09.2026, `0003` und `0004` (Team-Rollen) am 23.09.2026 auf der produktiven Datenbank angewendet worden. `0004` ist rein additiv: eine leere Tabelle `team_roles` mit RLS, Zugriff nur für `operator_app`. Auch hier gilt: erst die Migration, dann der Code, weil `/api/ready` die Tabelle prüft.

**Reihenfolge bei 0003:** erst die Migration anwenden, dann den Code ausrollen. `/api/ready` prüft ab dieser Version die neuen Tabellen, Spalten und Zählerrechte und meldet 503, solange die Migration fehlt. Der Erinnerungs-Takt pausiert in diesem Fall von selbst.

## 2. Coolify-Anwendung

- Quelle: `HKGrowthOperator/Dealoperator`, Branch `main`.
- Build Pack: **Dockerfile**, Pfad `/Dockerfile`, Basisverzeichnis `/`.
- Interner Port: **3000**, Bindung des Containers: `0.0.0.0`.
- Eine gewünschte HTTPS-Domain in Coolify hinterlegen. Der Proxy terminiert TLS; `APP_URL` ist diese externe HTTPS-Adresse ohne abschließenden Pfad.
- Runtime-Umgebungsvariablen setzen, keine Build-Secrets nötig.
- Healthcheck: HTTP `GET /api/health`, Port 3000. Der Dockerfile enthält denselben Prozesscheck.
- Nach dem Anschließen zusätzlich `GET /api/ready` verlangen: Status 200, `ready: true`. Bei fehlender Konfiguration oder Datenbankproblemen: 503. Keine Green-Checks allein aus `/api/health` ableiten.
- Keinen persistenten Dateispeicher für Mitgliederzahlen anlegen; sie gehören in PostgreSQL. `compose.yaml` ist nur eine Alternative für manuelles Docker Compose außerhalb der Coolify-Dockerfile-Einrichtung.

Der Docker-Build nimmt den Ordner `vendor/` mit, weil die Oberfläche daraus eine benötigte CSS-Datei importiert. `.next/standalone`, `.next/static` und `public/` werden in das Runtime-Image kopiert. Der Prozess läuft als Benutzer `node`.

## 3. Laufzeitvariablen

| Variable                   | Wert / Zweck                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `APP_URL`                  | Externe HTTPS-Domain der Website, ohne Unterpfad                                            |
| `SUPABASE_URL`             | Projekt-URL aus dem bestätigten neuen Projekt                                               |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable Key dieses Projekts, kein Secret-/Service-Role-Key                              |
| `DATABASE_URL`             | PostgreSQL-Verbindung der Rolle `operator_app`; Passwort URL-kodieren                       |
| `DATABASE_SSL_CA`          | Falls erforderlich, PEM-Zertifikat aus dem Supabase-Projekt; echte Zeilenumbrüche oder `\n` |
| `DATABASE_SSL`             | In Produktion leer lassen. `disable` ist nur bei einer lokalen Loopback-Datenbank zulässig  |
| `OPERATOR_ADMIN_IDS`       | Kommagetrennte bestätigte Auth-User-UUIDs der Betreiber; erst nach Registrierung zuweisen   |
| `DISCORD_INVITE_URL`       | Optionaler Ersatz des bereits hinterlegten offiziellen Links                                |
| `RESEND_API_KEY`           | Eigener Resend-API-Schlüssel nur für die kurzen Team-E-Mails (Absicherung zum Push). Der Auth-Mailversand über Supabase-SMTP bleibt davon unberührt |
| `NOTIFY_FROM`              | Absender der Team-E-Mails auf einer in Resend verifizierten Domain, z. B. `Deal Operator <team@…>` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional. Schlüsselpaar für Web-Push. Fehlt es, erzeugt der Server beim ersten Bedarf einmalig ein Paar und legt es im privaten Schema ab (`operator.app_secrets`, nur Serverrolle). Später gesetzte Umgebungswerte ersetzen es — dann müssen alle Geräte neu zustimmen; die Verwaltung zeigt die Anzahl |
| `CRON_SECRET`              | Optional, mindestens 32 Zeichen. Erlaubt einen externen Takt `POST /api/cron/tick` mit `Authorization: Bearer …` (z. B. Coolify Scheduled Task). Ohne Wert gibt es den Endpunkt nicht; der Takt im Server-Prozess läuft trotzdem |
| `SCHEDULER_DISABLED`       | `1` schaltet den Takt im Server-Prozess ab (nur für Wartung)                                 |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Kontoverknüpfung (OAuth2 „identify“). Redirect in Discord: `APP_URL/api/discord/callback` |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_REFLECTION_CHANNEL_ID` | Beiträge freigegebener Tagesabschlüsse im Reflexions-Channel, Rollen-/Channel-Inventar |
| `DISCORD_PUBLIC_KEY`       | Signaturprüfung für `POST /api/discord/interactions` (Befehle `/tagesabschluss`, `/serie`) |

Der Server erzwingt für externe PostgreSQL-Verbindungen eine Zertifikatsprüfung. Unsichere `sslmode`-Optionen in der URL können diese Prüfung nicht abschalten. Bei Zertifikatsfehlern CA/Host prüfen, nicht `rejectUnauthorized: false` einbauen.

## 4. E-Mail-Anmeldung

In Supabase Auth:

1. E-Mail-Anmeldung aktivieren und öffentliche Registrierung zulassen, sofern die Community geöffnet werden soll.
2. Site URL exakt auf `APP_URL` setzen.
3. Redirect Allow List auf `https://DEINE-DOMAIN/auth/callback**` begrenzen, damit der dokumentierte `next`-Parameter funktioniert. Für lokale Abnahme gesondert `http://localhost:5173/auth/callback**` hinzufügen; keine globalen Wildcards für fremde Domains.
4. Custom SMTP einschalten: bei Resend üblicherweise Host `smtp.resend.com`, Port 465, Benutzer `resend`, Passwort = Resend-API-Key, Absender auf einer verifizierten Versanddomain. Die tatsächlichen Werte im Resend-Dashboard gegenprüfen. Schlüssel nur im geschützten SMTP-Feld hinterlegen.
5. `deploy/auth-email.html` als Textvorlage für **Confirm sign up** und **Magic link** verwenden, Betreff z. B. „Dein Zugang zu Deal Operator“. Die Variable `{{ .ConfirmationURL }}` unverändert lassen.
6. Link-Tracking des SMTP-Anbieters für Auth-Mails deaktivieren. Den Link im selben Browser öffnen, in dem er angefordert wurde, weil der PKCE-Verifier dort liegt. Bei Gerätewechsel erneut auf dem Zielgerät einen Link anfordern.
7. Echte Zustellung, Link-Ablauf, ungültige Links und erneute Anmeldung testen. Die Standard-Supabase-Testzustellung ist keine fertig eingerichtete Community-Versandlösung.

Nach bestätigter E-Mail führt `/auth/callback` zu `/start`. Bestehende Mitglieder gehen direkt in den gewünschten Bereich. Neue Konten entstehen über `/starten` („Ich bin neu“ oder „Meine Zahlen sind schon auf der Seite“). Wer mit einer neuen Adresse „Anmelden“ nutzt, bekommt ebenfalls einen Link; nach der Bestätigung führt `/start` durch die Profileinrichtung, und das Team bekommt genau einen Hinweis. Die frühere Adresse `/beitreten` leitet mit allen Angaben auf `/starten` weiter. Telefonnummern sind privat und nicht SMS-verifiziert; für den eigenen Tagesabschluss muss eine gültige Nummer mit Ländervorwahl hinterlegt sein. Ein Twilio-Konto wird nicht benötigt.

## 4a. Erinnerungen, Team-Hinweise und Discord

- **Takt:** Der Node-Prozess startet beim Hochfahren einen Minutentakt (`instrumentation.ts`). Planung unter Datenbanksperre; jede Meldung hat einen eindeutigen Schlüssel, und je Gerät wird höchstens einmal zugestellt. Mehrere Instanzen oder ein zusätzlicher Cron-Aufruf erzeugen keine Doppelungen.
- **Mitglieder:** 20:30 Uhr Erinnerung, wenn der Abschluss eines Pflicht-Tags fehlt; 09:00 Uhr am nächsten Pflicht-Tag nur, wenn eine laufende Serie tatsächlich hängt. Nie am Wochenende, nie in Pausen oder Ruhezeiten, nie nach eingereichtem Abschluss. Push nur nach Zustimmung auf dem Gerät; auf iPhone/iPad erst ab iOS 16.4 und nur als Home-Bildschirm-App.
- **Team:** Neue bestätigte Registrierung bzw. prüfbereite Übernahme → genau ein Inbox-Eintrag und je Verwaltungskonto ein Push plus eine kurze E-Mail (neutraler Text, keine Kontaktdaten). Unbestätigte Registrierungen erscheinen gesammelt in der Verwaltung, ohne Push. Ohne Gerät bzw. E-Mail-Konfiguration wartet der Hinweis bis zu 48 Stunden.
- **Discord:** Ohne die oben genannten Werte bleibt alles aus und wird in der Verwaltung als „nicht eingerichtet“ mit den fehlenden Variablen angezeigt. Übertragen werden nur Abschlüsse, bei denen das Mitglied das Teilen auf Discord ausdrücklich angekreuzt hat, und nur aus den letzten sieben Tagen.

## 5. Prüfung und Freischaltung

Im Quellcheckout mit denselben geschützten Umgebungsvariablen:

```sh
npm ci
npm run preflight
```

Im Runtime-Image ist `tsx` nicht nötig und nicht installiert; dort `/api/ready` verwenden. Anschließend den [Abnahmeplan](ACCEPTANCE.md) mit zwei echten Testkonten ausführen. Vor Öffnung Betreiber-/Datenschutzangaben ergänzen, Datenbanksicherung und Wiederherstellung passend zum tatsächlichen Supabase-Plan festlegen und Admin-Zugang prüfen.

Bei Problemen:

- Build scheitert an CSS: vollständigen Git-Checkout, `vendor/` und Dockerignore prüfen.
- Website läuft, Anmeldung gesperrt: vier Hauptvariablen, `/api/ready` und DB-Rechte prüfen.
- E-Mail kommt nicht: SMTP-Absenderdomain, Supabase Auth-Logs und Versandlimits prüfen.
- Callback kehrt mit `fehler=link` zurück: Browserwechsel, abgelaufenen Link, Redirect Allow List und tatsächliche HTTPS-Domain prüfen.
- Eigene Zahlen fehlen nach Login: Konto, Profilzuordnung und Datenbank prüfen. Nicht neu importieren oder Profile löschen, um eine Zuordnung zu erzwingen.

## Offizielle Referenzen

Geprüft am 22. September 2026: [Coolify Dockerfile](https://coolify.io/docs/applications/builds/dockerfile), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [PostgreSQL-Verbindungen](https://supabase.com/docs/guides/database/connecting-to-postgres), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [E-Mail-Vorlagen](https://supabase.com/docs/guides/auth/auth-email-templates), [Resend SMTP](https://resend.com/docs/send-with-smtp). Bei späterer Einrichtung die aktuellen Einstellungen gegen diese Dokumentation prüfen.
