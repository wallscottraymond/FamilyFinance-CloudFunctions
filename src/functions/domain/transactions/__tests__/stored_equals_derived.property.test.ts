/**
 * PROPERTY: stored == derived (canon A11, Transaction-Integrity-Review Phase 4).
 *
 * Generated cases cover every input that decides a split's budget:
 *   - categories: mapped / unmapped Plaid codes, merchant-rule upgrades, user picks (first,
 *     second, unreadable), legacy `internal*` overrides;
 *   - budgets: monthly / weekly / bi-monthly, created MID-period, ongoing or with an end date
 *     (`budget_end_date`), manual pins (live and to a deleted budget);
 *   - money: purchases, refunds (credits in a spending category), income, and transfers in
 *     every matched-pair role (internal / edge_out / edge_in / external / unclassified).
 *
 * ENGINE (what's stored): split_category_input_from_raw → compute_transaction_assignment over
 *   THE budget set (build_match_budgets).
 * PAGE (what's counted): map_raw_split_to_on_read_match → owned_splits_for_budget → is_countable
 *   over the same budget set — exactly the period page's calls.
 * Claim: the engine stores budget B (monthly lens) ⇔ the page counts the split in B; the engine
 * stores "unassigned" ⇔ the page counts it nowhere. Plus: the engine is idempotent.
 */

import { build_category_catalog } from "../split_category.service";
import { split_category_input_from_raw } from "../split_category_edit.service";
import {
  compute_transaction_assignment,
  SplitForAssignment,
} from "../compute_transaction_assignment.service";
import { UNASSIGNED_BUDGET_ID } from "../match_budget.service";
import {
  owned_splits_for_budget,
  resolve_split_owner,
} from "../../budgets/budget_spend_match.service";
import { is_countable } from "../../budgets/budget_spend.service";
import { is_transfer_category } from "../category_semantics.service";
import {
  budget_to_match_input,
  build_match_budgets,
} from "../../budgets/match_budgets.service";
import { map_raw_split_to_on_read_match } from "../../../resolvers/shared/on_read_matching";

const CODES: Array<[string, string]> = [
  ["FOOD_AND_DRINK_GROCERIES", "groceries"],
  ["FOOD_AND_DRINK_RESTAURANT", "eating_out"],
  ["FOOD_AND_DRINK_FAST_FOOD", "eating_out"],
  ["GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE", "shopping"],
  ["ENTERTAINMENT_TV_AND_MOVIES", "entertainment"],
  ["TRAVEL_FLIGHTS", "travel"],
  ["OTHER_EXPENSE", "other"],
  ["INCOME_WAGES", "paycheck"],
  ["TRANSFER_OUT_ACCOUNT_TRANSFER", "transfer_out"],
  ["TRANSFER_IN_ACCOUNT_TRANSFER", "transfer_in"],
];
const catalog = build_category_catalog(
  CODES.map(([id, first]) => ({
    id,
    data: {
      firstCategoryId: first,
      overallCategoryId: `o_${first}`,
      merchants: id === "FOOD_AND_DRINK_FAST_FOOD" ? ["santo taco"] : [],
    },
  }))
);
const SPEND_FIRSTS = ["groceries", "eating_out", "shopping", "entertainment", "travel", "other"];

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ts = (ms: number) => ({ toMillis: () => ms });
const DAY = 24 * 60 * 60 * 1000;
const Y0 = Date.UTC(2026, 0, 1);
const EE_IDS = { monthly: "ee_m", weekly: "ee_w", bi_monthly: "ee_b" };

