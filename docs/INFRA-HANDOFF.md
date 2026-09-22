# Infrastruktur-Übergabe

Stand: 22. September 2026. Projekt `xfusnmbwymfkuuadyrlw`, Website
https://dealoperator.hk-growthoperator.de

Keine Geheimnisse in dieser Datei. Alle Werte werden ausschließlich in den
geschützten Einstellungen von Coolify bzw. Supabase eingetragen.

## 1. Laufzeitvariablen in Coolify

Alle acht Variablen sind **Laufzeitvariablen**. Keine davon wird beim Build
gebraucht: `npm run build` läuft ohne Supabase- und Datenbankzugang, und es gibt
keine `NEXT_PUBLIC_*`-Variable, die in das Browser-Bundle eingebacken würde.

| Variable                   | Pflicht | Wert                                                                 |
| -------------------------- | ------- | -------------------------------------------------------------------- |
| `APP_URL`                  | ja      | `https://dealoperator.hk-growthoperator.de` — ohne Pfad, ohne `/` am Ende |
| `SUPABASE_URL`             | ja      | Projekt-URL, siehe Abschnitt 2                                        |
| `SUPABASE_PUBLISHABLE_KEY` | ja      | Publishable Key, siehe Abschnitt 2                                    |
| `DATABASE_URL`             | ja      | Verbindung der Rolle `operator_app`, siehe Abschnitt 4                |
| `DATABASE_SSL_CA`          | nein    | Nur falls das Zertifikat nicht über die öffentliche CA prüfbar ist     |
| `DATABASE_SSL`             | nein    | In Produktion **leer lassen**                                          |
| `OPERATOR_ADMIN_IDS`       | später  | Auth-User-UUIDs der Verwaltung, siehe Abschnitt 5                      |
| `DISCORD_INVITE_URL`       | nein    | Nur als Ersatz des hinterlegten offiziellen Links                      |

Weitere Coolify-Einstellungen: Build Pack **Dockerfile**, interner Port **3000**,
Healthcheck `GET /api/health`.

## 2. Welcher Supabase-Schlüssel

Gemeint ist der **Publishable Key** (`sb_publishable_…`), im Dashboard unter
*Project Settings → API Keys*. Er ist für den Browser bestimmt und darf
öffentlich sein.

Ausdrücklich **nicht**: Service-Role-/Secret-Key (`sb_secret_…`), das
Datenbankpasswort oder ein Supabase-Management-Token. Der Server weist einen
Key ab, der mit `sb_secret_` beginnt — `/api/ready` bleibt dann bei 503.

`SUPABASE_URL` steht auf derselben Seite als Project URL
(`https://xfusnmbwymfkuuadyrlw.supabase.co`).

## 3. Datenbank: was bereits angewendet ist

Bereits ausgeführt (per Supabase-MCP, im Projekt `xfusnmbwymfkuuadyrlw`):

- `operator_schema_install` — Schema `operator`, 22 Tabellen, 39 Indizes, RLS auf
  allen Tabellen, `REVOKE ALL … FROM PUBLIC`. Entspricht `database/schema.sql`
  inklusive der neuen Tabellen `onboarding_requests` und `onboarding_events`
  sowie der Spalte `participants.searchable`.
- `operator_app_runtime_role` — Rolle `operator_app`, `GRANT USAGE` auf das
  Schema, DML-Rechte auf alle 22 Tabellen, Sequenzrechte, je eine Policy
  `operator_server_access`, plus
  `ALTER ROLE operator_app SET search_path = operator, pg_catalog`.
- Datenimport der 23 vorbereiteten Profile mit den Meldungen vom 22.09.2026,
  `public_consent=true`, `searchable=true`, ohne E-Mail-Adressen.

**Noch offen — genau ein Schritt:** für `operator_app` ein Passwort setzen. Das
SQL enthält bewusst keins. Im Dashboard über den SQL-Editor:

```sql
ALTER ROLE operator_app PASSWORD '<starkes Passwort>';
```

Die Migrationsdateien unter `database/migrations/` sind für Installationen
gedacht, die `schema.sql` **vor** dieser Änderung ausgeführt haben. Für dieses
Projekt sind sie **nicht** nötig und dürfen nicht zusätzlich laufen.

## 4. DATABASE_URL

Aus *Connect* im Dashboard die **Session-Pooler**-Verbindung kopieren (Port
**5432**). Port 6543 (Transaction Pooler) weist die Anwendung bewusst ab, weil
sie einen festen Session-Suchpfad nutzt.

Form: `postgresql://operator_app.xfusnmbwymfkuuadyrlw:<PASSWORT>@<pooler-host>:5432/postgres`

- Den Host aus dem Dialog übernehmen, nicht aus der Region ableiten.
- Das Passwort URL-kodieren, falls es Sonderzeichen enthält.
- **Keine Query-Parameter anhängen.** Die Anwendung weist `ssl`, `options`,
  `host`, `port`, `user`, `password`, `dbname` und `sslnegotiation` ausdrücklich
  ab, weil sie sonst die geprüfte TLS-Konfiguration und den Suchpfad
  überschreiben würden. Bei Zertifikatsfehlern das CA-Zertifikat über
  `DATABASE_SSL_CA` nachreichen, niemals die Prüfung abschalten.

TLS ist ohne weitere Angabe aktiv und wird geprüft. `DATABASE_SSL=disable` ist
nur für eine lokale Loopback-Datenbank erlaubt.

## 5. Nach dem Eintragen

Coolify braucht nach dem Setzen von Laufzeitvariablen einen **Neustart der
Anwendung**. Ein neuer Build ist nicht nötig, weil keine der Variablen in das
Image kompiliert wird — ein Redeploy schadet aber nicht.

Danach der Reihe nach prüfen:

1. `GET /api/ready` → `200` mit `{"ready":true,...}`. Bleibt es bei `503`, sagt
   das Feld `configuration` bzw. `database`, welche Seite noch fehlt.
2. `GET /api/ranking` → `snapshot: false` und 23 Zeilen aus der Datenbank.
   Solange `snapshot: true` erscheint, liefert noch die freigegebene
   Momentaufnahme aus dem Repository.
3. Verwaltung freischalten: mit dem Betreiberkonto anmelden, danach die
   Auth-User-UUID aus *Authentication → Users* in `OPERATOR_ADMIN_IDS`
   eintragen (kommagetrennt) und erneut neu starten. Erst dann ist
   `/verwaltung` mit der Warteschlange der Übernahmeanfragen erreichbar.
4. Echte Abnahme nach `docs/ACCEPTANCE.md` mit zwei Testkonten.

## 6. Mailversand

Bereits eingerichtet und hier nichts zu tun: Resend als Custom SMTP in Supabase,
Absender Deal Operator, deutsche Vorlagen, Site URL und Redirect-Allowlist auf
`/auth/callback`. Der Resend-Schlüssel liegt in Supabase und gehört **nicht** in
Coolify.

Anzupassen bleibt nur der Vorlagentext: `deploy/auth-email.html` unterscheidet
jetzt zwischen bestätigter E-Mail und freigegebenem Profil und nutzt
`{{ .Data.onboarding_kind }}`. Fehlt die Variable, greift ein neutraler Text.
Beim ersten echten Versand gegenprüfen.
