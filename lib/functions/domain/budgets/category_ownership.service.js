"use strict";
/**
 * Category Ownership Domain Service
 *
 * Pure, deterministic computation of category transfer plans. Categories are
 * system-wide but ownership is per-user: each user's budgets claim categories,
 * and unclaimed categories fall to the "Everything Else" budget.
 *
 * The resolver supplies the current ownership map (IO); this service computes
 * the diff. NO async, NO IO, NO side effects.
 *
 * @module domain/budgets/category_ownership
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compute_create_transfer_plan = compute_create_transfer_plan;
exports.compute_update_transfer_plan = compute_update_transfer_plan;
exports.compute_delete_transfer_plan = compute_delete_transfer_plan;
/**
 * Compute the transfer plan when a NEW budget claims its initial categories.
 *
 * Every requested category is claimed from its current owner (which may be the
 * Everything Else budget or unassigned).
 *
 * PURE FUNCTION.
 *
 * @param requested_category_ids - Categories the new budget wants
 * @param current_owners - Map of category_id → current owner budget_id (or null)
 * @param new_budget_id - The budget claiming the categories
 */
function compute_create_transfer_plan(requested_category_ids, current_owners, new_budget_id) {
    if (!new_budget_id) {
        return { validation_errors: ["new_budget_id is required"] };
    }
    const claims = unique(requested_category_ids).map((category_id) => {
        var _a;
        return ({
            category_id,
            from_budget_id: (_a = current_owners[category_id]) !== null && _a !== void 0 ? _a : null,
            to_budget_id: new_budget_id,
        });
    });
    return { entity: { claims, releases: [] } };
}
/**
 * Compute the transfer plan when an EXISTING budget's categories change.
 *
 * - Added categories (new - current) are claimed from their current owners.
 * - Removed categories (current - new) are released to Everything Else.
 *
 * PURE FUNCTION.
 *
 * @param current_category_ids - Categories the budget owns today
 * @param next_category_ids - Categories the budget should own after update
 * @param current_owners - Map of category_id → current owner budget_id (or null)
 * @param budget_id - The budget being updated
 * @param everything_else_budget_id - Release target (null if none exists)
 */
function compute_update_transfer_plan(current_category_ids, next_category_ids, current_owners, budget_id, everything_else_budget_id) {
    if (!budget_id) {
        return { validation_errors: ["budget_id is required"] };
    }
    const current_set = new Set(current_category_ids);
    const next_set = new Set(next_category_ids);
    const added = [...next_set].filter((c) => !current_set.has(c));
    const removed = [...current_set].filter((c) => !next_set.has(c));
    const claims = added.map((category_id) => {
        var _a;
        return ({
            category_id,
            from_budget_id: (_a = current_owners[category_id]) !== null && _a !== void 0 ? _a : null,
            to_budget_id: budget_id,
        });
    });
    const releases = removed.map((category_id) => ({
        category_id,
        from_budget_id: budget_id,
        // null target means "return to Everything Else" — the repo resolves the
        // actual document; we record the known id when available.
        to_budget_id: everything_else_budget_id !== null && everything_else_budget_id !== void 0 ? everything_else_budget_id : "",
    }));
    return { entity: { claims, releases } };
}
/**
 * Compute the transfer plan when a budget is DELETED.
 *
 * All categories owned by the deleted budget are released back to Everything
 * Else. The system budget itself never owns transferable categories.
 *
 * PURE FUNCTION.
 *
 * @param owned_category_ids - Categories owned by the budget being deleted
 * @param budget_id - The budget being deleted
 * @param everything_else_budget_id - Release target (null if none exists)
 */
function compute_delete_transfer_plan(owned_category_ids, budget_id, everything_else_budget_id) {
    if (!budget_id) {
        return { validation_errors: ["budget_id is required"] };
    }
    const releases = unique(owned_category_ids).map((category_id) => ({
        category_id,
        from_budget_id: budget_id,
        to_budget_id: everything_else_budget_id !== null && everything_else_budget_id !== void 0 ? everything_else_budget_id : "",
    }));
    return { entity: { claims: [], releases } };
}
/**
 * Deduplicate a string array preserving first-seen order.
 *
 * PURE helper.
 */
function unique(values) {
    return [...new Set(values)];
}
//# sourceMappingURL=category_ownership.service.js.map