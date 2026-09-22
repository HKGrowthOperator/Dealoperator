# Discord: geprüfter Stand und konkrete Lücke

Stand: 22. September 2026, gegen die produktive Datenbank und den Code im
Repository geprüft.

## Was tatsächlich existiert

Der gesamte Discord-Code im Repository ist `server/discord.ts` — 22 Zeilen, die
den Einladungslink prüfen und zurückgeben. Er lässt ausschließlich `https` auf
`discord.gg` oder `discord.com` zu und fällt sonst auf den offiziellen Link
`https://discord.gg/NjkFJtBkZm` zurück. Die Oberfläche verlinkt kontextbezogen
dorthin.

Das ist der vollständige Umfang. Es gibt **keinen Bot, keine Discord-OAuth-
Verknüpfung, keinen Worker und keine Synchronisierung in irgendeine Richtung**.

## Warum eine gefüllte Outbox kein Beweis ist

Jede Zahlenänderung schreibt in derselben Transaktion nach `operator.sync_outbox`
und erhöht dort `revision`. Das funktioniert. In der Produktionsdatenbank stehen
derzeit **47 Einträge, alle im Zustand `pending`**, der älteste seit dem Import.

Niemand liest diese Tabelle. Eine Suche über das gesamte Repository findet
`sync_outbox` an genau drei Stellen: zweimal schreibend (`server/operator.ts`,
`server/onboarding.ts`) und einmal in der Tabellenliste von
`server/readiness.ts`. Es gibt keinen Leser und keine Quittierung. Die Spalten
`state`, `attempts` und `next_attempt_at` sind vorbereitet, werden aber von
keinem Code ausgewertet.

**Eine gefüllte Outbox belegt also nur, dass die Website ihre Änderungen sauber
vormerkt — nicht, dass eine Nachricht jemals in Discord angekommen ist.**

## Was konkret fehlt

1. **Kontoverknüpfung.** Es gibt keine Tabelle, die eine Discord-User-ID einem
   bestätigten Website-Konto zuordnet, und keine OAuth-Route. Ohne diese
   Zuordnung kann ein Bot keine Meldung einer Person zuschreiben. Anzeigenamen
   sind ausdrücklich kein Identitätsnachweis.
2. **Bot-Dienst.** Kein Bot-Token, keine Anwendungs-/Client-ID, keine
   Slash-Command-Registrierung, kein laufender Prozess. Ein solcher Dienst
   müsste als eigene Anwendung in Coolify laufen; seine Zugangsdaten gehören
   ausschließlich serverseitig hinterlegt.
3. **Worker für Website → Discord.** Niemand liest die Outbox, merkt sich die
   gelesene `revision` und quittiert genau diese. Ohne das bleibt eine
   zwischenzeitlich neuere Änderung entweder liegen oder wird fälschlich als
   erledigt markiert.
4. **Eingang für Discord → Website.** Die vorhandenen API-Routen setzen eine
   Website-Sitzung und eine Origin-Prüfung voraus (`server/http.ts`). Für einen
   Bot ist das keine nutzbare Schnittstelle. Es braucht einen eng begrenzten,
   eigenständig authentifizierten Endpunkt, der dieselbe Geschäftslogik samt
   Revisions- und Idempotenzprüfung verwendet.
5. **Rollenabgleich.** Die Rangstufen der Website (Bronze bis Diamant, je
   Kennzahl getrennt) sind in `lib/kpis.ts` definiert. Welche Rollen-IDs,
   Schwellen und Zeiträume der Discord-Server bereits verwendet, ist hier
   unbekannt. Ohne diese Angaben dürfen vorhandene Rollen nicht überschrieben
   werden.

## Was dafür von außen nötig ist

Ohne diese Angaben lässt sich Punkt 1 bis 5 nicht bauen:

- Bot-Token sowie Client-ID und Client-Secret der Discord-Anwendung.
- Server-(Guild-)ID und die IDs der Rollen, die gesetzt werden sollen.
- Das bereits bestehende Rollenkonzept: welche Schwellen, Zeiträume und
  Aktivitätsregeln gelten heute im Server?
- Die gewünschte Kanalzuordnung für Meldungen.
- Die Entscheidung, wie die Kontoverknüpfung ablaufen soll — von Discord aus
  oder von der Website aus.

## Slack und Zoom

Die Übernahme der Meldungen aus Slack und Zoom ist bisher ein **kuratierter,
manueller Import**. Eine laufende automatische Übernahme ist nicht eingerichtet
und würde eine eigene Anbindung an die jeweiligen Exporte oder APIs brauchen.

## Was nicht behauptet werden darf

Weder Website noch Dokumentation dürfen eine funktionierende
Discord-Synchronisierung darstellen, solange Punkt 1 bis 5 offen sind. Die
Oberfläche sagt dazu heute „Discord-Anbindung wird vorbereitet"; das bleibt
korrekt. Es wurden für diese Prüfung keine Nachrichten in den Server gesendet.
