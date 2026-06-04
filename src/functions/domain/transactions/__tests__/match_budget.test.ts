/**
 * match_budget Domain Service — Unit Tests
 *
 * Pure function, no mocks. Verifies category+date matching, the user-override
 * category precedence, the Everything Else STRUCTURAL fallback (not categoryIds-
 * matched), the missing-EE case, and the drift (tie) signal.
 */

import {
  match_budget,
  resolve_split_category,
  is_within_budget_range,
  BudgetForMatch,
  UNASSIGNED_BUDGET_ID,
} from "../match_budget.service";

// Fixed epoch ms anchors (UTC).
const JUN_15 = Date.UTC(2026, 5, 15);
const JUN_01 = Date.UTC(2026, 5, 1);
const JUL_01 = Date.UTC(2026, 6, 1);
const MAY_01 = Date.UTC(2026, 4, 1);

const EE = "ee_budget";

function budget(over: Partial<BudgetForMatch> = {}): BudgetForMatch {
  return {
    id: "b_groceries",
    category_ids: ["FOOD_AND_DRINK"],
    start_ms: JUN_01,
    end_ms: null,
    is_ongoing: true,
    ...over,
  };
}

describe("resolve_split_category", () => {
  it("prefers the user override over the Plaid category", () => {
    expect(
      resolve_split_category({
        internal_match_category: "Groceries",
        plaid_match_category: "FOOD_AND_DRINK",
      })
    ).toBe("Groceries");
  });

  it("falls back to the Plaid category, then null", () => {
    expect(
      resolve_split_category({ internal_match_category: null, plaid_match_category: "X" })
    ).toBe("X");
    expect(
      resolve_split_category({ internal_match_category: null, plaid_match_category: null })
    ).toBeNull();
  });
});

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
  const split = { internal_match_category: null, plaid_match_category: "FOOD_AND_DRINK" };

  it("matches a real budget by category + date", () => {
    const r = match_budget(split, JUN_15, [budget()], EE);
    expect(r.budget_id).toBe("b_groceries");
    expect(r.reason).toBe("category+date");
    expect(r.matched_category).toBe("FOOD_AND_DRINK");
    expect(r.tie).toBe(false);
  });

  it("falls to Everything Else when no real budget owns the category", () => {
    const r = match_budget(
      { internal_match_category: null, plaid_match_category: "TRAVEL" },
      JUN_15,
      [budget()],
      EE
    );
    expect(r.budget_id).toBe(EE);
    expect(r.reason).toBe("everything_else_fallback");
  });

  it("falls to EE when the category matches but the date is outside the range", () => {
    const limited = budget({ start_ms: JUN_01, end_ms: JUN_15, is_ongoing: false });
    const r = match_budget(split, JUL_01, [limited], EE);
    expect(r.budget_id).toBe(EE);
    expect(r.reason).toBe("everything_else_fallback");
  });

  it("EE is structural — a category NOT in any real budget still routes to EE", () => {
    // EE is never passed as a real budget; even an unknown category lands in EE.
    const r = match_budget(
      { internal_match_category: "BRAND_NEW_CATEGORY", plaid_match_category: null },
      JUN_15,
      [budget()],
      EE
    );
    expect(r.budget_id).toBe(EE);
  });

  it("uses the user override category to match a real budget", () => {
    const groceries = budget({ category_ids: ["Groceries"] });
    const r = match_budget(
      { internal_match_category: "Groceries", plaid_match_category: "FOOD_AND_DRINK" },
      JUN_15,
      [groceries],
      EE
    );
    expect(r.budget_id).toBe("b_groceries");
    expect(r.matched_category).toBe("Groceries");
  });

  it("flags a tie when two real budgets own the same category (drift)", () => {
    const a = budget({ id: "b_a" });
    const b = budget({ id: "b_b" });
    const r = match_budget(split, JUN_15, [a, b], EE);
    expect(r.budget_id).toBe("b_a"); // first wins, deterministic
    expect(r.tie).toBe(true);
  });

  it("returns unassigned + no_everything_else when the user has no EE budget", () => {
    const r = match_budget(
      { internal_match_category: null, plaid_match_category: "TRAVEL" },
      JUN_15,
      [budget()],
      null
    );
    expect(r.budget_id).toBe(UNASSIGNED_BUDGET_ID);
    expect(r.reason).toBe("no_everything_else");
  });

  it("a split with no category falls to EE", () => {
    const r = match_budget(
      { internal_match_category: null, plaid_match_category: null },
      JUN_15,
      [budget()],
      EE
    );
    expect(r.budget_id).toBe(EE);
  });

  it("is deterministic", () => {
    expect(match_budget(split, JUN_15, [budget()], EE)).toEqual(
      match_budget(split, JUN_15, [budget()], EE)
    );
  });
});
