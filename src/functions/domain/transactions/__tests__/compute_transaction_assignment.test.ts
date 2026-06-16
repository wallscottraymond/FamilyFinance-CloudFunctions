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
    real_budgets: [groceries],
    everything_else_budget_id: EE,
    category_rules: [],
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

  it("manual pin (to an EXISTING budget) keeps it + DETACHES recurring", () => {
    const pinned = {
      id: "b_pinned",
      category_ids: [] as string[],
      start_ms: Date.UTC(2026, 0, 1),
      end_ms: null,
      is_ongoing: true,
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
    // Pre-set the split to exactly what the engine would compute.
    const settled = split({
      budget_id: "b_groceries",
      monthly_period_id: "2026M06",
      weekly_period_id: "2026W24",
      bi_weekly_period_id: null,
    });
    const r = compute_transaction_assignment([settled], ctx());
    expect(r.changed).toBe(false);
  });

  it("flags any_unassigned when there is no Everything Else budget", () => {
    const r = compute_transaction_assignment(
      [split({ plaid_match_category: "TRAVEL" })],
      ctx({ everything_else_budget_id: null })
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
