/**
 * occurrence_placement Domain Service — Unit Tests
 *
 * Verifies canonical occurrences are placed into the single viewed bucket whose
 * range contains their due date, that reconciliation rolls up (counts, totals,
 * status), and that the SAME occurrence set places consistently across cadences
 * (monthly vs weekly) with identical totals/paid-status — only the bucketing
 * differs. This is the core invariant of "one canonical fact, placed on read".
 */

import {
  place_occurrences,
  CanonicalOccurrence,
  PlacementBucket,
} from "../occurrence_placement.service";

const OUT = "outflow1";

// A monthly mortgage: one occurrence per month, due the 15th.
function occ(
  id: string,
  due_ms: number,
  over: Partial<CanonicalOccurrence> = {}
): CanonicalOccurrence {
  return {
    occurrence_id: id,
    recurring_id: OUT,
    due_date_ms: due_ms,
    amount_due: 2000,
    amount_paid: 0,
    is_paid: false,
    ...over,
  };
}

const JUN_15 = Date.UTC(2026, 5, 15);
const JUL_15 = Date.UTC(2026, 6, 15);

const junMonthBucket: PlacementBucket = {
  period_id: "2026M06",
  start_ms: Date.UTC(2026, 5, 1),
  end_ms: Date.UTC(2026, 5, 30, 23, 59, 59),
};
// June weeks (Jun 15 falls in the Jun 15–21 week).
const junWeeks: PlacementBucket[] = [
  { period_id: "wA", start_ms: Date.UTC(2026, 5, 1), end_ms: Date.UTC(2026, 5, 7, 23, 59, 59) },
  { period_id: "wB", start_ms: Date.UTC(2026, 5, 8), end_ms: Date.UTC(2026, 5, 14, 23, 59, 59) },
  { period_id: "wC", start_ms: Date.UTC(2026, 5, 15), end_ms: Date.UTC(2026, 5, 21, 23, 59, 59) },
  { period_id: "wD", start_ms: Date.UTC(2026, 5, 22), end_ms: Date.UTC(2026, 5, 28, 23, 59, 59) },
];

describe("place_occurrences", () => {
  it("places an occurrence in the bucket whose range contains its due date", () => {
    const groups = place_occurrences([occ("o1", JUN_15)], junWeeks);
    const byId = Object.fromEntries(groups.map((g) => [g.period_id, g]));
    expect(byId.wC.count_in_period).toBe(1); // Jun 15 → week C
    expect(byId.wC.occurrence_ids).toEqual(["o1"]);
    expect(byId.wA.count_in_period).toBe(0);
    expect(byId.wB.count_in_period).toBe(0);
    expect(byId.wD.count_in_period).toBe(0);
  });

  it("rolls up totals + unpaid status for an unpaid occurrence", () => {
    const [g] = place_occurrences([occ("o1", JUN_15)], [junMonthBucket]);
    expect(g.total_due).toBe(2000);
    expect(g.total_paid).toBe(0);
    expect(g.total_unpaid).toBe(2000);
    expect(g.count_in_period).toBe(1);
    expect(g.count_paid).toBe(0);
    expect(g.is_due_period).toBe(true);
    expect(g.is_fully_paid).toBe(false);
    expect(g.status).toBe("pending");
  });

  it("marks fully paid when the occurrence is paid", () => {
    const [g] = place_occurrences(
      [occ("o1", JUN_15, { is_paid: true, amount_paid: 2000 })],
      [junMonthBucket]
    );
    expect(g.total_paid).toBe(2000);
    expect(g.total_unpaid).toBe(0);
    expect(g.is_fully_paid).toBe(true);
    expect(g.status).toBe("paid");
  });

  it("marks partial when some occurrences in the bucket are paid", () => {
    // A weekly bill: two occurrences in June, one paid.
    const occs = [
      occ("o1", Date.UTC(2026, 5, 3), { amount_due: 50, is_paid: true, amount_paid: 50 }),
      occ("o2", Date.UTC(2026, 5, 17), { amount_due: 50 }),
    ];
    const [g] = place_occurrences(occs, [junMonthBucket]);
    expect(g.count_in_period).toBe(2);
    expect(g.count_paid).toBe(1);
    expect(g.count_unpaid).toBe(1);
    expect(g.total_due).toBe(100);
    expect(g.total_paid).toBe(50);
    expect(g.is_partially_paid).toBe(true);
    expect(g.status).toBe("partial");
  });

  it("empty bucket → status none, not due", () => {
    const [g] = place_occurrences([occ("o1", JUL_15)], [junMonthBucket]);
    expect(g.count_in_period).toBe(0);
    expect(g.is_due_period).toBe(false);
    expect(g.status).toBe("none");
  });

  it("drops occurrences outside every bucket (out of window)", () => {
    const groups = place_occurrences([occ("o1", JUL_15)], junWeeks);
    expect(groups.every((g) => g.count_in_period === 0)).toBe(true);
  });

  it("SAME occurrence places consistently across cadences (one canonical fact)", () => {
    // One paid mortgage occurrence, viewed monthly vs weekly → identical totals
    // and paid-status; only the bucket differs.
    const o = occ("o1", JUN_15, { is_paid: true, amount_paid: 2000 });
    const [monthly] = place_occurrences([o], [junMonthBucket]);
    const weekly = place_occurrences([o], junWeeks);
    const weeklyDue = weekly.find((g) => g.count_in_period > 0)!;

    expect(weeklyDue.period_id).toBe("wC");
    // Same fact in both views:
    expect(weeklyDue.total_due).toBe(monthly.total_due);
    expect(weeklyDue.total_paid).toBe(monthly.total_paid);
    expect(weeklyDue.is_fully_paid).toBe(monthly.is_fully_paid);
    expect(weeklyDue.status).toBe(monthly.status);
    // And it appears exactly once across the weekly buckets (no duplication):
    expect(weekly.reduce((n, g) => n + g.count_in_period, 0)).toBe(1);
  });
});
