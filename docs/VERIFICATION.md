# Prüfstand der Übergabe

Stand: 22. September 2026.

| Prüfung | Ergebnis |
|---|---|
| ESLint | Bestanden |
| 35 fachliche Tests mit isolierter PGlite-Datenbank | 35 bestanden, 0 fehlgeschlagen |
| Next.js Produktionsbuild einschließlich TypeScript | Bestanden |
| Start des gebauten Standalone-Pakets | Bestanden |
| Öffentliche Seiten, Demo-Seiten und lokal ausgelieferte Assets | HTTP-Prüfungen bestanden |
| Nicht angemeldete Zugriffe auf eigene Bereiche / private APIs | Weiterleitung bzw. 401 geprüft |
| Readiness ohne externe Konfiguration | Erwartet 503; kein fälschlich positiver Betriebsstatus |
| Konfigurationsprüfung ohne Zugangsdaten | Meldet die vier fehlenden Hauptvariablen, keine Verbindungsversuche |
| Browserdarstellung | Startseite, Ranking und Profilfenster, Desktopübersicht, mobile Anmeldung angesehen |
| Mobile Breiten | Ranking bei 320 und 390 px ohne Seitenüberbreite; Anmeldung bei 390 px geprüft |
| Ranking-Bedienung | Wechsel zu Beispielen, Kennzahlfilter, Profil öffnen und Escape-Schließen geprüft |
| Code-Scan vor Veröffentlichung | Keine erkannten Zugangsschlüssel oder persönlichen lokalen Pfade im portablen Quellstand |

Lokale Prüfungen liefen unter Node 24.19.0. Dockerfile und GitHub Actions verwenden Node 22, Mindestversion laut `package.json` ist 22.13.0. Docker ist auf dem lokalen Rechner nicht verfügbar; die tatsächliche Container-Prüfung ist deshalb als separater GitHub-Actions-Job enthalten. Ihren aktuellen Status im Repository prüfen.

**Noch nicht als live abgenommen:** Supabase-Erstinstallation, produktive Datenbankverbindung, echte E-Mail-Zustellung und Login, Coolify-Domain/HTTPS sowie Discord-Bot und automatische Synchronisation. Es wurden dafür keine Supabase-Daten oder Kontoeinstellungen geändert. Nach Einrichtung gilt `docs/ACCEPTANCE.md`; diese Datei ist kein Ersatz für die Live-Abnahme.
