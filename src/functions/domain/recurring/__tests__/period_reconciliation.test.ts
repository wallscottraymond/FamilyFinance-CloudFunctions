/**
 * @file period_reconciliation.test.ts
 * @description Unit tests for the pure period-reconciliation domain service
 * (Recurring-Period-Reconciliation Phase 3b). No IO, no mocks.
 *
 * Covers the decided rules:
 *  - Alignment = HYBRID: date-in-range default; early-autopay override across a
 *    boundary; nearest-due-date fallback in a gap; tolerance = half period.
 *  - Status = HYBRID by amount-variability: fixed → amount threshold; variable →
 *    presence-based. Refunds net down. Pending tracked separately (posted flips).
 */

import {
  align_transaction_to_period,
  compute_period_reconciliation,
  default_tolerance_ms,
  default_early_window_ms,
  PeriodForAlignment,
  LinkedSplit,
} from "../period_reconciliation.service";

const DAY = 24 * 60 * 60 * 1000;
// Anchor everything to a fixed epoch (no Date.now()).
const JAN1 = Date.UTC(2026, 0, 1);
const FEB1 = Date.UTC(2026, 1, 1);
const MAR1 = Date.UTC(2026, 2, 1);
const d = (y: number, m: number, day: number) => Date.UTC(y, m, day);

// A monthly bill, due on the 1st: Jan / Feb periods.
const MONTHLY: PeriodForAlignment[] = [
  { period_id: "jan", start_ms: JAN1, end_ms: d(2026, 0, 31), due_date_ms: JAN1 },
  { period_id: "feb", start_ms: FEB1, end_ms: d(2026, 1, 28), due_date_ms: FEB1 },
  { period_id: "mar", start_ms: MAR1, end_ms: d(2026, 2, 31), due_date_ms: MAR1 },
];

// Monthly window: 5-day early-autopay (¼ of 30d is capped at 5), 15-day gap tolerance.
const opts = {
  tolerance_ms: default_tolerance_ms(JAN1, JAN1 + 30 * DAY),
  early_window_ms: default_early_window_ms(JAN1, JAN1 + 30 * DAY),
};

// ============================================================================
// align_transaction_to_period
// ============================================================================

