"use strict";
/**
 * Outflow Removal Resolver
 *
 * READ-ONLY: load the context needed to remove/pause/restore/delete a recurring
 * outflow — its owner + group access (for authorization) and its current
 * `removal_intervals` (which the domain applies the action to). Loads with
 * `include_deleted` so an already-removed item is still manageable.
 *
 * @module resolvers/recurring/outflow_removal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_outflow_removal_context = resolve_outflow_removal_context;
const outflow_repo_1 = require("../../repositories/outflow.repo");
/** Load the removal context for an outflow, or null if it doesn't exist. */
async function resolve_outflow_removal_context(ctx, outflow_id) {
    const o = await outflow_repo_1.outflow_repo.get_by_id(ctx, outflow_id, { include_deleted: true });
    if (!o) {
        return null;
    }
    return {
        outflow_id: o.id,
        owner_id: o.user_id,
        group_ids: o.group_ids,
        removal_intervals: o.removal_intervals,
    };
}
//# sourceMappingURL=outflow_removal.resolver.js.map