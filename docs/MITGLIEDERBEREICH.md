# Geschlossener Mitgliederbereich

Ergebnisse und Ranglisten bleiben öffentlich. Für Reflexionen, Mitglieder und Calls ist ein bestätigter und freigegebener Zugang erforderlich. Öffentlich sind außerdem Anmeldung, Zugangsanfrage, Status, rechtliche Seiten und notwendige Betriebsendpunkte. Namenssuche vor Anmeldung liefert ausschließlich Namen und Profilkennungen; sie überträgt kein Eigentum.

Bestehende freigegebene Konten behalten ihr Profil und sämtliche Tageszahlen. Neue Anfragen und Profilübernahmen werden nach E-Mail-Bestätigung durch das Team freigegeben. Vorbereitete importierte Profile bleiben unsichtbar, bis ihr Eigentümer ein Mitgliederprofil veröffentlicht.

Unter `/mitglieder/mein-profil` können Mitglieder Angebote, Branchen, Gesuche, Projekte, Referenzen, Kontaktwege und ein Profilfoto pflegen. Die Felder des Verzeichnisses werden bewusst selbst ausgefüllt; private Anmeldedaten werden nicht automatisch veröffentlicht. Die Suche trennt Anbieter von Gesuchen und Projekten. Fotos werden verkleinert als JPEG gespeichert und ausschließlich über einen geschützten Endpunkt ausgeliefert.

`/calls` verwendet den vorhandenen gemeinsamen Meetingraum, Termin- und Zusageablauf sowie vorhandene Erinnerungen. Ein aus einem Profil angefragter Termin gilt nicht automatisch als Zusage der anderen Person. Der Einladungslink kann anschließend geteilt werden.

Keine zusätzliche Datenbankmigration erforderlich: Erweiterungen werden in bestehenden `profiles.data`-Feldern `network` und `memberAvatar` gespeichert. Profil-IDs, Tageszahlen und bestehende Einstellungen bleiben erhalten.

Prüfung: Unit-/Datenbanktests mit PGlite, Typprüfung, Lint, Produktionsbuild, Standalone-Prüfung der anonymen Zugriffssperren und mobile UI-Vorschau mit ausdrücklich fiktiven Beispieldaten. Die Vorschau ersetzt keinen angemeldeten Live-Durchlauf.

## Mitglieder, Angebote und Einstieg

Vor dem ersten Verzeichnisbesuch wird das bestehende Profil um Tätigkeit, Leistungen, Branchen, Kurzvorstellung und mindestens einen Kontaktweg ergänzt. Ein dreiteiliger Ablauf fragt Tätigkeit, Erfahrung und Kontakt ab. Projekte und Referenzen sind optional und gehören zur Person. Vorhandene private Kontaktdaten werden nur im eigenen Formular vorbelegt; veröffentlicht wird über den ausdrücklichen Profilspeicherschritt. Neue Zugangsanfragen können eine Herkunft oder Empfehlung als Nachricht für die Teamprüfung enthalten.

Entwürfe werden beim Weitergehen in `profiles.data.memberNetworkDraft` gespeichert. Sie stellen weder eine Veröffentlichung noch eine zusätzliche Zugangsfreigabe dar. Erst das abschließende Speichern schreibt `network` und entfernt den Entwurf.

Unter `/mitglieder/angebote` können freigegebene Mitglieder mit vollständigem, veröffentlichtem Profil Aufträge zur Weitergabe, Zusammenarbeit oder freie Kapazitäten einstellen, bearbeiten und erledigen. Beiträge sind ebenfalls privat und bleiben an die echte Profilkennung des Autors gebunden. Die API nimmt keine fremde Autorenkennung an. Angebote liegen in `profiles.data.memberOffers`; Profiländerungen, Fotos und bestehende Einstellungen bleiben erhalten. Kein Messenger, Vertragsversand oder Dateispeicher wurde eingeführt.
