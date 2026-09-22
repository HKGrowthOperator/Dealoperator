import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthRange,
  monthSchema,
  bookedAppointments,
  summarizeRankingMonth,
} from "../lib/ranking-history";
import { emptyCounts, visibleMetrics } from "../lib/kpis";
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
