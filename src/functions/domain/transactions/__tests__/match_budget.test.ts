/**
 * match_budget Domain Service — Unit Tests
 *
 * Pure function, no mocks. Verifies category+date matching (by the ranked
 * `match_keys` the one category function produces), user picks matching a budget's
 * first ids, the Everything Else STRUCTURAL fallback (not categoryIds-
 * matched), the missing-EE case, and the drift (tie) signal.
 */

import {
  match_budget,
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
    cadence: "monthly", // match_budget is cadence-agnostic; caller filters by lens
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
  const split = { match_keys: ["FOOD_AND_DRINK"] };

  it("matches a real budget by category + date", () => {
    const r = match_budget(split, JUN_15, [budget()], EE);
    expect(r.budget_id).toBe("b_groceries");
    expect(r.reason).toBe("category+date");
    expect(r.matched_category).toBe("FOOD_AND_DRINK");
    expect(r.tie).toBe(false);
  });

  it("falls to Everything Else when no real budget owns the category", () => {
    const r = match_budget(
      { match_keys: ["TRAVEL"] },
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
      { match_keys: ["BRAND_NEW_CATEGORY"] },
      JUN_15,
      [budget()],
      EE
    );
    expect(r.budget_id).toBe(EE);
  });

  it("a user pick matches a budget by its first slug", () => {
    const groceries = budget({ category_ids: ["groceries"] });
    const r = match_budget(
      { match_keys: ["groceries", "food"], is_user_pick: true, first_category_id: "groceries" },
      JUN_15,
      [groceries],
      EE
    );
    expect(r.budget_id).toBe("b_groceries");
    expect(r.matched_category).toBe("groceries");
  });

  it("a user pick matches a legacy budget that still stores Plaid codes (via first_ids)", () => {
    const legacy = budget({
      category_ids: ["FOOD_AND_DRINK_GROCERIES"],
      first_ids: ["groceries"],
    });
    const r = match_budget(
      { match_keys: ["groceries"], is_user_pick: true, first_category_id: "groceries" },
      JUN_15,
      [legacy],
      EE
    );
    expect(r.budget_id).toBe("b_groceries");
  });

  it("first_ids never widen a PLAID split (exact-code matching only)", () => {
    const legacy = budget({
      category_ids: ["FOOD_AND_DRINK_GROCERIES"],
      first_ids: ["groceries"],
    });
    const r = match_budget(
      { match_keys: ["FOOD_AND_DRINK_SUPERMARKET", "groceries"], first_category_id: "groceries" },
      JUN_15,
      [legacy],
      EE
    );
    expect(r.budget_id).toBe(EE);
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
      { match_keys: ["TRAVEL"] },
      JUN_15,
      [budget()],
      null
    );
    expect(r.budget_id).toBe(UNASSIGNED_BUDGET_ID);
    expect(r.reason).toBe("no_everything_else");
  });

  it("a split with no category falls to EE", () => {
    const r = match_budget(
      { match_keys: [] },
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

  // --- Phase 4b: slug-level matching (overall/first) ---

  it("matches a budget that stores the split's firstCategoryId slug", () => {
    const slugSplit = {
      match_keys: ["FOOD_AND_DRINK_GROCERIES", "groceries", "groceries"],
      first_category_id: "groceries",
    };
    const b = budget({ id: "b_slug", category_ids: ["groceries"] });
    const r = match_budget(slugSplit, JUN_15, [b], EE);
    expect(r.budget_id).toBe("b_slug");
    expect(r.matched_category).toBe("groceries");
  });

  it("matches a budget storing the overallCategoryId (broad) — auto-includes the detailed", () => {
    const slugSplit = {
      match_keys: ["FOOD_AND_DRINK_COFFEE", "eating_out", "food_and_drink"],
      first_category_id: "eating_out",
    };
    const broad = budget({ id: "b_food", category_ids: ["food_and_drink"] });
    expect(match_budget(slugSplit, JUN_15, [broad], EE).budget_id).toBe("b_food");
  });

  it("prefers the MORE SPECIFIC budget when both a specific + broad budget claim the split", () => {
    const slugSplit = {
      match_keys: ["FOOD_AND_DRINK_COFFEE", "eating_out", "food_and_drink"],
      first_category_id: "eating_out",
    };
    const broad = budget({ id: "b_food", category_ids: ["food_and_drink"] });
    const specific = budget({ id: "b_dining", category_ids: ["eating_out"] });
    const r = match_budget(slugSplit, JUN_15, [broad, specific], EE);
    expect(r.budget_id).toBe("b_dining"); // first-level beats overall-level
    expect(r.tie).toBe(true); // both claimed it → drift flagged
  });

  it("legacy detailed-based budgets still match (back-compat)", () => {
    const slugSplit = {
      match_keys: ["FOOD_AND_DRINK_GROCERIES", "groceries", "groceries"],
      first_category_id: "groceries",
    };
    const legacy = budget({ id: "b_legacy", category_ids: ["FOOD_AND_DRINK_GROCERIES"] });
    expect(match_budget(slugSplit, JUN_15, [legacy], EE).budget_id).toBe("b_legacy");
  });
});
