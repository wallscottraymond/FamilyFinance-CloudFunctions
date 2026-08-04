/**
 * reconcile_occurrences Domain Service — Unit Tests
 *
 * Verifies payments settle the closest still-unpaid occurrence within tolerance,
 * earliest-first (no double-assignment), out-of-tolerance payments leave the
 * occurrence unpaid, and the output flows into place_occurrences producing the
 * right paid rollup.
 */

import {
  reconcile_occurrences,
  reconcile_income_occurrences,
  ExpectedOccurrence,
  ActualPayment,
} from "../reconcile_occurrences.service";
import {
  place_occurrences,
  PlacementBucket,
} from "../occurrence_placement.service";

const OUT = "outflow1";
const day = (y: number, m: number, d: number) => Date.UTC(y, m, d);

function expected(id: string, due_ms: number, amount = 2000): ExpectedOccurrence {
  return { occurrence_id: id, recurring_id: OUT, due_date_ms: due_ms, amount_due: amount };
}
function payment(txn: string, date_ms: number, amount = 2000): ActualPayment {
  return { transaction_id: txn, split_id: `${txn}_s`, date_ms, amount };
}

describe("reconcile_income_occurrences", () => {
  const IN = "inflow1";
  const W_START = day(2026, 6, 1); // July
  const W_END = day(2026, 6, 31);

  it("each actual deposit in the window is a received (paid) occurrence", () => {
    const r = reconcile_income_occurrences(
      IN,
      [payment("t1", day(2026, 6, 15), 3358), payment("t2", day(2026, 6, 31), 36725)],
      null,
      10406,
      W_START,
      W_END
    );
    expect(r.length).toBe(2);
    expect(r.every((o) => o.is_paid)).toBe(true);
    expect(r.reduce((s, o) => s + o.amount_paid, 0)).toBe(40083);
  });

  it("projects predicted_next as ONE outstanding occurrence when unpaid & in-window", () => {
    const r = reconcile_income_occurrences(IN, [], day(2026, 6, 15), 10406, W_START, W_END);
    expect(r.length).toBe(1);
    expect(r[0].is_paid).toBe(false);
    expect(r[0].amount_due).toBe(10406);
  });

  it("does NOT project predicted_next if a deposit already covers it (within tolerance)", () => {
    const r = reconcile_income_occurrences(
      IN,
      [payment("t1", day(2026, 6, 15), 10000)],
      day(2026, 6, 16),
      10406,
      W_START,
      W_END
    );
    expect(r.length).toBe(1); // just the paid one, no duplicate outstanding
    expect(r[0].is_paid).toBe(true);
  });

  it("ignores predicted_next outside the window", () => {
    const r = reconcile_income_occurrences(IN, [], day(2026, 7, 15), 10406, W_START, W_END);
    expect(r.length).toBe(0);
  });
});

describe("reconcile_occurrences", () => {
  it("settles the occurrence when a payment lands on the due date", () => {
    const [r] = reconcile_occurrences(
      [expected("o1", day(2026, 5, 15))],
      [payment("t1", day(2026, 5, 15))]
    );
    expect(r.is_paid).toBe(true);
    expect(r.amount_paid).toBe(2000);
    expect(r.matched_transaction_id).toBe("t1");
    expect(r.matched_split_id).toBe("t1_s");
    expect(r.payment_date_ms).toBe(day(2026, 5, 15));
  });

  it("matches a payment a few days off (within tolerance)", () => {
    const [r] = reconcile_occurrences(
      [expected("o1", day(2026, 5, 15))],
      [payment("t1", day(2026, 5, 18))] // +3 days
    );
    expect(r.is_paid).toBe(true);
  });

  it("leaves the occurrence unpaid when the payment is beyond tolerance", () => {
    const [r] = reconcile_occurrences(
      [expected("o1", day(2026, 5, 15))],
      [payment("t1", day(2026, 5, 27))], // +12 days, default tol 7
      { tolerance_days: 7 }
    );
    expect(r.is_paid).toBe(false);
    expect(r.amount_paid).toBe(0);
    expect(r.matched_transaction_id).toBe(null);
  });

  it("does not double-assign: two payments settle two distinct occurrences", () => {
    const occs = [expected("o1", day(2026, 5, 1)), expected("o2", day(2026, 5, 15))];
    const pays = [payment("t1", day(2026, 5, 2)), payment("t2", day(2026, 5, 16))];
    const r = reconcile_occurrences(occs, pays);
    expect(r[0].is_paid).toBe(true);
    expect(r[0].matched_transaction_id).toBe("t1");
    expect(r[1].is_paid).toBe(true);
    expect(r[1].matched_transaction_id).toBe("t2");
  });

  it("earliest payment claims the earliest occurrence on close ties", () => {
    // Two occurrences a day apart, two payments; ensure 1:1 earliest-first.
    const occs = [expected("o1", day(2026, 5, 10)), expected("o2", day(2026, 5, 11))];
    const pays = [payment("t1", day(2026, 5, 10)), payment("t2", day(2026, 5, 11))];
    const r = reconcile_occurrences(occs, pays);
    expect(r[0].matched_transaction_id).toBe("t1");
    expect(r[1].matched_transaction_id).toBe("t2");
    expect(r.filter((o) => o.is_paid).length).toBe(2);
  });

  it("reconciled output flows into place_occurrences as a paid group", () => {
    const reconciled = reconcile_occurrences(
      [expected("o1", day(2026, 5, 15))],
      [payment("t1", day(2026, 5, 15))]
    );
    const monthBucket: PlacementBucket = {
      period_id: "2026M06",
      start_ms: day(2026, 5, 1),
      end_ms: Date.UTC(2026, 5, 30, 23, 59, 59),
    };
    const [group] = place_occurrences(reconciled, [monthBucket]);
    expect(group.count_in_period).toBe(1);
    expect(group.count_paid).toBe(1);
    expect(group.total_paid).toBe(2000);
    expect(group.is_fully_paid).toBe(true);
    expect(group.status).toBe("paid");
  });
});
