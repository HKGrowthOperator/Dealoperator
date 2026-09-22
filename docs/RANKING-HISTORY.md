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
