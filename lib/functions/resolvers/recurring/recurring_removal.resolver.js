"use strict";
/**
 * Recurring Removal Resolver (generic over outflow/inflow)
 *
 * READ-ONLY: load the context needed to remove/pause/restore/delete a recurring
 * item — owner + group access (authorization) + current `removal_intervals`.
 * Repo-agnostic: any repo exposing `get_by_id` returning those fields works, so
 * outflows and inflows share this. Loads with `include_deleted` so an already-
 * removed item is still manageable.
 *
 * @module resolvers/recurring/recurring_removal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_recurring_removal_context = resolve_recurring_removal_context;
/** Load the removal context for a recurring item, or null if it doesn't exist. */
async function resolve_recurring_removal_context(ctx, repo, id) {
    const item = await repo.get_by_id(ctx, id, { include_deleted: true });
    if (!item) {
        return null;
    }
    return {
        id: item.id,
        owner_id: item.user_id,
        group_ids: item.group_ids,
        removal_intervals: item.removal_intervals,
    };
}
//# sourceMappingURL=recurring_removal.resolver.js.map