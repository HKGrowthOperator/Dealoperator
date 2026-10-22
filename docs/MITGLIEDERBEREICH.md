# Geschlossener Mitgliederbereich

Die Anwendung erfordert für Ergebnisse, Reflexionen, Mitglieder und Calls einen bestätigten und freigegebenen Zugang. Öffentlich bleiben nur Anmeldung, Zugangsanfrage, Status, rechtliche Seiten und notwendige Betriebsendpunkte. Namenssuche vor Anmeldung liefert ausschließlich Namen und Profilkennungen; sie überträgt kein Eigentum.

Bestehende freigegebene Konten behalten ihr Profil und sämtliche Tageszahlen. Neue Anfragen und Profilübernahmen werden nach E-Mail-Bestätigung durch das Team freigegeben. Vorbereitete importierte Profile bleiben unsichtbar, bis ihr Eigentümer ein Mitgliederprofil veröffentlicht.

Unter `/mitglieder/mein-profil` können Mitglieder Angebote, Branchen, Gesuche, Projekte, Referenzen, Kontaktwege und ein Profilfoto pflegen. Die Felder des Verzeichnisses werden bewusst selbst ausgefüllt; private Anmeldedaten werden nicht automatisch veröffentlicht. Die Suche trennt Anbieter von Gesuchen und Projekten. Fotos werden verkleinert als JPEG gespeichert und ausschließlich über einen geschützten Endpunkt ausgeliefert.

`/calls` verwendet den vorhandenen gemeinsamen Meetingraum, Termin- und Zusageablauf sowie vorhandene Erinnerungen. Ein aus einem Profil angefragter Termin gilt nicht automatisch als Zusage der anderen Person. Der Einladungslink kann anschließend geteilt werden.

Keine zusätzliche Datenbankmigration erforderlich: Erweiterungen werden in bestehenden `profiles.data`-Feldern `network` und `memberAvatar` gespeichert. Profil-IDs, Tageszahlen und bestehende Einstellungen bleiben erhalten.

Prüfung: Unit-/Datenbanktests mit PGlite, Typprüfung, Lint, Produktionsbuild, Standalone-Prüfung der anonymen Zugriffssperren und mobile UI-Vorschau mit ausdrücklich fiktiven Beispieldaten. Die Vorschau ersetzt keinen angemeldeten Live-Durchlauf.
