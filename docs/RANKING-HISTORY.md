# Public ranking, daily archive and monthly overview

The home page and `/ranking` now lead with the crew's results, followed by the selected KPI's podium and complete ranking. Both use the same client component. Existing onboarding, manual claim approval and Discord invitation remain in place.

## Shareable views

- `/ranking?day=2026-09-22&metric=attempts`: a specific day, including its winners.
- `/ranking?month=2026-09&metric=settingsBooked`: only that month's totals.
- With no selection, the view defaults to the current day in Europe/Berlin.
- Browser back/forward and reload preserve the URL selection.
- Selecting a chart bar, calendar day or daily winner opens that day's ranking.

`GET /api/ranking/month?month=YYYY-MM&day=YYYY-MM-DD` returns the selected day's rows plus the month's daily summaries and winners. Omit `day` for monthly rows. One date-bounded query supplies the whole response, respecting `participants.public_consent`. No private contact fields or reflections are selected. Future/invalid dates and days outside the selected month are rejected. The response is not cached.

Daily bars are **daily values, never cumulative**. Missing days and unknown metrics are not fabricated zeros. Monthly aggregation is bounded to the selected month. Positive equal values retain every tied daily winner. Zero is a valid recorded value but is not celebrated as a daily win. Imported team profiles count once. Corrections replace the existing `(participant, day)` record and consequently update the archive; this is a view of reported day totals, not an immutable event snapshot.

## Retired metric

The user removed `decisionMakerConversations` because it was not recorded consistently. `visibleMetrics` uses Claude’s `publicMetrics` selection and excludes both this metric and untyped legacy appointments from the public ranking, profile details, check-in editor, personal overview, CSV export, sharing text and import template. Stored legacy data and the internal schema remain compatible. The new public history endpoint returns null for this retired metric. No database migration is needed.

## Event and new data

`2026-09-22` is marked **Akquise Day**, with thanks and a link to akquise.de. This is a fixed dated event, not branding for all future days. The event remains selectable in the September archive. `AKQUISE_DAY` is defined in `lib/ranking-history.ts`.

On 22 September, Kerstin's 18:56 Slack report was added once as `akq-2026-kerstin`, 20 attempts. Four people reached and four follow-ups were not counted as booked appointments. This import is already live; do not reimport it. The verified day now contains **52 public profiles, 5,147 attempts, 97 settings booked, 4 closings booked, 38 appointments without type, 3 settings held, 1 closing held and 1 deal won**. The public booked-appointment total is 101 (97 settings + 4 closings). The 38 untyped appointments remain stored but are excluded from the public metric selection and total, preserving Claude’s 6b7bacf change. Existing alias mappings and the two joint team profiles were preserved.

Continue importing full day totals using stable participant keys and the actual date. New check-ins and imports appear automatically on the next visible-page refresh (20 seconds). Raw Slack/Discord messages are **not automatically read or imported**. Discord bot synchronization is still separate work; see `DISCORD-STATUS.md`.

## Validation

Database tests cover month boundaries, daily vs monthly aggregation, daily winners, ties, teams, corrected imports, private-profile exclusion and unknown vs zero. Endpoint tests reject invalid/future/mismatched dates. Existing claim and authorization tests remain intact. Production build and standalone smoke checks must pass before release.

## Gemeinsame Meldungen (`participants.kind`)

Zwei Datensätze — „Myran und Baris" und „David & Jannik" — sind keine Personen, sondern von mehreren Personen gemeinsam erbrachte Leistungen. Sie gegen einzelne Personen zu ranken wäre unfair, und sie zu halbieren hieße, Zahlen zu erfinden.

Die Art steht seit Migration `0002_participant_kind.sql` in einer eigenen Spalte `participants.kind` (`person` | `joint`). Der frühere Rollentext „Team · …" bleibt als Beschriftung erhalten, entscheidet aber nichts mehr: er ist frei bearbeitbar und war deshalb als Merkmal nicht haltbar.

**Verbindliche Regel: im Einzelranking tritt genau eine Person mit ihren eigenen belegten Zahlen an.**

