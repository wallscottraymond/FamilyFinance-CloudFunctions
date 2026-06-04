"use strict";
/**
 * Budget Re-home Resolver
 *
 * READ-ONLY: when a budget gains/loses category ownership (create or update),
 * find the existing transactions whose splits are currently assigned to one of
 * the budgets whose membership changed — i.e. the candidates to re-run through
 * the assignment engine so their spend moves (Everything Else ⇄ the budget).
 *
 * Scoped to the budget's date range (the only range where a split could now
 * match it) via the `transactions(userId, transactionDate)` composite index +
 * an in-memory filter on the split assignment (splits aren't queryable by an
 * inner field).
 *
 * @module resolvers/budgets/budget_rehome
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_created_rehome_transaction_ids = resolve_created_rehome_transaction_ids;
exports.resolve_updated_rehome_transaction_ids = resolve_updated_rehome_transaction_ids;
exports.resolve_rehome_transaction_ids = resolve_rehome_transaction_ids;
const transaction_repo_1 = require("../../repositories/transaction.repo");
const budget_repo_1 = require("../../repositories/budget.repo");
/**
 * Resolve the Everything Else budget id: trust the payload hint when present
 * (the create/update resolver only sets it on a formal category claim), else
 * look it up. Keeps the EE impact-analysis read in the resolver layer.
 */
async function resolve_everything_else_id(ctx, user_id, ee_hint) {
    var _a;
    if (ee_hint) {
        return ee_hint;
    }
    const ee = await budget_repo_1.budget_repo.find_everything_else(ctx, user_id);
    return (_a = ee === null || ee === void 0 ? void 0 : ee.id) !== null && _a !== void 0 ? _a : null;
}
/**
 * Re-home targets after a budget is CREATED: existing transactions on Everything
 * Else within the new budget's range may now match it. Returns [] when there's
 * no EE, or this IS the EE budget (self-provision).
 */
async function resolve_created_rehome_transaction_ids(ctx, user_id, budget_id, ee_hint, start_ms, end_ms) {
    const ee_id = await resolve_everything_else_id(ctx, user_id, ee_hint);
    if (!ee_id || ee_id === budget_id) {
        return [];
    }
    return resolve_rehome_transaction_ids(ctx, user_id, [ee_id], start_ms, end_ms);
}
/**
 * Re-home targets after a budget's categories are UPDATED: candidates are the
 * transactions currently on this budget (may release back to EE) or on EE (may
 * gain this budget). Returns [] when no categories changed.
 */
async function resolve_updated_rehome_transaction_ids(ctx, user_id, budget_id, ee_hint, categories_changed, start_ms, end_ms) {
    if (!categories_changed) {
        return [];
    }
    const ee_id = await resolve_everything_else_id(ctx, user_id, ee_hint);
    const match_budget_ids = ee_id ? [budget_id, ee_id] : [budget_id];
    return resolve_rehome_transaction_ids(ctx, user_id, match_budget_ids, start_ms, end_ms);
}
/**
 * Resolve the transaction IDs to re-assign after a budget's categories change.
 *
 * @param match_budget_ids - Re-home transactions with a split on ANY of these
 *   (e.g. [everything_else] on create; [everything_else, budget] on update).
 * @param start_ms - Budget coverage window start (inclusive).
 * @param end_ms - Budget coverage window end (inclusive).
 */
async function resolve_rehome_transaction_ids(ctx, user_id, match_budget_ids, start_ms, end_ms) {
    var _a, _b;
    if (match_budget_ids.length === 0) {
        return [];
    }
    const match = new Set(match_budget_ids);
    const txns = await transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, start_ms, end_ms);
    const ids = [];
    for (const { id, data: d } of txns) {
        const split_budget_ids = (_a = d.splitBudgetIds) !== null && _a !== void 0 ? _a : ((_b = d.splits) !== null && _b !== void 0 ? _b : [])
            .map((s) => s.budgetId)
            .filter((id) => !!id);
        if (split_budget_ids.some((bid) => match.has(bid))) {
            ids.push(id);
        }
    }
    console.log(`[${ctx.trace_id}] resolve_rehome_transaction_ids: user=${user_id}, ` +
        `candidates=${ids.length} (of ${txns.length} in range)`);
    return ids;
}
//# sourceMappingURL=budget_rehome.resolver.js.map