"use strict";
/**
 * Backfill Targets Resolver
 *
 * READ-ONLY: enumerates the users the assignment backfill fans out to (each gets one bounded
 * re-assign run).
 *
 * @module resolvers/transactions/backfill_targets
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_backfill_user_ids = resolve_backfill_user_ids;
const user_repo_1 = require("../../repositories/user.repo");
/**
 * Enumerate all user IDs (doc IDs of the `users` collection).
 *
 * Used by the backfill coordinator to fan out one per-user job each.
 */
async function resolve_backfill_user_ids(ctx) {
    return user_repo_1.user_repo.get_all_ids(ctx);
}
//# sourceMappingURL=backfill_targets.resolver.js.map