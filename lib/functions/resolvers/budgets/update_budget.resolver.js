"use strict";
/**
 * Update Budget Resolver
 *
 * READ-ONLY impact analysis for updating a budget. Loads the existing budget,
 * computes category add/remove deltas, finds the Everything Else budget, and
 * detects amount changes. No mutations.
 *
 * @module resolvers/budgets/update_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_update_budget_dependencies = resolve_update_budget_dependencies;
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const view_ownership_resolver_1 = require("./view_ownership.resolver");
const budgets_1 = require("../../domain/budgets");
const sharing_1 = require("../../repositories/sharing");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
/**
 * Resolves dependencies for updating a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User performing the update
 * @param input - Normalized partial update input
 * @throws NotFoundError if the budget does not exist
 */
async function resolve_update_budget_dependencies(ctx, user_id, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_update_budget_dependencies");
    (0, observability_1.log_operation_start)(span, user_id);
    const existing = await budget_repo_1.budget_repo.get_by_id(ctx, input.budget_id);
    // Ownership: a budget the caller can't manage is "not found" (don't reveal it
    // exists). The callables run with the admin SDK, so rules don't protect it.
    // Group budgets (owner key "group:<id>", PD6) are managed by any member.
    const owner_group_id = existing ? (0, budget_view_service_1.group_id_of_key)(existing.user_id) : null;
    const owner_group = owner_group_id ? await sharing_1.group_repo.get(ctx, owner_group_id) : null;
    if (!existing || !(0, budget_view_service_1.can_manage_budget)(existing.user_id, user_id, owner_group)) {
        throw new errors_1.NotFoundError("budget", input.budget_id);
    }
    // Category delta (only when category_ids is part of the update and this is
    // not the system budget, which manages categories automatically).
    let added_category_ids = [];
    let removed_category_ids = [];
    if (input.category_ids !== undefined && !existing.is_system_everything_else) {
        const current = new Set(existing.category_ids);
        const next = new Set(input.category_ids);
        added_category_ids = [...next].filter((c) => !current.has(c));
        removed_category_ids = [...current].filter((c) => !next.has(c));
    }
    const everything_else = removed_category_ids.length > 0
        ? await budget_repo_1.budget_repo.find_everything_else(ctx, existing.user_id, // the budget's view (PD6), not the caller
        (0, budgets_1.budget_cadence_to_instance)(existing.period) // this budget's lens
        )
        : null;
    const amount_changed = input.amount !== undefined && input.amount !== existing.amount;
    // Taking categories: who owns them in THIS budget's view (canon A3 — per view).
    const ownership = added_category_ids.length > 0
        ? await (0, view_ownership_resolver_1.resolve_view_ownership)(ctx, await budget_repo_1.budget_repo.get_by_user_id(ctx, existing.user_id), added_category_ids)
        : { view_budgets: [], first_by_category: {} };
    (0, observability_1.log_operation_success)(span, user_id);
    return Object.assign({ existing,
        added_category_ids,
        removed_category_ids, everything_else_budget_id: (_a = everything_else === null || everything_else === void 0 ? void 0 : everything_else.id) !== null && _a !== void 0 ? _a : null, amount_changed }, ownership);
}
//# sourceMappingURL=update_budget.resolver.js.map