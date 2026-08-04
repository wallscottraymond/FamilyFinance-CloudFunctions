/**
 * budget_view Domain Service — Unit Tests
 *
 * Verifies derive-on-read for non-monthly budget views:
 *  - spent is the same windowed sum as the stored path (re-bucketed by date)
 *  - allocated/effective are pro-rated from the overlapping monthly period(s)
 *  - remaining = pro-rated effective − spent (rollover folded via effective)
 *  - buckets spanning a month boundary sum both months' daily contributions
 *  - a full month's weekly buckets reconstruct (≈) the month's allocation
 */

import {
  derive_budget_view_periods,
  MonthlyPeriodForDerivation,
  ViewBucket,
} from "../budget_view.service";
import { SplitForSpend } from "../budget_spend.service";

const BUDGET = "b1";

// June 2026 has 30 days.
const JUN_01 = Date.UTC(2026, 5, 1);
const JUN_30 = Date.UTC(2026, 5, 30, 23, 59, 59);
// A clean 7-day week fully inside June (Jun 8–14).
const JUN_08 = Date.UTC(2026, 5, 8);
const JUN_14 = Date.UTC(2026, 5, 14, 23, 59, 59);
const JUN_10 = Date.UTC(2026, 5, 10);
// A week straddling the June/July boundary (Jun 29 – Jul 5).
const JUN_29 = Date.UTC(2026, 5, 29);
const JUL_05 = Date.UTC(2026, 6, 5, 23, 59, 59);
const JUL_01 = Date.UTC(2026, 6, 1);
const JUL_31 = Date.UTC(2026, 6, 31, 23, 59, 59);

/** $600/month, no rollover → daily 20.00. */
function junMonthly(
  over: Partial<MonthlyPeriodForDerivation> = {}
): MonthlyPeriodForDerivation {
  return {
    allocated_amount: 600,
    effective_amount: 600,
    start_ms: JUN_01,
    end_ms: JUN_30,
    ...over,
  };
}

function split(over: Partial<SplitForSpend> = {}): SplitForSpend {
  return {
    budget_id: BUDGET,
    amount: 100,
    txn_date_ms: JUN_10,
    is_pending: false,
    is_transfer: false,
    is_income: false,
    is_income_category: false,
    spend_status: "counted",
    outflow_id: null,
    inflow_id: null,
    ...over,
  };
}

function weekBucket(
  period_id: string,
  start_ms: number,
  end_ms: number
): ViewBucket {
  return { period_id, period_type: "weekly", start_ms, end_ms };
}

describe("derive_budget_view_periods", () => {
  it("pro-rates a full in-month week from the monthly allocation", () => {
    // 7 days × (600/30 = 20/day) = 140.
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("2026W_JUN2", JUN_08, JUN_14)],
      [junMonthly()],
      []
    );
    expect(wk.allocated_amount).toBe(140);
    expect(wk.effective_amount).toBe(140);
    expect(wk.spent).toBe(0);
    expect(wk.remaining).toBe(140);
    expect(wk.is_derived).toBe(true);
    expect(wk.period_type).toBe("weekly");
  });

  it("buckets spent by date (only in-window splits count)", () => {
    const splits = [
      split({ amount: 50, txn_date_ms: JUN_10 }), // inside Jun 8–14
      split({ amount: 30, txn_date_ms: JUN_01 }), // outside the week
    ];
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly()],
      splits
    );
    expect(wk.spent).toBe(50);
    expect(wk.remaining).toBe(90); // 140 − 50
  });

  it("folds monthly rollover into effective → remaining", () => {
    // effective 900 (600 + 300 rollover) → daily 30 → week = 210.
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly({ effective_amount: 900 })],
      [split({ amount: 60, txn_date_ms: JUN_10 })]
    );
    expect(wk.allocated_amount).toBe(140); // base limit unaffected
    expect(wk.effective_amount).toBe(210); // rollover folded in
    expect(wk.remaining).toBe(150); // 210 − 60
  });

  it("sums both months for a week straddling the month boundary", () => {
    // Jun 29–30 (2 days @ 600/30=20) + Jul 1–5 (5 days @ 620/31=20) = 40 + 100 = 140.
    const julMonthly: MonthlyPeriodForDerivation = {
      allocated_amount: 620,
      effective_amount: 620,
      start_ms: JUL_01,
      end_ms: JUL_31,
    };
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("boundary", JUN_29, JUL_05)],
      [junMonthly(), julMonthly],
      []
    );
    expect(wk.allocated_amount).toBe(140);
  });

  it("ignores non-overlapping monthly periods", () => {
    const julMonthly: MonthlyPeriodForDerivation = {
      allocated_amount: 9999,
      effective_amount: 9999,
      start_ms: JUL_01,
      end_ms: JUL_31,
    };
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly(), julMonthly],
      []
    );
    expect(wk.allocated_amount).toBe(140); // July contributes nothing
  });

  it("refund split stays in spent AND accrues return_amount", () => {
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly()],
      [split({ amount: 40, txn_date_ms: JUN_10, spend_status: "refund" })]
    );
    expect(wk.spent).toBe(40);
    expect(wk.return_amount).toBe(40);
    expect(wk.remaining).toBe(100); // 140 − 40
  });

  it("a full month of weekly buckets ≈ the month's allocation (parity)", () => {
    // Tile June into 4 clean 7-day weeks + a 2-day remainder = 30 days.
    const buckets: ViewBucket[] = [
      weekBucket("w1", Date.UTC(2026, 5, 1), Date.UTC(2026, 5, 7, 23, 59, 59)),
      weekBucket("w2", Date.UTC(2026, 5, 8), Date.UTC(2026, 5, 14, 23, 59, 59)),
      weekBucket("w3", Date.UTC(2026, 5, 15), Date.UTC(2026, 5, 21, 23, 59, 59)),
      weekBucket("w4", Date.UTC(2026, 5, 22), Date.UTC(2026, 5, 28, 23, 59, 59)),
      weekBucket("w5", Date.UTC(2026, 5, 29), Date.UTC(2026, 5, 30, 23, 59, 59)),
    ];
    const derived = derive_budget_view_periods(BUDGET, buckets, [junMonthly()], []);
    const total = derived.reduce((s, d) => s + d.allocated_amount, 0);
    // 20/day × 30 days = 600, the full monthly allocation.
    expect(total).toBe(600);
  });
});
