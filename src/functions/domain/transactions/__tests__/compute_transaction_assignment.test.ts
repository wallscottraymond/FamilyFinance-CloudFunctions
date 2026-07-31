/**
 * compute_transaction_assignment Domain Service — Unit Tests
 *
 * Exercises the precedence (category → manual? → recurring → budget → periods),
 * manual-detach, EE structural fallback, touched-budget (before ∪ after),
 * skip-if-unchanged, and the per-split decision reasons.
 */

import {
  compute_transaction_assignment,
  AssignmentContext,
  SplitForAssignment,
} from "../compute_transaction_assignment.service";
import { BudgetForMatch } from "../match_budget.service";

const JUN_15 = Date.UTC(2026, 5, 15);
const EE = "ee_budget";

const groceries: BudgetForMatch = {
  id: "b_groceries",
  category_ids: ["FOOD_AND_DRINK"],
  start_ms: Date.UTC(2026, 0, 1),
  end_ms: null,
  is_ongoing: true,
  cadence: "monthly",
};

const periods = [
  { id: "2026M06", type: "monthly" as const, start_ms: Date.UTC(2026, 5, 1), end_ms: Date.UTC(2026, 5, 30, 23, 59, 59) },
  { id: "2026W24", type: "weekly" as const, start_ms: Date.UTC(2026, 5, 14), end_ms: Date.UTC(2026, 5, 20, 23, 59, 59) },
];

function ctx(over: Partial<AssignmentContext> = {}): AssignmentContext {
  return {
    txn_date_ms: JUN_15,
    txn_merchant_name: null,
    txn_name: null,
    txn_is_income: false,
    real_budgets: [groceries],
    everything_else_budget_ids: { monthly: EE, weekly: EE, bi_monthly: EE },
    category_rules: [],
    category_slugs_by_plaid: {
      FOOD_AND_DRINK: { overall_category_id: "food_and_drink", first_category_id: "eating_out" },
    },
    source_periods: periods,
    recurring_by_split: {},
    ...over,
  };
}

function split(over: Partial<SplitForAssignment> = {}): SplitForAssignment {
  return {
    split_id: "s1",
    budget_id: "unset",
    budget_assignment_source: "category",
    internal_match_category: null,
    plaid_match_category: "FOOD_AND_DRINK",
    outflow_id: null,
    inflow_id: null,
    monthly_period_id: null,
    weekly_period_id: null,
    bi_weekly_period_id: null,
    ...over,
  };
}

