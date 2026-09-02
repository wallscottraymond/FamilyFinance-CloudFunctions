"use strict";
/**
 * Budget Spend Match (read-time) Domain Service
 *
 * Derive-On-Read Period Architecture — the "instant budgets" unlock.
 *
 * Resolves which budget a split belongs to ON READ, from the split's category +
 * manual pin, instead of reading a pre-computed stored `budgetId`. This is what
 * lets a brand-new budget show its transactions immediately (no write-time
 * assignment cascade) while still honoring user intent.
 *
 * Precedence (the engine's existing order, run on read):
 *   1. manual pin (budget_assignment_source === "manual")  → that budget
 *   2. category match (reuses `match_budget`: detailed → first → overall slug)
 *   3. Everything-Else structural fallback (also from `match_budget`)
 * Rules (future) slot between 1 and 2 without changing this shape.
 *
 * Recurring-linked splits (outflow_id/inflow_id set) are still excluded from
 * budget spend by `is_countable` downstream, so this matcher can ignore them.
 *
 * PURE: no IO, no side effects. Reuses `match_budget` + `compute_budget_spent`
 * unchanged, so it stays consistent with the write-time engine's decisions.
 *
 * @module domain/budgets/budget_spend_match
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_split_owner = resolve_split_owner;
exports.owned_splits_for_budget = owned_splits_for_budget;
const match_budget_service_1 = require("../transactions/match_budget.service");
const budget_spend_service_1 = require("./budget_spend.service");
/**
 * Resolve the budget a split belongs to on read.
 *
 * @param split        - The split's category + pin
 * @param real_budgets - The user's REAL budgets (Everything Else EXCLUDED)
 * @param ee_budget_id - The Everything-Else budget id, or null if none
 *
 * PURE.
 */
function resolve_split_owner(split, real_budgets, ee_budget_id) {
    // 1. Manual pin wins — but ONLY while its budget still exists (a real budget or the EE).
    //    A pin to a DELETED budget is stale, so we fall through to category matching (→ EE),
    //    which re-homes the deleted budget's spending to Everything Else instead of orphaning it.
    if (split.manual_pin_budget_id &&
        (split.manual_pin_budget_id === ee_budget_id ||
            real_budgets.some((b) => b.id === split.manual_pin_budget_id))) {
        return split.manual_pin_budget_id;
    }
    // 2/3. Category match → else Everything-Else (both from the shared matcher).
    return (0, match_budget_service_1.match_budget)(split, split.txn_date_ms, real_budgets, ee_budget_id).budget_id;
}
/**
 * The splits owned by `target_budget_id` on read, mapped to `SplitForSpend`
 * (with `budget_id` stamped to the target) so they flow straight into the
 * existing spend/derivation path.
 *
 * PURE.
 */
function owned_splits_for_budget(target_budget_id, real_budgets, ee_budget_id, splits) {
    var _a;
    const out = [];
    for (const s of splits) {
        if (resolve_split_owner(s, real_budgets, ee_budget_id) !== target_budget_id) {
            continue;
        }
        out.push({
            budget_id: target_budget_id,
            amount: s.amount,
            txn_date_ms: s.txn_date_ms,
            is_pending: s.is_pending,
            is_transfer: s.is_transfer,
            is_income: s.is_income,
            is_income_category: (0, budget_spend_service_1.is_income_category)((_a = s.internal_match_category) !== null && _a !== void 0 ? _a : s.plaid_match_category),
            spend_status: s.spend_status,
            outflow_id: s.outflow_id,
            inflow_id: s.inflow_id,
            is_recurring_member: s.is_recurring_member,
        });
    }
    return out;
}
//# sourceMappingURL=budget_spend_match.service.js.map