Durchgesetzt wird das in der Datenverarbeitung, nicht in der Oberfläche:

- `ranked()` in `lib/kpis.ts` filtert gemeinsame Meldungen heraus. Podium, Tabelle, Tagesgewinner und Monatsplatzierungen gehen alle durch diese Funktion, damit gibt es keinen Weg daran vorbei. `DailyLeader.people` enthält folglich nur Personen.
- `aggregate()` bleibt unverändert und ist die einzige Stelle, an der gemeinsame Meldungen mitzählen — genau einmal, zur Gesamtleistung der Crew.
- `summarizeRankingMonth` zählt `profiles` (Personen) und `joint` (gemeinsame Meldungen) getrennt. Zwei gemeinsame Meldungen sind nicht zwei zusätzliche Personen.
- `searchProfiles` liefert nur `kind='person'`. `profileForSelection`, `startRequest` (über die Auswahl), die Teamfreigabe in `decideRequest` unter der Zeilensperre und `issueClaim` weisen gemeinsame Meldungen über `refusePersonalUse` ab. Fehlt die Spalte in einer Abfrage, bricht die Prüfung ab, statt stillschweigend durchzulassen.
- Der Import kennt die Spalte `kind` (CSV und JSON, Vorgabe `person`). Ein `joint`-Datensatz wird zugleich aus der Profilsuche genommen.

Die Oberfläche zeigt gemeinsame Meldungen weiterhin, aber außerhalb der Rangliste in einem eigenen Block „Gemeinsam gemeldet", ohne Rang und ohne Übernahmeknopf.

Wenn später belegte Einzelwerte vorliegen, ersetzt beziehungsweise verrechnet der Import die zugehörige gemeinsame Meldung. Teamgesamtstand und dieselben Einzelwerte dürfen nie zusätzlich nebeneinander in die Gruppensumme laufen.

## Mobile Darstellung

Die Zahlenansicht kommt ohne seitliches Schieben aus; `overflow-x: hidden` als Notlösung gibt es nicht.

- Die Rangliste ist eine Liste (`.rr-rank-list`), keine Tabelle: Rang, Name und Wert in einer Zeile, der Leistungsbalken darunter über die volle Breite. Lange Namen brechen um.
- Das Podium stellt auf schmalen Geräten Platz 1 quer und prominent dar, Platz 2 und 3 kompakt darunter.
- Die Gruppen-KPIs stehen in einem 2×2-Raster; die Zahlengröße wächst mit der Breite (`clamp`), damit auch lange Zahlen vollständig sichtbar bleiben.
- Kennzahl- und Zeitraumwahl brechen um, statt seitlich zu scrollen.
- Die Check-in-Historie im Mitgliedsbereich besteht aus Tageskarten (`.checkin-cards`): oben Datum und Bearbeiten, darunter die Kennzahlen im Raster, Energie und Reflexion in der Karte aufklappbar.

Geprüft mit Playwright auf 280, 320, 360, 390, 430 und 1280 Pixeln — je Element auf eigenes horizontales Scrollen, Hinausragen und abgeschnittenen Text, auch in Monatsansicht, geöffnetem Archiv, Profil-Dialog und Suche sowie mit einem 48 Zeichen langen Namen und siebenstelligen Werten. Die Prüfung bricht ab, wenn das CSS nicht geladen ist, damit eine ungestylte Seite nicht als sauber durchgeht.

## Aufteilung der beiden gemeinsamen Meldungen (50/50)

Am 22.09.2026 haben zwei Duos abends einen gemeinsamen Tagesstand gemeldet:

| Quelle                                   | Zeit  | Meldung                                 |
| ---------------------------------------- | ----- | --------------------------------------- |
| `akq-2026-myran-omo` — Myran und Baris   | 18:01 | 300 Anwahlen, 2 vereinbarte Settings    |
| `akq-2026-david-jannik` — David & Jannik | 18:02 | 222 Anwahlen, 13 Termine ohne Typangabe |

Auf ausdrücklichen Wunsch werden diese Zahlen **50/50** auf die beteiligten Personen gerechnet, damit jede Person im Einzelranking antritt:

