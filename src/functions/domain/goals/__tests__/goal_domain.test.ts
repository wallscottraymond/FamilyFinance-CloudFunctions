/**
 * Goals domain unit tests — cadence translation + measurement shaping +
 * create-validation. Pure functions, no IO.
 */

import {
  validate_create_goal,
  goal_daily_rate,
  amount_for_span,
  compute_goal_measurement,
} from "../goal.service";

describe("validate_create_goal", () => {
  const base = {
    goal_type: "savings" as const,
    name: "Emergency fund",
    linked_account_id: "acct1",
    home_cadence: "monthly" as const,
    per_period_amount: 200,
    baseline_counts_existing: false,
  };

  it("accepts a valid ongoing savings goal without a target", () => {
    const r = validate_create_goal(base);
    expect(r.validation_errors).toBeUndefined();
    expect(r.entity).toBeDefined();
  });

  it("requires a target for big_purchase and debt_paydown", () => {
    const r = validate_create_goal({ ...base, goal_type: "big_purchase" });
    expect(r.validation_errors).toContain(
      "big_purchase requires a positive target_amount"
    );
  });

  it("rejects non-positive per_period_amount and out-of-range apr", () => {
    const r = validate_create_goal({
      ...base,
      per_period_amount: 0,
      apr: 150,
    });
    expect(r.validation_errors).toEqual(
      expect.arrayContaining([
        "per_period_amount must be positive",
        "apr must be between 0 and 100",
      ])
    );
  });
});

describe("cadence translation", () => {
  it("derives a daily rate from a monthly set-aside", () => {
    // $304.40/mo over 365/12 (~30.42) days ≈ $10/day
    expect(goal_daily_rate(304.4, "monthly")).toBeCloseTo(10, 1);
  });

  it("translates a monthly set-aside to a 7-day (weekly) span", () => {
    // $300/mo → ~$9.86/day → ~$69 for a 7-day week
    expect(amount_for_span(300, "monthly", 7)).toBeCloseTo(69.04, 1);
  });
});

describe("compute_goal_measurement", () => {
  it("marks an ongoing period met when progress ≥ the period target", () => {
    const m = compute_goal_measurement({
      goal_id: "g1",
      period_id: "2026M09",
      target_for_period: 200,
      attributed_progress: 250,
      cumulative_progress: 1000,
      target_amount: null,
      data_incomplete: false,
    });
    expect(m.met).toBe(true);
    expect(m.target_reached).toBe(false);
    expect(m.progress_for_period).toBe(250);
  });

  it("flags target_reached when cumulative ≥ target", () => {
    const m = compute_goal_measurement({
      goal_id: "g2",
      period_id: "2026M09",
      target_for_period: 500,
      attributed_progress: 500,
      cumulative_progress: 6000,
      target_amount: 6000,
      data_incomplete: false,
    });
    expect(m.target_reached).toBe(true);
  });

  it("is NOT met when progress falls short of the period target", () => {
    const m = compute_goal_measurement({
      goal_id: "g3",
      period_id: "2026M09",
      target_for_period: 200,
      attributed_progress: 50,
      cumulative_progress: 50,
      target_amount: null,
      data_incomplete: false,
    });
    expect(m.met).toBe(false);
  });
});