describe("align_transaction_to_period", () => {
  it("assigns an in-range payment to its containing period", () => {
    const r = align_transaction_to_period(d(2026, 0, 5), MONTHLY, opts); // Jan 5
    expect(r.period_id).toBe("jan");
    expect(r.reason).toBe("in_range");
  });

  it("keeps a LATE payment in its containing period (not the next due)", () => {
    // Jan 20: 19 days after Jan 1, 12 days before Feb 1 — must stay January.
    const r = align_transaction_to_period(d(2026, 0, 20), MONTHLY, opts);
    expect(r.period_id).toBe("jan");
    expect(r.reason).toBe("in_range");
  });

  it("overrides an EARLY autopay across the boundary to the next period", () => {
    // Dec 30 isn't in any range here; use Jan 29 (in Jan range) 3 days before Feb 1.
    const r = align_transaction_to_period(d(2026, 0, 29), MONTHLY, opts); // Jan 29, Feb 1 is 3d ahead
    expect(r.period_id).toBe("feb");
    expect(r.reason).toBe("early_autopay_next");
  });

  it("does NOT override when the next due date is beyond the early window", () => {
    // Jan 25: Feb 1 is 7 days ahead (> 5-day early window) → stays January.
    const r = align_transaction_to_period(d(2026, 0, 25), MONTHLY, opts);
    expect(r.period_id).toBe("jan");
    expect(r.reason).toBe("in_range");
  });

  it("falls back to nearest due date when the txn is in a gap (no containing period)", () => {
    const gapped: PeriodForAlignment[] = [
      { period_id: "jan", start_ms: JAN1, end_ms: d(2026, 0, 20), due_date_ms: JAN1 },
      { period_id: "feb", start_ms: FEB1, end_ms: d(2026, 1, 28), due_date_ms: FEB1 },
    ];
    // Jan 28 is past Jan's range end (20th) and before Feb's range start; nearest
    // due date within 15d is Feb 1 (4d) vs Jan 1 (27d) → Feb.
    const r = align_transaction_to_period(d(2026, 0, 28), gapped, opts);
    expect(r.period_id).toBe("feb");
    expect(r.reason).toBe("nearest_due_date");
  });

  it("returns no_match when nothing is in range or within tolerance", () => {
    const r = align_transaction_to_period(d(2026, 5, 15), MONTHLY, opts); // June, far away
    expect(r.period_id).toBeNull();
    expect(r.reason).toBe("no_match");
  });

  it("returns no_match for empty periods", () => {
    expect(align_transaction_to_period(JAN1, [], opts).reason).toBe("no_match");
  });

  it("default_tolerance_ms is half the period length", () => {
    expect(default_tolerance_ms(JAN1, JAN1 + 30 * DAY)).toBe(15 * DAY);
  });

  it("scaled early window does NOT mis-file a mid-week payment as next-week autopay", () => {
    // Regression for the fixed-5-day-window bug: weekly periods (7d) need a small
    // early window (~1.75d), so a Wednesday payment stays in its own week.
    const mon = Date.UTC(2026, 0, 5); // Mon Jan 5
    const weekly: PeriodForAlignment[] = [
      { period_id: "w1", start_ms: mon, end_ms: mon + 6 * DAY, due_date_ms: mon },
      { period_id: "w2", start_ms: mon + 7 * DAY, end_ms: mon + 13 * DAY, due_date_ms: mon + 7 * DAY },
    ];
    const wOpts = {
      tolerance_ms: default_tolerance_ms(mon, mon + 7 * DAY),
      early_window_ms: default_early_window_ms(mon, mon + 6 * DAY), // ~1.5d, NOT 5d
    };
    // Wednesday Jan 7 — 5 days before next Monday, but the scaled window excludes it.
    const r = align_transaction_to_period(mon + 2 * DAY, weekly, wOpts);
    expect(r.period_id).toBe("w1");
    expect(r.reason).toBe("in_range");
    // Sunday Jan 11 — 1 day before next Monday → within the scaled window → early autopay.
    const r2 = align_transaction_to_period(mon + 6 * DAY, weekly, wOpts);
    expect(r2.period_id).toBe("w2");
    expect(r2.reason).toBe("early_autopay_next");
  });
});

// ============================================================================
// compute_period_reconciliation
// ============================================================================

// A single-occurrence month: period Jan 1–31, one occurrence due Jan 15.
const P_START = JAN1;
const P_END = d(2026, 0, 31);
const DUE = d(2026, 0, 15);

const split = (
  amount: number,
  is_pending = false,
  id = "s",
  date_ms: number = DUE
): LinkedSplit => ({
  transaction_id: `t_${id}`,
  split_id: id,
  amount,
  is_pending,
  date_ms,
});

const fixed = {
  period_id: "p",
  start_ms: P_START,
  end_ms: P_END,
  is_variable_amount: false,
  amount_per_occurrence: 100,
  occurrence_due_dates_ms: [DUE],
};
const variable = { ...fixed, is_variable_amount: true };

