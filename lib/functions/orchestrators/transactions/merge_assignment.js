"use strict";
/**
 * Merge Assignment onto Raw Splits
 *
 * Pure helper shared by the single-item (`assign_transaction`) and batch
 * (`assign_transactions_batch`) orchestrators: merges the engine's computed
 * assignment back onto the raw camelCase split maps (so the write preserves
 * fields the engine doesn't own) and denormalizes the matched budget's name.
 *
 * Kept in ONE place so the skip-if-unchanged / name-heal semantics can't drift
 * between the two call sites.
 *
 * @module orchestrators/transactions/merge_assignment
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.merge_assignment_onto_raw_splits = merge_assignment_onto_raw_splits;
/**
 * Merge `result` onto `resolved.raw_splits`. PURE — `now` is injected so the
 * caller controls the timestamp (and tests stay deterministic).
 */
function merge_assignment_onto_raw_splits(resolved, result, now) {
    const by_id = new Map(result.splits.map((s) => [s.split_id, s]));
    let name_changed = false;
    /* eslint-disable @typescript-eslint/naming-convention */
    const updated_splits = resolved.raw_splits.map((raw) => {
        var _a, _b, _c;
        const a = by_id.get(raw.splitId);
        if (!a) {
            return raw;
        }
        // Denormalized budget NAME per lens (from the id→name map) so the app can
        // show each period view's budget without a lookup. Legacy `budgetName` tracks
        // the monthly lens (budgetId = monthly alias).
        const monthly_name = resolved.budget_names[a.monthly_budget_id];
        const weekly_name = resolved.budget_names[a.weekly_budget_id];
        const bi_weekly_name = resolved.budget_names[a.bi_weekly_budget_id];
        const budget_name = monthly_name;
        if ((monthly_name !== undefined && raw.budgetName !== monthly_name) ||
            (weekly_name !== undefined && raw.weeklyBudgetName !== weekly_name) ||
            (bi_weekly_name !== undefined && raw.biWeeklyBudgetName !== bi_weekly_name)) {
            name_changed = true;
        }
        return Object.assign(Object.assign({}, raw), { 
            // Legacy alias (= monthly lens) kept until all readers use the lens fields.
            budgetId: a.budget_id, budgetName: budget_name !== null && budget_name !== void 0 ? budget_name : raw.budgetName, budgetAssignmentSource: a.budget_assignment_source, 
            // Per-lens assignment (Per-Period-Everything-Else): the split is placed
            // independently in each period cadence. All three share the same source.
            monthlyBudgetId: a.monthly_budget_id, weeklyBudgetId: a.weekly_budget_id, biWeeklyBudgetId: a.bi_weekly_budget_id, monthlyBudgetName: monthly_name !== null && monthly_name !== void 0 ? monthly_name : ((_a = raw.monthlyBudgetName) !== null && _a !== void 0 ? _a : null), weeklyBudgetName: weekly_name !== null && weekly_name !== void 0 ? weekly_name : ((_b = raw.weeklyBudgetName) !== null && _b !== void 0 ? _b : null), biWeeklyBudgetName: bi_weekly_name !== null && bi_weekly_name !== void 0 ? bi_weekly_name : ((_c = raw.biWeeklyBudgetName) !== null && _c !== void 0 ? _c : null), monthlyBudgetSource: a.budget_assignment_source, weeklyBudgetSource: a.budget_assignment_source, biWeeklyBudgetSource: a.budget_assignment_source, outflowId: a.outflow_id, inflowId: a.inflow_id, monthlyPeriodId: a.monthly_period_id, weeklyPeriodId: a.weekly_period_id, biWeeklyPeriodId: a.bi_weekly_period_id, 
            // App-category classification (Simplified-Transaction-Categories): the
            // user-facing slugs + source. 'user' source preserves a manual override;
            // secondCategoryId holds the specific chosen category only on an override.
            overallCategoryId: a.overall_category_id, firstCategoryId: a.first_category_id, secondCategoryId: a.second_category_id, categorySource: a.category_source, updatedAt: now });
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    // splitBudgetIds = the distinct budgets a split touches ACROSS all three lenses
    // (scopes the recompute fan-out in process_transaction_written).
    const split_budget_ids = [
        ...new Set(result.splits.flatMap((s) => [
            s.monthly_budget_id,
            s.weekly_budget_id,
            s.bi_weekly_budget_id,
        ])),
    ];
    return { updated_splits, name_changed, split_budget_ids };
}
//# sourceMappingURL=merge_assignment.js.map