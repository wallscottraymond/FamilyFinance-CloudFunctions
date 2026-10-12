/**
 * PROPERTY: stored == derived (canon A11, Transaction-Integrity-Review Phase 4).
 *
 * Thousands of generated splits — Plaid codes (mapped, unmapped, merchant-rule upgrades), user
 * picks (first / second / unreadable), legacy `internal*` overrides, manual pins (live and to a
 * deleted budget), budgets owning first-category slugs — run through BOTH paths:
 *   engine : split_category_input_from_raw → compute_transaction_assignment (what's STORED)
 *   derive : map_raw_split_to_on_read_match → resolve_split_owner (what the period page COUNTS)
 * and must agree on the budget and the first category. A second engine run over its own output
 * changes nothing (idempotent — no write loops).
 */

import { build_category_catalog } from "../split_category.service";
import { split_category_input_from_raw } from "../split_category_edit.service";
import {
  compute_transaction_assignment,
  SplitForAssignment,
} from "../compute_transaction_assignment.service";
import { BudgetForMatch } from "../match_budget.service";
import { resolve_split_owner } from "../../budgets/budget_spend_match.service";
import { map_raw_split_to_on_read_match } from "../../../resolvers/shared/on_read_matching";

const CODES: Array<[string, string]> = [
  ["FOOD_AND_DRINK_GROCERIES", "groceries"],
  ["FOOD_AND_DRINK_RESTAURANT", "eating_out"],
  ["FOOD_AND_DRINK_FAST_FOOD", "eating_out"],
  ["GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE", "shopping"],
  ["GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", "shopping"],
  ["ENTERTAINMENT_TV_AND_MOVIES", "entertainment"],
  ["TRAVEL_FLIGHTS", "travel"],
  ["OTHER_EXPENSE", "other"],
];
const catalog = build_category_catalog([
  ...CODES.map(([id, first]) => ({
    id,
    data: {
      firstCategoryId: first,
      overallCategoryId: `o_${first}`,
      first_category: first,
      merchants: id === "FOOD_AND_DRINK_FAST_FOOD" ? ["santo taco"] : [],
    },
  })),
]);
const FIRSTS = [...new Set(CODES.map(([, f]) => f))];

// Deterministic PRNG (mulberry32) so a failure reproduces.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JUN = Date.UTC(2026, 5, 15);
const EE = { monthly: "ee_m", weekly: "ee_w", bi_monthly: "ee_b" };
const PERIODS = [
  { id: "M06", type: "monthly" as const, start_ms: Date.UTC(2026, 5, 1), end_ms: Date.UTC(2026, 5, 30, 23, 59, 59) },
  { id: "W24", type: "weekly" as const, start_ms: Date.UTC(2026, 5, 14), end_ms: Date.UTC(2026, 5, 20, 23, 59, 59) },
];

it("engine (stored) == derive (counted) for 5,000 generated splits; engine is idempotent", () => {
  const r = rng(20261012);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  let compared = 0;

  for (let i = 0; i < 5000; i++) {
    // Budgets of ONE view: each owns a disjoint set of first slugs (canon A3).
    const owned = FIRSTS.filter(() => r() < 0.4);
    const budgets: BudgetForMatch[] = owned.map((f, k) => ({
      id: `b${k}_${f}`, category_ids: [f], start_ms: Date.UTC(2026, 0, 1), end_ms: null,
      is_ongoing: true, cadence: "monthly",
    }));

    const code = r() < 0.1 ? "SOMETHING_NEW" : pick(CODES)[0];
    const raw: Record<string, unknown> = {
      splitId: "s1", amount: 10, plaidDetailedCategory: code,
      budgetId: "unassigned", budgetAssignmentSource: "category",
    };
    const roll = r();
    if (roll < 0.2) { raw.categorySource = "user"; raw.firstCategoryId = pick(FIRSTS); }
    else if (roll < 0.25) { raw.categorySource = "user"; raw.secondCategoryId = pick(CODES)[0]; }
    else if (roll < 0.28) { raw.categorySource = "user"; } // unreadable pick
    else if (roll < 0.33) { raw.internalDetailedCategory = pick([...FIRSTS, ...CODES.map((c) => c[0])]); }
    if (r() < 0.1) {
      raw.budgetAssignmentSource = "manual";
      raw.budgetId = r() < 0.5 && budgets.length ? pick(budgets).id : "deleted_budget";
    }
    const txn = { merchantName: r() < 0.15 ? "Santo Taco" : "Store", name: "x" };

    // ENGINE (stored)
    const cat = split_category_input_from_raw(raw, txn, catalog);
    const input: SplitForAssignment = {
      split_id: "s1", budget_id: raw.budgetId as string,
      budget_assignment_source: raw.budgetAssignmentSource as "category" | "manual",
      plaid_match_category: code, outflow_id: null, inflow_id: null,
      monthly_period_id: null, weekly_period_id: null, bi_weekly_period_id: null,
      overall_category_id: cat.overall_category_id ?? null, first_category_id: cat.first_category_id ?? null,
      second_category_id: cat.second_category_id ?? null, category_source: cat.category_source ?? "plaid",
    };
    const ctx = {
      txn_date_ms: JUN, txn_merchant_name: txn.merchantName, txn_name: txn.name, txn_is_income: false,
      real_budgets: budgets, everything_else_budget_ids: EE, category_catalog: catalog,
      source_periods: PERIODS, recurring_by_split: {},
    };
    const stored = compute_transaction_assignment([input], ctx).splits[0];

    // DERIVE (counted)
    const match = map_raw_split_to_on_read_match(raw, {
      txn_date_ms: JUN, is_pending: false, is_transfer: false, is_income: false,
      merchant_name: txn.merchantName, name: txn.name,
    }, catalog);
    const derived_budget = resolve_split_owner(match, budgets, EE.monthly);

    expect([i, stored.monthly_budget_id]).toEqual([i, derived_budget]);
    if (stored.category_source === "plaid" || stored.first_category_id) {
      expect([i, stored.first_category_id]).toEqual([i, match.first_category_id]);
    }
    compared++;

    // Idempotent: the engine over its own output changes nothing.
    const again = compute_transaction_assignment(
      [{
        ...input,
        budget_id: stored.budget_id, budget_assignment_source: stored.budget_assignment_source,
        monthly_budget_id: stored.monthly_budget_id, weekly_budget_id: stored.weekly_budget_id,
        bi_weekly_budget_id: stored.bi_weekly_budget_id,
        monthly_period_id: stored.monthly_period_id, weekly_period_id: stored.weekly_period_id,
        bi_weekly_period_id: stored.bi_weekly_period_id,
        overall_category_id: stored.overall_category_id, first_category_id: stored.first_category_id,
        second_category_id: stored.second_category_id, category_source: stored.category_source,
      }],
      ctx
    );
    expect([i, again.changed]).toEqual([i, false]);
  }
  expect(compared).toBe(5000);
});