describe("compute_period_reconciliation — fixed, single occurrence", () => {
  it("none when no splits", () => {
    const r = compute_period_reconciliation(fixed, []);
    expect(r.status).toBe("none");
    expect(r.occurrences_expected).toBe(1);
    expect(r.occurrences_paid).toBe(0);
  });

  it("partial when posted < the occurrence amount", () => {
    const r = compute_period_reconciliation(fixed, [split(40)]);
    expect(r.status).toBe("partial");
    expect(r.matched_amount).toBe(40);
    expect(r.occurrences_paid).toBe(0);
  });

  it("complete when two installments meet the occurrence amount", () => {
    const r = compute_period_reconciliation(fixed, [split(40, false, "a"), split(60, false, "b")]);
    expect(r.status).toBe("complete");
    expect(r.matched_amount).toBe(100);
    expect(r.occurrences_paid).toBe(1);
  });

  it("over when posted exceeds the expected total", () => {
    expect(compute_period_reconciliation(fixed, [split(120)]).status).toBe("over");
  });

  it("refund nets the occurrence down (full → none, partial → partial)", () => {
    expect(
      compute_period_reconciliation(fixed, [split(100, false, "a"), split(-100, false, "r")]).status
    ).toBe("none");
    expect(
      compute_period_reconciliation(fixed, [split(100, false, "a"), split(-30, false, "r")]).status
    ).toBe("partial");
  });

  it("pending does NOT flip status but is tracked separately", () => {
    const r = compute_period_reconciliation(fixed, [split(100, true)]);
    expect(r.status).toBe("none");
    expect(r.pending_amount).toBe(100);
    expect(r.matched_amount).toBe(0);
  });

  it("back-compat: a posted payment marks a period with NO occurrence data as paid", () => {
    // Periods generated before occurrence data existed have an empty due-date array.
    // A payment that lands there must still reconcile (1 synthetic occurrence).
    const noData = { ...fixed, occurrence_due_dates_ms: [] };
    const r = compute_period_reconciliation(noData, [split(100)]);
    expect(r.occurrences_expected).toBe(1);
    expect(r.occurrences_paid).toBe(1);
    expect(r.status).toBe("complete");
    // ...but with no payment it stays none (no occurrence is fabricated).
    expect(compute_period_reconciliation(noData, []).status).toBe("none");
    expect(compute_period_reconciliation(noData, []).occurrences_expected).toBe(0);
  });

  it("self-corrects occurrence dates OUTSIDE the period range (legacy gen bug)", () => {
    // A stray Dec 12 date (out of the Jan period) must NOT inflate the count.
    const buggy = { ...fixed, occurrence_due_dates_ms: [d(2025, 11, 12), DUE] };
    const r = compute_period_reconciliation(buggy, [split(100)]);
    expect(r.occurrences_expected).toBe(1); // only DUE survives the range filter
    expect(r.status).toBe("complete");
  });
});

describe("compute_period_reconciliation — variable, single occurrence", () => {
  it("complete on ANY net-positive posted payment, regardless of amount", () => {
    expect(compute_period_reconciliation(variable, [split(5)]).status).toBe("complete");
    expect(compute_period_reconciliation(variable, [split(500)]).status).toBe("complete");
  });

  it("none when only pending", () => {
    expect(compute_period_reconciliation(variable, [split(80, true)]).status).toBe("none");
  });

  it("full refund reverts to none", () => {
    expect(
      compute_period_reconciliation(variable, [split(80, false, "a"), split(-80, false, "r")]).status
    ).toBe("none");
  });
});

describe("compute_period_reconciliation — MULTIPLE occurrences in a period", () => {
  // Income paid twice this month (the 1st and the 15th), or a bi-weekly bill.
  const twice = {
    period_id: "p",
    start_ms: P_START,
    end_ms: P_END,
    is_variable_amount: false,
    amount_per_occurrence: 100,
    occurrence_due_dates_ms: [d(2026, 0, 1), d(2026, 0, 15)],
  };

  it("expects 2 occurrences and totals their amount", () => {
    const r = compute_period_reconciliation(twice, []);
    expect(r.occurrences_expected).toBe(2);
    expect(r.expected_amount).toBe(200);
    expect(r.status).toBe("none");
  });

  it("partial when only ONE of the two payments has landed", () => {
    const r = compute_period_reconciliation(twice, [split(100, false, "a", d(2026, 0, 2))]);
    expect(r.occurrences_paid).toBe(1);
    expect(r.status).toBe("partial");
  });

  it("complete when BOTH payments land near their own due dates", () => {
    const r = compute_period_reconciliation(twice, [
      split(100, false, "a", d(2026, 0, 2)),
      split(100, false, "b", d(2026, 0, 16)),
    ]);
    expect(r.occurrences_paid).toBe(2);
    expect(r.status).toBe("complete");
    expect(r.matched_amount).toBe(200);
  });

  it("two payments near the SAME date fill one occurrence, not both", () => {
    // Both on the 1st → one occurrence covered (installments), the 15th still open.
    const r = compute_period_reconciliation(twice, [
      split(60, false, "a", d(2026, 0, 1)),
      split(40, false, "b", d(2026, 0, 1)),
    ]);
    expect(r.occurrences_paid).toBe(1);
    expect(r.status).toBe("partial");
  });
});

describe("purity / determinism", () => {
  it("compute is deterministic for the same input", () => {
    const splits = [split(40, false, "a"), split(70, false, "b"), split(10, true, "c")];
    expect(compute_period_reconciliation(fixed, splits)).toEqual(
      compute_period_reconciliation(fixed, splits)
    );
  });
});