it("engine (stored) == period page (counted) across cadences, starts, ends, refunds, transfers, pins", () => {
  const r = rng(20261012);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const N = 8000;

  for (let i = 0; i < N; i++) {
    // Budgets of one view: disjoint first slugs (canon A3), any cadence, mid-period starts.
    const entities = SPEND_FIRSTS.filter(() => r() < 0.45).map((f, k) => {
      const start = Y0 + Math.floor(r() * 300) * DAY + Math.floor(r() * DAY);
      const ongoing = r() < 0.7;
      return {
        id: `b${k}_${f}`, name: f, period: pick(["monthly", "weekly", "bi_monthly"]),
        category_ids: [f], start_date: ts(start), end_date: ts(start + 30 * DAY),
        budget_end_date: ongoing ? null : ts(start + Math.floor(r() * 200) * DAY),
        is_ongoing: ongoing, is_system_everything_else: false,
      };
    });
    const ees = (["monthly", "weekly", "bi_monthly"] as const).map((p) => ({
      id: EE_IDS[p], name: "Everything Else", period: p, category_ids: [],
      start_date: ts(Y0), end_date: ts(Y0), is_ongoing: true, is_system_everything_else: true,
    }));
    const match = build_match_budgets([...entities, ...ees].map(budget_to_match_input));

    const date = Y0 + Math.floor(r() * 365) * DAY + Math.floor(r() * DAY);
    const code = r() < 0.05 ? "SOMETHING_NEW" : pick(CODES)[0];
    const is_income_txn = code === "INCOME_WAGES" || code.startsWith("TRANSFER_IN") || r() < 0.1;
    const role = code.startsWith("TRANSFER")
      ? pick(["internal", "edge_out", "edge_in", "external", undefined])
      : undefined;
    const raw: Record<string, unknown> = {
      splitId: "s1", amount: 10, plaidDetailedCategory: code,
      budgetId: "unassigned", budgetAssignmentSource: "category",
    };
    const roll = r();
    if (roll < 0.15) { raw.categorySource = "user"; raw.firstCategoryId = pick(SPEND_FIRSTS); }
    else if (roll < 0.2) { raw.categorySource = "user"; raw.secondCategoryId = pick(CODES)[0]; }
    else if (roll < 0.22) { raw.categorySource = "user"; }
    else if (roll < 0.26) { raw.internalDetailedCategory = pick([...SPEND_FIRSTS, ...CODES.map((c) => c[0])]); }
    if (r() < 0.08) {
      raw.budgetAssignmentSource = "manual";
      raw.budgetId = r() < 0.5 && match.real_budgets.length ? pick(match.real_budgets).id : "deleted_budget";
    }
    const txn = { merchantName: r() < 0.15 ? "Santo Taco" : "Store", name: "x" };

    // ENGINE
    const cat = split_category_input_from_raw(raw, txn, catalog);
    const input: SplitForAssignment = {
      split_id: "s1", budget_id: raw.budgetId as string,
      budget_assignment_source: raw.budgetAssignmentSource as "category" | "manual",
      plaid_match_category: code, outflow_id: null, inflow_id: null,
      monthly_period_id: null, weekly_period_id: null, bi_weekly_period_id: null,
      overall_category_id: cat.overall_category_id ?? null, first_category_id: cat.first_category_id ?? null,
      second_category_id: cat.second_category_id ?? null, category_source: cat.category_source ?? "plaid",
    };
    const ctx: Parameters<typeof compute_transaction_assignment>[1] = {
      txn_date_ms: date, txn_merchant_name: txn.merchantName, txn_name: txn.name,
      txn_is_income: is_income_txn, txn_transfer_role: role ?? null,
      real_budgets: match.real_budgets, everything_else_budget_ids: match.everything_else_ids,
      category_catalog: catalog, source_periods: [], recurring_by_split: {},
    };

    // PAGE — the period page's own calls over the same budget set.
    // The page pairs LIVE over the split's effective category (a user pick away from a transfer is
    // never paired); the classifier stores the same answer as `transferRole` — so a role only
    // exists for a transfer-category split (stale roles are cleared by the classifier).
    const m0 = map_raw_split_to_on_read_match(raw, {
      txn_date_ms: date, is_pending: false, is_transfer: false,
      is_income: is_income_txn, merchant_name: txn.merchantName, name: txn.name,
    }, catalog);
    const live_role = is_transfer_category(m0.semantic_code) ? role : undefined;
    ctx.txn_transfer_role = live_role ?? null;
    const m = { ...m0, is_transfer: live_role === "internal", is_edge_out: live_role === "edge_out" };
    const stored = compute_transaction_assignment([input], ctx).splits[0];
    const ee = match.primary_everything_else_id;
    const owner = resolve_split_owner(m, match.real_budgets, ee);
    const counted = owned_splits_for_budget(owner, match.real_budgets, ee, [m]).some(is_countable);

    // Transfers the classifier hasn't reached yet keep the old rule (excluded) on BOTH sides: the
    // page's blanket transfer-category exclusion; no role → engine excludes. Only edge_out counts.
    if (stored.monthly_budget_id === UNASSIGNED_BUDGET_ID) {
      expect([i, code, role, "page counts it", counted]).toEqual([i, code, role, "page counts it", false]);
    } else {
      expect([i, code, role, "counted in", counted ? owner : null])
        .toEqual([i, code, role, "counted in", stored.monthly_budget_id]);
    }

    // Idempotent: the engine over its own output changes nothing.
    const again = compute_transaction_assignment([{
      ...input,
      budget_id: stored.budget_id, budget_assignment_source: stored.budget_assignment_source,
      monthly_budget_id: stored.monthly_budget_id, weekly_budget_id: stored.weekly_budget_id,
      bi_weekly_budget_id: stored.bi_weekly_budget_id,
      overall_category_id: stored.overall_category_id, first_category_id: stored.first_category_id,
      second_category_id: stored.second_category_id, category_source: stored.category_source,
    }], ctx);
    expect([i, again.changed]).toEqual([i, false]);
  }
});

it("a budget created mid-period owns that period's earlier purchases on BOTH sides", () => {
  const start = Date.UTC(2026, 9, 12); // Oct 12
  const match = build_match_budgets([
    budget_to_match_input({
      id: "groc", name: "Groceries", period: "monthly", category_ids: ["groceries"],
      start_date: ts(start), end_date: ts(start), is_ongoing: true,
    }),
    budget_to_match_input({
      id: "ee_m", name: "EE", period: "monthly", category_ids: [], start_date: ts(Y0),
      end_date: ts(Y0), is_ongoing: true, is_system_everything_else: true,
    }),
  ]);
  expect(match.real_budgets[0].start_ms).toBe(Date.UTC(2026, 9, 1)); // Oct 5 purchase is in range
});
