/**
 * match_budget Domain Service — Unit Tests
 *
 * Pure function, no mocks. Budgets own first-category slugs and matching compares the split's
 * first slug only (canon A2); Everything Else is the STRUCTURAL fallback (never matched by a
 * list); the missing-EE case; the drift (tie) signal.
 */

import {
  match_budget,
  is_within_budget_range,
  BudgetForMatch,
  UNASSIGNED_BUDGET_ID,
} from "../match_budget.service";

const JUN_15 = Date.UTC(2026, 5, 15);
const JUN_01 = Date.UTC(2026, 5, 1);
const JUL_01 = Date.UTC(2026, 6, 1);
const MAY_01 = Date.UTC(2026, 4, 1);

const EE = "ee_budget";

function budget(over: Partial<BudgetForMatch> = {}): BudgetForMatch {
  return {
    id: "b_groceries",
    category_ids: ["groceries"],
    start_ms: JUN_01,
    end_ms: null,
    is_ongoing: true,
    cadence: "monthly",
    ...over,
  };
}

describe("is_within_budget_range", () => {
  it("ongoing: any date on/after start", () => {
    expect(is_within_budget_range(JUN_15, budget({ start_ms: JUN_01, is_ongoing: true }))).toBe(true);
    expect(is_within_budget_range(MAY_01, budget({ start_ms: JUN_01, is_ongoing: true }))).toBe(false);
  });

  it("limited: within [start, end] inclusive", () => {
    const b = budget({ start_ms: JUN_01, end_ms: JUN_15, is_ongoing: false });
    expect(is_within_budget_range(JUN_15, b)).toBe(true);
    expect(is_within_budget_range(JUL_01, b)).toBe(false);
  });
});

describe("match_budget", () => {
  const split = { first_category_id: "groceries" };

  it("matches the budget that lists the split's first category, in its date range", () => {
    const r = match_budget(split, JUN_15, [budget()], EE);
    expect(r).toEqual({ budget_id: "b_groceries", reason: "category+date", matched_category: "groceries", tie: false });
  });

  it("falls to Everything Else when no real budget owns the category", () => {
    const r = match_budget({ first_category_id: "travel" }, JUN_15, [budget()], EE);
    expect(r.budget_id).toBe(EE);
    expect(r.reason).toBe("everything_else_fallback");
  });

  it("falls to EE when the category matches but the date is outside the range", () => {
    const limited = budget({ start_ms: JUN_01, end_ms: JUN_15, is_ongoing: false });
    expect(match_budget(split, JUL_01, [limited], EE).budget_id).toBe(EE);
  });

  it("compares slugs only — a budget still holding a Plaid code doesn't match (A2)", () => {
    const legacy = budget({ category_ids: ["FOOD_AND_DRINK_GROCERIES"] });
    expect(match_budget(split, JUN_15, [legacy], EE).budget_id).toBe(EE);
  });

  it("flags a tie when two real budgets own the same category (drift)", () => {
    const r = match_budget(split, JUN_15, [budget({ id: "b_a" }), budget({ id: "b_b" })], EE);
    expect(r.budget_id).toBe("b_a"); // first wins, deterministic
    expect(r.tie).toBe(true);
  });

  it("returns unassigned + no_everything_else when the user has no EE budget", () => {
    const r = match_budget({ first_category_id: "travel" }, JUN_15, [budget()], null);
    expect(r.budget_id).toBe(UNASSIGNED_BUDGET_ID);
    expect(r.reason).toBe("no_everything_else");
  });

  it("a split with no category falls to EE", () => {
    expect(match_budget({ first_category_id: null }, JUN_15, [budget()], EE).budget_id).toBe(EE);
  });

  it("is deterministic", () => {
    expect(match_budget(split, JUN_15, [budget()], EE)).toEqual(match_budget(split, JUN_15, [budget()], EE));
  });
});
