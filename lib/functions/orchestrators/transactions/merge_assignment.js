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
        const a = by_id.get(raw.splitId);
        if (!a) {
            return raw;
        }
        const budget_name = resolved.budget_names[a.budget_id];
        if (budget_name !== undefined && raw.budgetName !== budget_name) {
            name_changed = true;
        }
        return Object.assign(Object.assign({}, raw), { budgetId: a.budget_id, budgetName: budget_name !== null && budget_name !== void 0 ? budget_name : raw.budgetName, budgetAssignmentSource: a.budget_assignment_source, outflowId: a.outflow_id, inflowId: a.inflow_id, monthlyPeriodId: a.monthly_period_id, weeklyPeriodId: a.weekly_period_id, biWeeklyPeriodId: a.bi_weekly_period_id, updatedAt: now });
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    const split_budget_ids = [...new Set(result.splits.map((s) => s.budget_id))];
    return { updated_splits, name_changed, split_budget_ids };
}
//# sourceMappingURL=merge_assignment.js.map