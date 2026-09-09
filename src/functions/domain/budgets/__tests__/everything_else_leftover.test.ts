/**
 * Everything-Else leftover unit tests — the derived EE limit formula + the
 * double-count guard (`is_countable` keeps bill/budget-matched spend out of EE).
 */

import {
  compute_ee_leftovers,
  EELeftoverBucketInputs,
  GoalForLeftover,
} from "../everything_else_leftover.service";
import { is_countable, SplitForSpend } from "../budget_spend.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 365 / 12; // matches CADENCE_DAYS.monthly, so a monthly goal maps 1:1
const MONTH_MS = MONTH_DAYS * DAY_MS;

function monthBucket(over: Partial<EELeftoverBucketInputs> = {}): EELeftoverBucketInputs {
  return {
    period_id: "2026M09",
    start_ms: 0,
    end_ms: MONTH_MS,
    expected_income: 0,
    bills_due: 0,
    other_budgets_allocated: 0,
    ...over,
  };
}

describe("compute_ee_leftovers", () => {
  it("EE limit = income − bills − goals − budgets", () => {
    const goals: GoalForLeftover[] = [
      { per_period_amount: 500, home_cadence: "monthly" },
    ];
    const out = compute_ee_leftovers(
      [monthBucket({ expected_income: 4000, bills_due: 1500, other_budgets_allocated: 1000 })],
      goals
    );
    const ee = out.get("2026M09")!;
    expect(ee.leftover).toBeCloseTo(1000, 2); // 4000 − 1500 − 500 − 1000
    expect(ee.has_income).toBe(true);
  });

  it("adding a budget reduces the leftover", () => {
    const base = monthBucket({ expected_income: 4000, bills_due: 1500, other_budgets_allocated: 1000 });
    const more = { ...base, other_budgets_allocated: 1300 };
    expect(compute_ee_leftovers([more], []).get("2026M09")!.leftover).toBeCloseTo(1200, 2); // 4000−1500−0−1300
  });

  it("goes negative (over-allocated) when commitments exceed income", () => {
    const out = compute_ee_leftovers(
      [monthBucket({ expected_income: 1000, bills_due: 800, other_budgets_allocated: 200 })],
      [{ per_period_amount: 500, home_cadence: "monthly" }]
    );
    expect(out.get("2026M09")!.leftover).toBeCloseTo(-500, 2); // 1000−800−500−200
  });

  it("flags no_income when there's no expected income", () => {
    const ee = compute_ee_leftovers(
      [monthBucket({ expected_income: 0, bills_due: 300 })],
      []
    ).get("2026M09")!;
    expect(ee.has_income).toBe(false);
    expect(ee.leftover).toBeCloseTo(-300, 2);
  });

  it("translates the goal set-aside to the bucket cadence (weekly)", () => {
    // $500/month goal viewed in a 7-day bucket ≈ $115 set aside that week.
    const weekBucket = monthBucket({ period_id: "2026W37", start_ms: 0, end_ms: 7 * DAY_MS, expected_income: 1000 });
    const ee = compute_ee_leftovers([weekBucket], [{ per_period_amount: 500, home_cadence: "monthly" }]).get("2026W37")!;
    expect(ee.leftover).toBeCloseTo(1000 - (500 / MONTH_DAYS) * 7, 1); // ≈ 884.9
  });
});

describe("double-count guard (is_countable) — matched spend stays out of EE", () => {
  const base: SplitForSpend = {
    budget_id: "ee",
    amount: 50,
    txn_date_ms: 0,
    is_pending: false,
    is_transfer: false,
    is_income: false,
    is_income_category: false,
    spend_status: "counted",
    outflow_id: null,
    inflow_id: null,
    is_recurring_member: false,
  } as unknown as SplitForSpend;

  it("counts a plain discretionary split", () => {
    expect(is_countable(base)).toBe(true);
  });

  it("excludes a bill-linked split (outflow_id set)", () => {
    expect(is_countable({ ...base, outflow_id: "outflow_1" })).toBe(false);
  });

  it("excludes an income-linked split (inflow_id set)", () => {
    expect(is_countable({ ...base, inflow_id: "inflow_1" })).toBe(false);
  });

  it("excludes a recurring-stream member (even with no split link)", () => {
    expect(is_countable({ ...base, is_recurring_member: true })).toBe(false);
  });

  it("excludes internal transfers and ignored splits", () => {
    expect(is_countable({ ...base, is_transfer: true })).toBe(false);
    expect(is_countable({ ...base, spend_status: "ignored" })).toBe(false);
  });
});