describe("compute_transaction_assignment", () => {
  it("assigns category→budget + stamps source periods", () => {
    const r = compute_transaction_assignment([split()], ctx());
    const s = r.splits[0];
    expect(s.budget_id).toBe("b_groceries");
    expect(s.monthly_period_id).toBe("2026M06");
    expect(s.weekly_period_id).toBe("2026W24");
    expect(s.reason.budget).toBe("category+date");
    expect(r.changed).toBe(true);
  });

  it("falls to Everything Else when no real budget owns the category", () => {
    const r = compute_transaction_assignment(
      [split({ plaid_match_category: "TRAVEL" })],
      ctx()
    );
    expect(r.splits[0].budget_id).toBe(EE);
    expect(r.splits[0].reason.budget).toBe("everything_else_fallback");
  });

  it("PER-LENS: a WEEKLY budget claims only the weekly lens; monthly+biweekly fall to their own EE", () => {
    const weeklyGroceries: BudgetForMatch = {
      id: "b_weekly_groceries",
      category_ids: ["FOOD_AND_DRINK"],
      start_ms: Date.UTC(2026, 0, 1),
      end_ms: null,
      is_ongoing: true,
      cadence: "weekly",
    };
    const r = compute_transaction_assignment(
      [split({ plaid_match_category: "FOOD_AND_DRINK" })],
      ctx({
        real_budgets: [weeklyGroceries], // no monthly/biweekly grocery budget
        everything_else_budget_ids: { monthly: "ee_m", weekly: "ee_w", bi_monthly: "ee_b" },
      })
    );
    const s = r.splits[0];
    expect(s.weekly_budget_id).toBe("b_weekly_groceries"); // weekly lens claimed
    expect(s.monthly_budget_id).toBe("ee_m"); // no monthly grocery → monthly EE
    expect(s.bi_weekly_budget_id).toBe("ee_b"); // no biweekly grocery → biweekly EE
    expect(s.budget_id).toBe("ee_m"); // legacy alias = monthly lens
    expect(r.any_unassigned).toBe(false);
  });

  it("global manual pin forces ALL three lenses onto the pinned budget", () => {
    const pinned: BudgetForMatch = {
      id: "b_pinned",
      category_ids: [],
      start_ms: Date.UTC(2026, 0, 1),
      end_ms: null,
      is_ongoing: true,
      cadence: "monthly",
    };
    const r = compute_transaction_assignment(
      [split({ budget_assignment_source: "manual", budget_id: "b_pinned" })],
      ctx({ real_budgets: [groceries, pinned] })
    );
    const s = r.splits[0];
    expect(s.monthly_budget_id).toBe("b_pinned");
    expect(s.weekly_budget_id).toBe("b_pinned");
    expect(s.bi_weekly_budget_id).toBe("b_pinned");
    expect(s.budget_assignment_source).toBe("manual");
  });

  it("PER-LENS income: unassigned in all three lenses, no missing-EE error (B1)", () => {
    const r = compute_transaction_assignment(
      [split({ plaid_match_category: "FOOD_AND_DRINK" })],
      ctx({ txn_is_income: true })
    );
    const s = r.splits[0];
    expect(s.monthly_budget_id).toBe("unassigned");
    expect(s.weekly_budget_id).toBe("unassigned");
    expect(s.bi_weekly_budget_id).toBe("unassigned");
    expect(r.any_unassigned).toBe(false);
  });

  it("income is NEVER auto-assigned to a budget — stays unassigned, no missing-EE error (B1)", () => {
    const r = compute_transaction_assignment(
      // Category WOULD match b_groceries, but income must not be budgeted.
      [split({ plaid_match_category: "FOOD_AND_DRINK" })],
      ctx({ txn_is_income: true })
    );
    expect(r.splits[0].budget_id).toBe("unassigned");
    expect(r.splits[0].reason.budget).toBe("income_excluded");
    expect(r.any_unassigned).toBe(false); // intentional, not the missing-EE error
  });

  it("income still matches a recurring inflow while skipping budget (income tracking intact)", () => {
    const r = compute_transaction_assignment(
      [split({ split_id: "s1" })],
      ctx({
        txn_is_income: true,
        recurring_by_split: { s1: { outflow_id: null, inflow_id: "i_salary" } },
      })
    );
    expect(r.splits[0].budget_id).toBe("unassigned");
    expect(r.splits[0].inflow_id).toBe("i_salary");
    expect(r.splits[0].reason.recurring).toBe("inflow");
  });

  it("a manually-pinned income keeps its budget — explicit assignment overrides B1 (B2)", () => {
    const fund = {
      id: "b_fund",
      category_ids: [] as string[],
      start_ms: Date.UTC(2026, 0, 1),
      end_ms: null,
      is_ongoing: true,
      cadence: "monthly" as const,
    };
    const r = compute_transaction_assignment(
      [split({ budget_assignment_source: "manual", budget_id: "b_fund" })],
      ctx({ txn_is_income: true, real_budgets: [fund] })
    );
    expect(r.splits[0].budget_id).toBe("b_fund");
    expect(r.splits[0].reason.budget).toBe("manual");
  });

  it("manual pin (to an EXISTING budget) keeps it + DETACHES recurring", () => {
    const pinned = {
      id: "b_pinned",
      category_ids: [] as string[],
      start_ms: Date.UTC(2026, 0, 1),
      end_ms: null,
      is_ongoing: true,
      cadence: "monthly" as const,
    };
    const r = compute_transaction_assignment(
      [
        split({
          split_id: "s1",
          budget_assignment_source: "manual",
          budget_id: "b_pinned",
          outflow_id: "o_bill", // should be cleared
        }),
      ],
      ctx({
        real_budgets: [groceries, pinned],
        recurring_by_split: { s1: { outflow_id: "o_bill", inflow_id: null } },
      })
    );
    const s = r.splits[0];
    expect(s.budget_id).toBe("b_pinned");
    expect(s.budget_assignment_source).toBe("manual");
    expect(s.outflow_id).toBeNull();
    expect(s.inflow_id).toBeNull();
    expect(s.reason.recurring).toBe("manual_detached");
  });

  it("drops a manual pin to a DELETED budget → re-homes by category", () => {
    const r = compute_transaction_assignment(
      [
        split({
          split_id: "s1",
          budget_assignment_source: "manual",
          budget_id: "b_deleted", // not in real_budgets → stale pin
          plaid_match_category: "FOOD_AND_DRINK",
        }),
      ],
      ctx() // real_budgets = [groceries]; b_deleted absent
    );
    const s = r.splits[0];
    expect(s.budget_id).toBe("b_groceries"); // re-homed, not stuck on the deleted budget
    expect(s.budget_assignment_source).toBe("category");
  });

  it("keeps the injected recurring link for a non-manual split", () => {
    const r = compute_transaction_assignment(
      [split({ split_id: "s1" })],
      ctx({ recurring_by_split: { s1: { outflow_id: "o_bill", inflow_id: null } } })
    );
    expect(r.splits[0].outflow_id).toBe("o_bill");
    expect(r.splits[0].reason.recurring).toBe("outflow");
  });

  it("upgrades an OTHER_EXPENSE category via merchant before budget match", () => {
    const r = compute_transaction_assignment(
      [split({ plaid_match_category: "OTHER_EXPENSE" })],
      ctx({
        txn_merchant_name: "Whole Foods",
        category_rules: [{ category: "FOOD_AND_DRINK", merchants: ["whole foods"], keywords: [] }],
      })
    );
    expect(r.splits[0].budget_id).toBe("b_groceries"); // resolved category → matched budget
  });

  it("touched_budget_ids is before ∪ after (reassignment)", () => {
    // Split currently on EE, re-homes to Groceries → both touched.
    const r = compute_transaction_assignment(
      [split({ budget_id: EE })],
      ctx()
    );
    expect(r.splits[0].budget_id).toBe("b_groceries");
    expect(r.touched_budget_ids.sort()).toEqual([EE, "b_groceries"].sort());
  });

  it("touched_outflow_ids is before ∪ after (recurring link moved)", () => {
    // Split currently linked to o_old; the matcher now links it to o_new.
    const r = compute_transaction_assignment(
      [split({ split_id: "s1", outflow_id: "o_old" })],
      ctx({ recurring_by_split: { s1: { outflow_id: "o_new", inflow_id: null } } })
    );
    expect(r.splits[0].outflow_id).toBe("o_new");
    expect(r.touched_outflow_ids.sort()).toEqual(["o_new", "o_old"].sort());
  });

  it("touched_outflow_ids keeps the OLD doc when a link is cleared (un-match)", () => {
    // Split was on o_old; no recurring match now → outflow_id cleared, but o_old
    // must still reconcile (drop the stale payment). RPR Phase 5c.
    const r = compute_transaction_assignment(
      [split({ split_id: "s1", outflow_id: "o_old" })],
      ctx() // recurring_by_split empty → no match
    );
    expect(r.splits[0].outflow_id).toBeNull();
    expect(r.touched_outflow_ids).toEqual(["o_old"]);
  });

  it("touched_inflow_ids is before ∪ after (recurring income link moved)", () => {
    // Split currently linked to i_old; the matcher now links it to i_new — both
    // recurring income docs must reconcile (received status moves).
    const r = compute_transaction_assignment(
      [split({ split_id: "s1", inflow_id: "i_old" })],
      ctx({ recurring_by_split: { s1: { outflow_id: null, inflow_id: "i_new" } } })
    );
    expect(r.splits[0].inflow_id).toBe("i_new");
    expect(r.touched_inflow_ids.sort()).toEqual(["i_new", "i_old"].sort());
  });

  it("touched_inflow_ids keeps the OLD doc when an income link is cleared (un-match)", () => {
    // Split was on i_old; no recurring match now → inflow_id cleared, but i_old
    // must still reconcile (drop the stale received). Inflow parity of RPR 5c.
    const r = compute_transaction_assignment(
      [split({ split_id: "s1", inflow_id: "i_old" })],
      ctx() // recurring_by_split empty → no match
    );
    expect(r.splits[0].inflow_id).toBeNull();
    expect(r.touched_inflow_ids).toEqual(["i_old"]);
  });

  it("multi-split: per-split, only the matching split re-homes", () => {
    const r = compute_transaction_assignment(
      [
        split({ split_id: "s1", plaid_match_category: "FOOD_AND_DRINK", budget_id: EE }),
        split({ split_id: "s2", plaid_match_category: "TRAVEL", budget_id: EE }),
      ],
      ctx()
    );
    expect(r.splits[0].budget_id).toBe("b_groceries"); // s1 re-homes
    expect(r.splits[1].budget_id).toBe(EE); // s2 stays
  });

  it("skip-if-unchanged: no change when stored == computed", () => {
    // Pre-set the split to exactly what the engine would compute PER LENS:
    // groceries is a monthly budget, so only the monthly lens is b_groceries; the
    // weekly + biweekly lenses fall to their Everything Else (no weekly/biweekly
    // grocery budget exists).
    const settled = split({
      budget_id: "b_groceries",
      monthly_budget_id: "b_groceries",
      weekly_budget_id: EE,
      bi_weekly_budget_id: EE,
      monthly_period_id: "2026M06",
      weekly_period_id: "2026W24",
      bi_weekly_period_id: null,
      // Also pre-set the app-category classification the engine would compute
      // (FOOD_AND_DRINK → food_and_drink / eating_out) so nothing drifts.
      overall_category_id: "food_and_drink",
      first_category_id: "eating_out",
      category_source: "plaid",
    });
    const r = compute_transaction_assignment([settled], ctx());
    expect(r.changed).toBe(false);
  });

  it("classifies the split into overall/first slugs from the resolved Plaid detailed", () => {
    const r = compute_transaction_assignment([split()], ctx());
    const s = r.splits[0];
    expect(s.overall_category_id).toBe("food_and_drink");
    expect(s.first_category_id).toBe("eating_out");
    // Plaid splits do NOT persist a secondary (derived from the detailed at read time).
    expect(s.second_category_id).toBeNull();
    expect(s.category_source).toBe("plaid");
  });

  it("preserves a user category override (does not reclassify)", () => {
    const overridden = split({
      overall_category_id: "groceries",
      first_category_id: "groceries",
      second_category_id: "GROCERIES_FROZEN",
      category_source: "user",
    });
    const s = compute_transaction_assignment([overridden], ctx()).splits[0];
    expect(s.overall_category_id).toBe("groceries");
    expect(s.first_category_id).toBe("groceries");
    expect(s.second_category_id).toBe("GROCERIES_FROZEN");
    expect(s.category_source).toBe("user");
  });

  it("a SECOND-level override retargets budget matching to the chosen detailed", () => {
    // A budget keyed by the specific detailed the user picked (not the split's
    // original FOOD_AND_DRINK) claims the split via the override's second_category_id.
    const electronicsBudget: BudgetForMatch = {
      id: "b_electronics",
      category_ids: ["SHOPPING_ELECTRONICS"],
      start_ms: Date.UTC(2026, 0, 1),
      end_ms: null,
      is_ongoing: true,
      cadence: "monthly",
    };
    const overridden = split({
      overall_category_id: "shopping",
      first_category_id: "electronics",
      second_category_id: "SHOPPING_ELECTRONICS",
      category_source: "user",
    });
    const s = compute_transaction_assignment(
      [overridden],
      ctx({ real_budgets: [groceries, electronicsBudget] })
    ).splits[0];
    expect(s.monthly_budget_id).toBe("b_electronics");
    expect(s.second_category_id).toBe("SHOPPING_ELECTRONICS");
  });

  it("a FIRST-only override (null second) matches only by first/overall slug", () => {
    // Budget keyed by the FIRST slug claims the split; the original Plaid detailed
    // must NOT leak through as an effective detailed.
    const firstSlugBudget: BudgetForMatch = {
      id: "b_first",
      category_ids: ["electronics"], // firstCategoryId slug
      start_ms: Date.UTC(2026, 0, 1),
      end_ms: null,
      is_ongoing: true,
      cadence: "monthly",
    };
    const overridden = split({
      overall_category_id: "shopping",
      first_category_id: "electronics",
      second_category_id: null,
      category_source: "user",
    });
    const s = compute_transaction_assignment(
      [overridden],
      ctx({ real_budgets: [groceries, firstSlugBudget] })
    ).splits[0];
    // The original FOOD_AND_DRINK detailed no longer matches groceries; the first
    // slug wins instead.
    expect(s.monthly_budget_id).toBe("b_first");
    expect(s.second_category_id).toBeNull();
  });

  it("null slugs when the Plaid detailed is unmapped", () => {
    const s = compute_transaction_assignment(
      [split({ plaid_match_category: "TRAVEL" })],
      ctx()
    ).splits[0];
    expect(s.overall_category_id).toBeNull();
    expect(s.first_category_id).toBeNull();
    expect(s.category_source).toBe("plaid");
  });

  it("flags any_unassigned when there is no Everything Else budget", () => {
    const r = compute_transaction_assignment(
      [split({ plaid_match_category: "TRAVEL" })],
      ctx({ everything_else_budget_ids: { monthly: null, weekly: null, bi_monthly: null } })
    );
    expect(r.any_unassigned).toBe(true);
    expect(r.splits[0].budget_id).toBe("unassigned");
  });

  it("is deterministic", () => {
    expect(compute_transaction_assignment([split()], ctx())).toEqual(
      compute_transaction_assignment([split()], ctx())
    );
  });
});
