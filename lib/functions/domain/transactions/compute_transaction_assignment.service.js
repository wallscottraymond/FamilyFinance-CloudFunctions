"use strict";
/**
 * Compute Transaction Assignment Domain Service
 *
 * The PURE heart of the Transaction Assignment Engine: given a transaction's
 * splits + the resolved context, sequence the matchers through the precedence
 * and return the new per-split assignment, the set of budgets touched
 * (before ∪ after — for the scoped fan-out), and whether anything changed
 * (for skip-if-unchanged).
 *
 * Precedence per split:  category → manual? → recurring → budget → source periods
 *
 * The recurring matchers (outflow/inflow) are owned by Recurring-Period-
 * Reconciliation; their per-split result is INJECTED via the context, so this
 * service stays pure and complete without them.
 *
 * NO async, NO IO, NO side effects.
 *
 * @module domain/transactions/compute_transaction_assignment
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compute_transaction_assignment = compute_transaction_assignment;
const match_budget_service_1 = require("./match_budget.service");
const match_category_service_1 = require("./match_category.service");
const match_source_periods_service_1 = require("./match_source_periods.service");
/**
 * Assemble the assignment for all of a transaction's splits.
 *
 * PURE FUNCTION.
 */
function compute_transaction_assignment(splits, context) {
    var _a;
    // Source periods are transaction-level (one date) → compute once.
    const periods = (0, match_source_periods_service_1.match_source_periods)(context.txn_date_ms, context.source_periods);
    const assigned = [];
    const touched = new Set();
    const touched_outflow = new Set();
    const touched_inflow = new Set();
    let changed = false;
    let any_unassigned = false;
    for (const split of splits) {
        touched.add(split.budget_id); // before
        if (split.outflow_id)
            touched_outflow.add(split.outflow_id); // before
        if (split.inflow_id)
            touched_inflow.add(split.inflow_id); // before
        let budget_id;
        let source;
        let outflow_id;
        let inflow_id;
        let budget_reason;
        let tie = false;
        let recurring_reason;
        // A manual pin is only honored while its budget still EXISTS. If the pinned
        // budget was deleted, the pin is stale → fall through to category matching
        // so the split re-homes (otherwise a "forced" split survives the delete).
        const pin_budget_valid = split.budget_id === context.everything_else_budget_id ||
            context.real_budgets.some((b) => b.id === split.budget_id);
        if (split.budget_assignment_source === "manual" && pin_budget_valid) {
            // Manual pin is authoritative: keep the budget, DETACH recurring.
            source = "manual";
            budget_id = split.budget_id;
            outflow_id = null;
            inflow_id = null;
            budget_reason = "manual";
            recurring_reason = "manual_detached";
        }
        else {
            source = "category";
            // 1. Resolve the effective category (may upgrade OTHER_EXPENSE).
            const resolved_plaid = (0, match_category_service_1.match_category)({
                plaid_match_category: split.plaid_match_category,
                merchant_name: context.txn_merchant_name,
                name: context.txn_name,
            }, context.category_rules).category;
            // 2. Recurring (injected from the recurring matchers).
            const recurring = (_a = context.recurring_by_split[split.split_id]) !== null && _a !== void 0 ? _a : {
                outflow_id: null,
                inflow_id: null,
            };
            outflow_id = recurring.outflow_id;
            inflow_id = recurring.inflow_id;
            recurring_reason = outflow_id ? "outflow" : inflow_id ? "inflow" : "none";
            // 3. Budget (real budgets, else Everything Else structural fallback).
            const budget = (0, match_budget_service_1.match_budget)({
                internal_match_category: split.internal_match_category,
                plaid_match_category: resolved_plaid,
            }, context.txn_date_ms, context.real_budgets, context.everything_else_budget_id);
            budget_id = budget.budget_id;
            budget_reason = budget.reason;
            tie = budget.tie;
        }
        if (budget_id === match_budget_service_1.UNASSIGNED_BUDGET_ID) {
            any_unassigned = true;
        }
        touched.add(budget_id); // after
        if (outflow_id)
            touched_outflow.add(outflow_id); // after
        if (inflow_id)
            touched_inflow.add(inflow_id); // after
        const next = {
            split_id: split.split_id,
            budget_id,
            budget_assignment_source: source,
            outflow_id,
            inflow_id,
            monthly_period_id: periods.monthly_period_id,
            weekly_period_id: periods.weekly_period_id,
            bi_weekly_period_id: periods.bi_weekly_period_id,
            reason: { budget: budget_reason, tie, recurring: recurring_reason },
        };
        assigned.push(next);
        if (split_assignment_changed(split, next)) {
            changed = true;
        }
    }
    return {
        splits: assigned,
        touched_budget_ids: [...touched],
        touched_outflow_ids: [...touched_outflow],
        touched_inflow_ids: [...touched_inflow],
        changed,
        any_unassigned,
    };
}
/** Whether any engine-owned field differs between the stored split and the new one. PURE. */
function split_assignment_changed(before, after) {
    return (before.budget_id !== after.budget_id ||
        before.budget_assignment_source !== after.budget_assignment_source ||
        before.outflow_id !== after.outflow_id ||
        before.inflow_id !== after.inflow_id ||
        before.monthly_period_id !== after.monthly_period_id ||
        before.weekly_period_id !== after.weekly_period_id ||
        before.bi_weekly_period_id !== after.bi_weekly_period_id);
}
//# sourceMappingURL=compute_transaction_assignment.service.js.map