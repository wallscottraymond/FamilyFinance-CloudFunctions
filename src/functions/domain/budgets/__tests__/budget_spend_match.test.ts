/**
 * budget_spend_match Domain Service — Unit Tests
 *
 * Verifies read-time budget ownership (the "instant budgets" path): category
 * match, manual pin precedence, Everything-Else fallback for the unmatched, and
 * that recurring-linked splits — while they may be "owned" — are excluded from
 * spend by is_countable downstream.
 */

import {
  resolve_split_owner,
  owned_splits_for_budget,
  SplitForOnReadMatch,
} from "../budget_spend_match.service";
import { BudgetForMatch } from "../../transactions/match_budget.service";
import { compute_budget_spent } from "../budget_spend.service";

const JAN_2026 = Date.UTC(2026, 0, 1);
const B_GROCERIES = "b_groceries";
const B_DINING = "b_dining";
const EE = "b_ee";

function budget(id: string, category_ids: string[]): BudgetForMatch {
  return {
    id,
    category_ids,
    start_ms: Date.UTC(2020, 0, 1),
    end_ms: null,
    is_ongoing: true,
    cadence: "monthly",
  };
}

const REAL_BUDGETS: BudgetForMatch[] = [
  budget(B_GROCERIES, ["groceries"]),
  budget(B_DINING, ["dining"]),
];

function split(over: Partial<SplitForOnReadMatch> = {}): SplitForOnReadMatch {
  return {
    amount: 50,
    txn_date_ms: JAN_2026,
    is_pending: false,
    is_transfer: false,
    is_income: false,
    spend_status: "counted",
    outflow_id: null,
    inflow_id: null,
    internal_match_category: null,
    plaid_match_category: "groceries",
    overall_category_id: null,
    first_category_id: null,
    manual_pin_budget_id: null,
    ...over,
  };
}

describe("resolve_split_owner", () => {
  it("assigns a split to the budget owning its category", () => {
    expect(resolve_split_owner(split(), REAL_BUDGETS, EE)).toBe(B_GROCERIES);
  });

  it("falls to Everything-Else when no real budget owns the category", () => {
    expect(
      resolve_split_owner(split({ plaid_match_category: "travel" }), REAL_BUDGETS, EE)
    ).toBe(EE);
  });

  it("manual pin wins over category match", () => {
    // Category says groceries, but the user pinned it to dining.
    expect(
      resolve_split_owner(split({ manual_pin_budget_id: B_DINING }), REAL_BUDGETS, EE)
    ).toBe(B_DINING);
  });

  it("user category override beats the plaid category", () => {
    // Plaid says groceries; user re-categorized to dining → dining budget.
    expect(
      resolve_split_owner(
        split({ plaid_match_category: "groceries", internal_match_category: "dining" }),
        REAL_BUDGETS,
        EE
      )
    ).toBe(B_DINING);
  });
});

describe("owned_splits_for_budget + spend", () => {
  it("sums only the splits a budget owns on read (instant, no stored assignment)", () => {
    const splits = [
      split({ amount: 30, plaid_match_category: "groceries" }), // → groceries
      split({ amount: 20, plaid_match_category: "groceries" }), // → groceries
      split({ amount: 99, plaid_match_category: "dining" }), // → dining
      split({ amount: 5, plaid_match_category: "travel" }), // → EE
    ];
    const owned = owned_splits_for_budget(B_GROCERIES, REAL_BUDGETS, EE, splits);
    const r = compute_budget_spent(B_GROCERIES, JAN_2026, JAN_2026, owned);
    expect(r.spent).toBe(50); // 30 + 20 only
  });

  it("Everything-Else gets the unmatched remainder", () => {
    const splits = [
      split({ amount: 30, plaid_match_category: "groceries" }),
      split({ amount: 5, plaid_match_category: "travel" }),
      split({ amount: 7, plaid_match_category: "misc" }),
    ];
    const owned = owned_splits_for_budget(EE, REAL_BUDGETS, EE, splits);
    const r = compute_budget_spent(EE, JAN_2026, JAN_2026, owned);
    expect(r.spent).toBe(12); // 5 + 7 (unmatched); groceries excluded
  });

  it("recurring-linked split is owned but NOT counted (is_countable excludes it)", () => {
    const splits = [
      split({ amount: 40, plaid_match_category: "groceries", outflow_id: "o1" }),
      split({ amount: 10, plaid_match_category: "groceries" }),
    ];
    const owned = owned_splits_for_budget(B_GROCERIES, REAL_BUDGETS, EE, splits);
    const r = compute_budget_spent(B_GROCERIES, JAN_2026, JAN_2026, owned);
    expect(r.spent).toBe(10); // the outflow-linked $40 is excluded from budget spend
  });
});
