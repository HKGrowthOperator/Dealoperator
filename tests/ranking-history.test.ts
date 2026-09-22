import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthRange,
  monthSchema,
  bookedAppointments,
  summarizeRankingMonth,
} from "../lib/ranking-history";
import { emptyCounts, visibleMetrics, type Counts } from "../lib/kpis";
import { GET } from "../app/api/ranking/month/route";

test("month boundaries respect leap years and current day", () => {
  assert.deepEqual(monthRange("2024-02", "2026-09-22"), {
    from: "2024-02-01",
    to: "2024-02-29",
    last: "2024-02-29",
  });
  assert.equal(monthRange("2026-09", "2026-09-22").to, "2026-09-22");
  assert.equal(monthRange("2026-08", "2026-09-22").to, "2026-08-31");
  for (const value of ["2026-00", "2026-13", "2026-2", "2099-01", "abcd"])
    assert.equal(monthSchema.safeParse(value).success, false);
});
test("appointment total includes verified booked types once, excludes legacy/held values and preserves missing values", () => {
  assert.equal(
    bookedAppointments({
      ...emptyCounts(),
      settingsBooked: 97,
      closingsBooked: 4,
      legacyMeetings: 38,
      settingsHeld: 3,
      closingsHeld: 1,
    }),
    101,
  );
  assert.equal(bookedAppointments(emptyCounts()), null);
  assert.equal(bookedAppointments({ ...emptyCounts(), settingsBooked: 0 }), 0);
  assert.equal(
    visibleMetrics.includes("decisionMakerConversations" as never),
    false,
  );
  assert.deepEqual(summarizeRankingMonth([], "2026-08"), {
    month: "2026-08",
    days: [],
    rows: [],
  });
});
test("splitting a joint report leaves the crew performance unchanged", async () => {
  const { jointReports, splitProblems } = await import(
    "../lib/joint-reports"
  );
  const { aggregate, metrics } = await import("../lib/kpis");
  assert.ok(jointReports.length > 0);
  for (const joint of jointReports) {
    // Die Aufteilung darf die Meldung weder vergrößern noch verkleinern.
    assert.deepEqual(splitProblems(joint), [], joint.key);

    // Gegenprobe über die tatsächliche Summenbildung: vorher trug der
    // gemeinsame Datensatz seine Meldung bei, nachher tragen die Personen
    // ihre Anteile bei und der Quelldatensatz nur noch das Ungeteilte.
    const full = (partial: Partial<Counts>): Counts => ({
      ...emptyCounts(),
      ...partial,
    });
    const vorher = aggregate([full(joint.report)]);
    const nachher = aggregate([
      ...joint.parts.map((part) => full(part.counts)),
      full(
        Object.fromEntries(
          joint.kept.map((k) => [k.metric, k.total]),
        ) as Partial<Counts>,
      ),
    ]);
    for (const metric of metrics)
      assert.equal(nachher[metric], vorher[metric], `${joint.key} ${metric}`);
  }
});

test("a split share is never invented and never rounded", async () => {
  const { jointReports, splitOrigin, jointReport } = await import(
    "../lib/joint-reports"
  );
  const [davidJannik, myranBaris] = jointReports;

  // Jede Person kennt ihre Herkunft, der gemeinsame Datensatz sich selbst.
  assert.equal(splitOrigin("akq-2026-david-pixner")?.key, davidJannik.key);
  assert.equal(splitOrigin("akq-2026-baris")?.key, myranBaris.key);
  assert.equal(splitOrigin("akq-2026-david-erharter"), null);
  assert.equal(jointReport(davidJannik.key)?.name, "David & Jannik");

  // Die 13 Termine ohne Typangabe bleiben ungeteilt: 6,5 wird weder gerundet
  // noch in eine andere Kennzahl umgedeutet.
  const kept = davidJannik.kept.find((k) => k.metric === "legacyMeetings");
  assert.equal(kept?.perPerson, 6.5);
  for (const part of davidJannik.parts) {
    assert.equal(part.counts.legacyMeetings, undefined);
    assert.equal(part.counts.settingsBooked, undefined);
    assert.equal(part.counts.closingsBooked, undefined);
  }

  // Verwechslungsschutz: die Anteile laufen auf eigene Schlüssel, nicht auf
  // die bereits vorhandenen Profile ähnlicher Namen.
  const keys = jointReports.flatMap((j) => j.parts.map((p) => p.key));
  assert.equal(keys.includes("akq-2026-david-erharter"), false);
  assert.equal(keys.includes("akq-2026-yannick-de-groot"), false);
  assert.equal(new Set(keys).size, keys.length);
});

test("history endpoint rejects malformed, future and mismatched date selections", async () => {
  for (const query of [
    "month=2026-13",
    "month=2099-01",
    "month=2026-08&day=2026-07-31",
    "month=2026-08&day=2026-08-32",
    "day=2099-01-01",
  ]) {
    const response = await GET(
      new Request(`http://localhost/api/ranking/month?${query}`),
    );
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});
