"use strict";
/**
 * Backfill Targets Resolver
 *
 * READ-ONLY impact analysis for the assignment backfill: enumerates the users
 * to process, and for one user lists the transaction IDs to re-assign and the
 * budget IDs whose spend must be fully recomputed.
 *
 * @module resolvers/transactions/backfill_targets
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_backfill_user_ids = resolve_backfill_user_ids;
exports.resolve_user_backfill_targets = resolve_user_backfill_targets;
const transaction_repo_1 = require("../../repositories/transaction.repo");
const budget_repo_1 = require("../../repositories/budget.repo");
const user_repo_1 = require("../../repositories/user.repo");
/**
 * Enumerate all user IDs (doc IDs of the `users` collection).
 *
 * Used by the backfill coordinator to fan out one per-user job each.
 */
async function resolve_backfill_user_ids(ctx) {
    return user_repo_1.user_repo.get_all_ids(ctx);
}
/**
 * Resolve one user's backfill work-list: every active transaction (by `userId`,
 * matching the engine) and every budget (real + Everything Else).
 */
async function resolve_user_backfill_targets(ctx, user_id) {
    const [transaction_ids, budgets] = await Promise.all([
        transaction_repo_1.transaction_repo.get_ids_by_user_id(ctx, user_id),
        budget_repo_1.budget_repo.get_by_user_id(ctx, user_id),
    ]);
    console.log(`[${ctx.trace_id}] resolve_user_backfill_targets: user=${user_id}, ` +
        `txns=${transaction_ids.length}, budgets=${budgets.length}`);
    return { transaction_ids, budgets };
}
//# sourceMappingURL=backfill_targets.resolver.js.map