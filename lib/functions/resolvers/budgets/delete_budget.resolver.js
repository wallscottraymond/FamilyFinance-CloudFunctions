"use strict";
/**
 * Delete Budget Resolver
 *
 * READ-ONLY impact analysis for deleting a budget. Loads the budget, its
 * periods, the transactions whose splits reference it (for reassignment), the
 * categories it owns, and the Everything Else budget. No mutations.
 *
 * Transactions are found the same way as the legacy delete: scan the user's
 * active transactions and filter splits in memory (splits are nested, so they
 * cannot be queried directly). The cascade job re-queries authoritatively.
 *
 * @module resolvers/budgets/delete_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_delete_budget_dependencies = resolve_delete_budget_dependencies;
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const budget_period_repo_1 = require("../../repositories/budget_period.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
/**
 * Resolves dependencies for deleting a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User performing the delete
 * @param budget_id - Budget being deleted
 * @throws NotFoundError if the budget does not exist
 */
async function resolve_delete_budget_dependencies(ctx, user_id, budget_id) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_delete_budget_dependencies");
    (0, observability_1.log_operation_start)(span, user_id);
    const existing = await budget_repo_1.budget_repo.get_by_id(ctx, budget_id);
    if (!existing) {
        throw new errors_1.NotFoundError("budget", budget_id);
    }
    const [budget_period_ids, affected_transaction_ids, everything_else] = await Promise.all([
        budget_period_repo_1.budget_period_repo.get_ids_by_budget_id(ctx, budget_id),
        transaction_repo_1.transaction_repo.get_ids_referencing_budget(ctx, user_id, budget_id),
        budget_repo_1.budget_repo.find_everything_else(ctx, user_id),
    ]);
    (0, observability_1.log_operation_success)(span, user_id);
    return {
        existing,
        budget_period_ids,
        affected_transaction_ids,
        owned_category_ids: existing.category_ids,
        everything_else_budget_id: (_a = everything_else === null || everything_else === void 0 ? void 0 : everything_else.id) !== null && _a !== void 0 ? _a : null,
    };
}
//# sourceMappingURL=delete_budget.resolver.js.map