| Profil       | Schlüssel                   | Zugeteilt               |
| ------------ | --------------------------- | ----------------------- |
| David Pixner | `akq-2026-david-pixner`     | 111 Anwahlen            |
| Jannik Alber | `akq-2026-jannik-alber`     | 111 Anwahlen            |
| Myran Omo    | `akq-2026-myran-omo-person` | 150 Anwahlen, 1 Setting |
| Baris        | `akq-2026-baris`            | 150 Anwahlen, 1 Setting |

Das sind **rechnerisch zugeteilte Werte**, keine einzeln gemeldeten. `lib/joint-reports.ts` hält Originalmeldung und Aufteilung nebeneinander fest; die Profildetails schreiben an jedes betroffene Profil „50/50 aus gemeinsamer Meldung aufgeteilt" und nennen die Quelle samt Uhrzeit.

**Die Gruppenleistung bleibt identisch.** Die Quelldatensätze bleiben als Beleg erhalten, ihre verteilten Werte stehen dort aber auf null — sonst zählte dieselbe Leistung zweimal. `splitProblems()` prüft für jede Kennzahl, dass die Summe der Anteile genau der Meldung entspricht und keine Kennzahl der Meldung stillschweigend verschwindet; `tests/ranking-history.test.ts` rechnet das zusätzlich über `aggregate()` gegen. Die SQL-Migration hat dieselbe Prüfung im selben Schritt ausgeführt und wäre bei einer Abweichung abgebrochen.

**Die 13 Termine ohne Typangabe bleiben ungeteilt.** 13 durch 2 ergibt 6,5. Halbe Termine gibt es nicht, gerundet wird nicht, und aus einem Termin ohne Typangabe wird weder ein Setting noch ein Closing. Die Kennzahl ist öffentlich ausgeblendet, deshalb stehen die 13 weiterhin im Quelldatensatz und zählen dort genau einmal. Die ganzzahlige Eingabe echter Termine bleibt davon unberührt.

**Verwechslungsschutz:** David Pixner ist nicht David Erharter (`akq-2026-david-erharter`), Jannik Alber ist nicht Yannick de Groot (`akq-2026-yannick-de-groot`). Alle vier Schlüssel sind neu und eigenständig; ein Test hält das fest. Der Schlüssel `akq-2026-myran-omo` gehört historisch dem gemeinsamen Datensatz, deshalb trägt die Person `akq-2026-myran-omo-person`.

## Leere Zeilen im Ranking

Eine Rangliste zeigt nur Personen mit einer Meldung **für genau diese Kennzahl**. `ranked()` filtert über `reportedIn()`; wer bei Anwahlen nichts gemeldet hat, fehlt dort und kann trotzdem im Setting-Ranking stehen. Eine ausdrücklich gemeldete **0 bleibt drin** — sie ist eine Aussage, kein fehlender Wert. Wer in keiner öffentlichen Kennzahl etwas gemeldet hat, erscheint in keiner Rangliste. Gelöscht wird dabei nichts: Profile und gespeicherte Werte bleiben, und die Profilauswahl zur späteren Übernahme ist davon unberührt. Die Zahl neben der Liste ist die Zahl der Zeilen darin.

## Discord-Einstieg

Der erste sichtbare Bereich trägt „Zusammen callen. Gemeinsam dranbleiben.", einen Satz dazu und zwei Wege: „Auf Discord weitercallen" (direkt auf den bestehenden Server) und „Meine Zahlen & mein Profil". Der Block steht bewusst **außerhalb** der Lade- und Fehlerzweige, damit der Weg in den Server nie davon abhängt, ob die Zahlen gerade abrufbar sind. In der Hauptnavigation steht „Austausch auf Discord" statt eines zweiten Community-Angebots.

Geprüft auf 320×568, 360×640, 390×844, 430×932 und Desktop, jeweils mit ladenden und mit fehlschlagenden Zahlen: der Knopf liegt vollständig im ersten Bildschirm, ohne Scrollen und ohne Anmeldung.
